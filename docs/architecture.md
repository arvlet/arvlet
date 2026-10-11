# Architecture decisions

Status: v0.1 foundation, under active development.

## Product model

- **Artifact**: title, kind, optional collection, immutable content versions.
- **Entry**: append-only text record, optionally linked to an artifact. The agent
  label is supplied by the caller; it is not a verified identity or an audit signature.
- **State**: the artifact's mutable interaction data, with an independent revision.

Creating an artifact does not require a task or an entry. Editing creates a new
content version. Restoring old content means saving it as a new version. Content
history does not restore interaction data; these are deliberately independent.

## Go and HTTP

Go's `net/http` supports the method and path routing required here. A small handler
wrapper centralizes error responses and authentication. Gin remains a valid future
choice if concrete middleware requirements justify changing the boundary. Avoid
adding a framework solely for familiarity or abstracting every handler into layers.

Files in `internal/server` separate routing, authentication, HTTP validation,
artifact operations, records, state, transactions, preview isolation, and storage.
The server accepts configuration explicitly; tests never rely on production secrets.

## Persistence and concurrency

SQLite is suitable for the initial single-owner, single-process deployment. Schema
migrations are transactional and forward-only, tracked with `PRAGMA user_version`.
One connection and serialized writes favor simple correctness over write throughput.
This is not a horizontally scalable deployment. Use database constraints and
transactions, not in-memory state, to preserve data.

Writes can carry an `Idempotency-Key`. The fingerprint covers method, path and
decoded input; a reused key with different input fails. Mutation and retry result
commit atomically. Keys currently persist indefinitely; retention is future work.
Version and state writes require the caller's last observed revision. A stale
revision returns 409. Reload and reconcile; never blindly retry an overwrite.

## Browser and artifact boundary

The workbench uses React/TypeScript. HTML runs inside an opaque sandbox with inline
scripts enabled, but without same-origin access, forms, or popups. CSP blocks
fetch/XHR and external resource loading. A per-preview message channel exposes only that artifact's state.
The host validates source window, channel, operation and write permission.
The iframe receives no API token. Markdown is sanitized before rendering.

This is browser isolation, not a general compute sandbox or a network firewall.
CSP does not reliably prevent an iframe from navigating itself to an external URL;
only run artifacts whose source you trust with their own interaction data. Scripts may consume CPU
or memory; there is no server-side execution or hard resource quota. HTML apps must
be self-contained in v0.1. Uploaded executables and arbitrary package installs are
outside the initial scope.

## Deployment and authentication

Caddy is the only public listener. The Go container embeds the built frontend and
uses a persistent data volume. Caddy has separate persistent configuration and
certificate volumes. Local mode binds to loopback; domain mode uses HTTPS.

The first release is a single-owner workspace. A Bearer API key has full workspace
access. The browser uses an HttpOnly, SameSite=Strict, signed session cookie and
checks the exact configured Origin on writes. HTTPS sets Secure cookies.
Login attempts are globally limited in-process; this is not multi-tenant auth.
Changing the password or session secret invalidates sessions. Per-agent scoped
tokens, account management, and durable abuse controls are future work.

## Standalone shares

Schema v2 adds revocable share grants for HTML artifacts. A random 256-bit path
token maps to one artifact and a pinned content version; lookups use its SHA-256
hash. The standalone host bridges only state reads and writes, without workspace
cookies. It preserves state revision checks and strips public idempotency keys to
keep them out of the workspace retry namespace. Share creation supports workspace
idempotency; revocation and public state writes do not.

The separate Caddy share listener serves `/s/*` and `/share.js` only. Its default
bind is loopback; operators can bind it to a LAN address without exposing the
workbench. Sharing has no accounts, per-recipient attribution, or edit history for
state. Revocation blocks subsequent requests; it cannot recall data already read
or cancel a write that was already authorized and is in flight.
