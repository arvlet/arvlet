# Contributing to Arvlet

Arvlet is an artifact workspace and append-only journal. It is not a task manager.
Keep changes focused on creating, editing, using, and understanding artifacts.

## Development checks

Use Go 1.26 and Node.js 24. Install the locked dependencies with `npm ci` in
the repository root and `npm ci --prefix web`. Run:

```sh
npm run api:generate
npm run format:check
npm run test:bridge
npm test --prefix web
npm run build --prefix web
gofmt -l .
go vet ./...
go test ./...
```

`gofmt -l .` must produce no output. CI also runs Go's race detector on Linux.
Build the frontend before building Go because the executable embeds `web/dist`.
Do not commit generated frontend bundles, databases, tokens, or `.env` files.

## Code expectations

- Prefer explicit, idiomatic code. One statement per line; run formatters before review.
- Group code by responsibility. Add an abstraction when it removes demonstrated
  duplication or clarifies a boundary, not to fill a layered architecture template.
- Handle errors at the boundary that can act on them. Never silently ignore a
  database or serialization failure. Log internal errors without credentials.
- Keep database transactions independent of response writes. A mutation and its
  idempotency response must commit together.
- Test observable behavior: concurrent edits, retries, validation, persistence,
  and authorization. Avoid tests that merely restate implementation details.
- Explain non-obvious invariants and tradeoffs in comments. Exported Go symbols
  should have useful documentation.
- Breaking API or storage changes require a migration plan and updated OpenAPI,
  generated TypeScript types, examples, and tests in the same change.
- UI must handle loading, errors, empty results, and unsaved edits. Do not silently
  overwrite a draft on a conflict or failed request.

## Pull requests

Describe the user-visible problem, resulting behavior, validation, and limitations.
Keep unrelated refactors separate. There is no requirement to adopt a framework
just to contribute; see `docs/architecture.md` for current decisions.

This is pre-release software. Passing CI is necessary, but is not a substitute for
reviewing data-loss risks, security boundaries, and actual browser behavior.
