# AGENTS.md

Compact, actionable rules for automated agents and contributors.

- Production / build notes:
  - The Go backend embeds frontend files via `//go:embed dist/*` (backend expects `backend/dist/` to exist at build time).
  - To produce an embedded binary locally: run `npm run build` in the repo root and copy the generated `dist` into `backend/dist` (Dockerfile does this for you). If `backend/dist` lacks the built frontend, `go build`/`go run` that depends on embed may fail or embed placeholders.
  - The Dockerfile builds the frontend then the backend and sets `TOPICS_PATH=/tmp/topics.json` in the image.

- Important env vars and files:
  - `TOPICS_PATH` (default `./topics.json`) controls where the backend writes/reads topics. Docker image uses `/tmp/topics.json`.
  - `HTTP_PORT` (default `8080` in Makefile/main) controls the server port.
  - `LOG_LEVEL` controls zerolog level; .env is auto-loaded (package `joho/godotenv/autoload` is imported).
  - `VERSION` is read by Vite at build time and injected as `__APP_VERSION__`. Updating `VERSION` requires rebuilding the frontend to take effect.

- Backend behavior and gotchas an agent might miss:
  - Backend periodically refreshes topics from RedFlagDeals on a randomized 60–90s interval and performs an immediate first fetch on startup.
  - Topics are written atomically (tmp file + rename). If the topics file is missing the server will serve `[]` — this is normal.
  - Redirect stripping uses `regexp2` named groups; redirects are fetched from an external JSON by default (overridable via `RedirectsURL`).
  - The backend can serve a cached topics response when `TopicsResponseCache` is enabled in tests; production behavior is file-backed.

- Tests & linting:
  - Frontend tests: `npm test` (runs Vitest per `vite.config.mjs`). Coverage: `npm run test:coverage`.
  - Lint: `npm run lint` (eslint configured in package.json).
  - Backend tests: `cd backend && go test ./...`.

- CI / release conventions:
  - Versioning: update `VERSION` and add the release notes to `CHANGELOG.md` in the same commit before cutting a release.
  - The repository keeps `package-lock.json` and `go.sum` committed; dependency updates are managed by Renovate.
