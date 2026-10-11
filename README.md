# Arvlet

An open-source workspace for AI agents to create artifacts and keep a record of
their work. Preview, edit, and use interactive apps, documents, and data in one
place, with persistent state and content history.

**Early v0.1. Single-owner, self-hosted.** Built with Go, React/TypeScript, SQLite,
Caddy, and Docker Compose. No chat interface, model server, or task workflow.

## What works

- Agents create HTML, Markdown, or JSON artifacts directly through a Bearer API.
- People preview and edit artifacts in the workbench; every save creates a version.
- HTML apps read and write their own persistent data through a restricted bridge.
- Records are append-only and can exist independently or link to an artifact.
- Retry keys prevent duplicate writes; revision checks prevent silent overwrites.
- The workbench supports searching, filtering, content history, and workspace export.

External scripts, network-connected HTML apps, file uploads, React source builds,
multi-user accounts, and scoped agent tokens are not part of this release.

## Run locally

Requirements: Docker with Compose. Node.js 24 is used by the setup and demo scripts;
the deployed application has no Node or Python runtime dependency.

```sh
node scripts/setup.mjs
docker compose up -d --build
node scripts/seed.mjs
```

Open **http://localhost:3090** and sign in with `ARVLET_PASSWORD` from `.env`.
The setup script generates independent secrets and refuses to overwrite an
existing `.env`. The demo script creates three example artifacts through the public
API; retries are idempotent. After editing demo source files, use new seed keys to
create different data, rather than reusing the old keys.

Only Caddy exposes ports. The app runs without root privileges; its SQLite data
survives container replacement in the `arvlet_arvlet_data` volume.
Do not use `docker compose down -v` unless you intend to delete all persisted data.

For a public domain, set `.env`:

```dotenv
ARVLET_ORIGIN=https://arvlet.example.com
ARVLET_SITE=arvlet.example.com
ARVLET_BIND=0.0.0.0
ARVLET_HTTP_PORT=80
ARVLET_HTTPS_PORT=443
```

Point DNS to the server and allow inbound 80/443. Recreate the containers after
changing environment variables. Caddy handles HTTPS; never publish the application
port separately. Public-domain certificate issuance is environment-dependent.

## Agent API

Give a trusted agent the base URL, `ARVLET_API_KEY`, and the OpenAPI document at
`/api/openapi.json`. No custom skill is required. The key has full workspace access.
Set secrets through your agent's environment or secret store, not source files.

```sh
curl http://localhost:3090/api/v1/artifacts \
  -H "Authorization: Bearer $ARVLET_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: report-2026-001" \
  -d '{"title":"Research notes","kind":"markdown","content":"# Findings\nA useful observation."}'
```

| Operation                                 | Endpoint                                        |
| ----------------------------------------- | ----------------------------------------------- |
| Create / list artifacts                   | `POST / GET /api/v1/artifacts`                  |
| Read current content and version metadata | `GET /api/v1/artifacts/{id}`                    |
| Save new content                          | `POST /api/v1/artifacts/{id}/versions`          |
| Read historical content                   | `GET /api/v1/artifacts/{id}/versions/{version}` |
| Read / write interaction data             | `GET / PUT /api/v1/artifacts/{id}/state`        |
| Append / list records                     | `POST / GET /api/v1/entries`                    |
| Export workspace                          | `GET /api/v1/export`                            |

Version writes use `{ "revision": 1, "content": "...", "note": "..." }`.
State writes use `{ "revision": 0, "data": { "count": 1 } }` (revision 0 means
no saved state yet). A stale revision returns 409; read again and reconcile.
Records use `{ "message": "...", "agent": "Research Agent", "artifact_id": "optional-id" }`.
Lists accept `limit` (1–200) and `offset`; results include `items` and `total`.

## Interactive artifacts

An HTML artifact is self-contained. Its scripts run in an opaque browser sandbox
without access to the parent document; CSP blocks fetch/XHR and external resources. The host provides:

```js
const current = await window.arvlet.getState();
const saved = await window.arvlet.setState({ count: 2 }, current.revision);
```

The viewer must enable “允许此产物保存自身数据” before writes succeed. State belongs
to the artifact, not a content version. Editing or restoring code does not reset it.
See [the budget example](examples/budget.html). This is browser isolation, not a
CPU/memory quota or a network firewall (self-navigation is not contained); use
artifacts from sources you trust with their own data.

## Backup and restore

JSON export is portable inspection data; there is currently no JSON import UI.
For a restorable backup, stop app writes and copy the entire SQLite data directory:

```sh
docker compose stop app
docker compose cp app:/data ./backup-data
docker compose start app
```

Preserve `.env` separately in a secure location. Test restores on a separate
deployment before relying on a backup. To restore into an empty deployment using
the same release, create the app container, keep it stopped, and copy the backup:

```sh
docker compose create app
docker compose cp ./backup-data/. app:/data
docker compose run --rm --user 0 --entrypoint sh app -c 'chown -R 10001:10001 /data'
docker compose up -d
```

Never copy an old database over a running instance or mix it with unrelated WAL
files. Upgrade by backing up first and rebuilding the image. Schema migrations are
forward-only; rollback requires the old image and its matching backup.

## Development

Read [CONTRIBUTING.md](CONTRIBUTING.md) for checks and code expectations, and
[architecture decisions](docs/architecture.md) for boundaries and tradeoffs.
The frontend builds into the Go executable; a fresh clone needs the frontend build
before `go build ./...`. Generate API types with `npm run api:generate`.

For frontend development, use `npm run dev --prefix web`, run Go on port 8090,
and set `ARVLET_ORIGIN=http://localhost:5173`. Vite proxies the API and preview routes.
Go reads configuration from the environment; it does not automatically load `.env`.

MIT licensed. Contributions should keep artifacts and records at the center.
