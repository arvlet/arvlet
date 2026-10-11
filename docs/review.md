# Pre-publication review

Reviewed the initial source tree on 2026-10-11 before its first GitHub push.
This is a code and behavior review, not an independent security audit.

## Fixed

- Artifact detail and export handlers retained a read transaction during response
  writes. Both now release SQLite before sending the response; regression tests
  inspect connection occupancy at the network boundary.
- State writes silently treated omitted/null revisions as zero. Revision is now
  required, matching OpenAPI and optimistic concurrency semantics.
- SQLite connection settings were applied only to the initial connection. The
  DSN now reapplies foreign-key checks and busy timeout after reconnection, and
  escapes database paths. Tests exercise reconnection and special path characters.
- Artifact creation and editing depended on a follow-up read after a successful
  commit. The UI now applies the committed response directly, avoiding ambiguous
  errors and duplicate creation when that extra read failed.
- Editors accepted more typing while saving and did not protect unsent records
  when closing. Submitted fields are disabled during saves; unsent record text
  and version notes participate in dirty-state checks.
- HTML/empty proxy errors surfaced as JSON parse failures. The API client now
  reports the HTTP status while retaining retry keys for uncertain writes.
- Toggling preview write permission tore down pending message handlers. Permission
  now updates without abandoning in-flight responses.

## Reviewed boundaries

Authentication, cookie origin checks, sandbox capabilities, SQL parameter binding,
atomic retry handling, revision conflicts, migration behavior, graceful shutdown,
Docker volumes, OpenAPI generation, and the staged publication set were reviewed.
Credentials and database files are excluded from Git and container build context.

## Accepted v0.1 limits

One owner and one full-access API key; no scoped identities. HTML is browser-isolated
but not a network firewall or compute quota. Export buffers the workspace in memory.
Retry keys have no expiry. No arbitrary React builds, file uploads, or production
load/penetration testing. These are documented limits, not guarantees supplied by CI.
