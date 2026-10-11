# v0.1 validation

Verified locally on 2026-10-11. These results are from local checks; remote CI
results are available in [GitHub Actions](https://github.com/arvlet/arvlet/actions).

- Go tests: 14 behavioral tests, passing with the race detector in Linux Docker.
- `go vet ./...`: passing in the same Linux environment.
- Server package statement coverage: 68.7%. The process entrypoint is not unit tested;
  container startup, health checks, and replacement were exercised separately.
- Preview bridge test: rejects wrong-source/channel replies and propagates errors.
- Five frontend regression tests cover uncertain-write retries, proxy errors,
  save conflicts, frozen submitted drafts, unsaved records, and creation without
  a second network dependency.
- TypeScript compilation, Vite production build, Go formatting, and Prettier: passing.
- Regenerating OpenAPI and TypeScript types leaves both files byte-for-byte unchanged.
- Caddy local HTTP deployment: app healthy, only the proxy exposes host ports.

## Browser flow

1. Sign in with the configured workspace password.
2. Open the API-created budget artifact and change a number: calculation updates.
3. Try saving without host permission: rejected with a visible error.
4. Enable this artifact's data write permission and save: state revision increments.
5. Edit HTML and save v2: new heading appears and saved data is retained.
6. Open v1: original content remains available.
7. Append a linked record through the workbench: it appears in the timeline.
8. Edit interaction JSON: the preview reads the updated values.
9. Rebuild and replace the app container: 3 artifacts, both budget content versions,
   state revision 2, and the appended record remain present. Refresh the browser:
   the session and artifact library still work.

## Remaining validation

Public-domain certificate issuance, load testing, browser resource exhaustion,
mobile device coverage, accessibility auditing, and automated browser regression
tests are not complete. Browser sandboxing is not a network firewall; see SECURITY.md.
Do not present this initial version as production-hardened or multi-tenant software.
