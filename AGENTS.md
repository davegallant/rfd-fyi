# AGENTS.md

Vue 3 frontend + Go backend that aggregates RedFlagDeals topics.

## Stack

- **Frontend:** Vue 3 (Composition-style in `<script>`), Vite, vanilla CSS (scoped `<style>`), axios, dayjs, vue-router
- **Backend:** Go 1.26, net/http stdlib, zerolog, embed (serves built frontend via `embed.FS`)
- **Dev env:** Nix flake, Makefile, Docker multi-stage build
- **CI:** GitHub Actions (dependency-review, publish-container)

## Project Layout

- `src/` — Vue SPA (`App.vue` is the main component, `src/components/` for sub-components)
- `backend/` — Go HTTP server (`main.go` entrypoint, `app.go` routes/logic, `model.go` types, `pkg/` utilities)
- `backend/dist/` — embedded frontend build output (via `//go:embed dist/*`)
- `vite.config.mjs` — Vite config; dev server proxies `/topics.json` → `localhost:8080`

## Conventions

- Frontend is a single-page app; all routing is client-side via vue-router with HTML5 history (server falls back to `index.html` for non-file paths)
- Backend serves the embedded SPA and a static `topics.json` file from disk; no dynamic API endpoints
- Go error handling: log with zerolog, don't panic (except startup)
- No TypeScript — plain JS with `jsconfig.json` path aliases (`@` → `src/`)
- Use `@` alias for imports from `src/`
- CSS is scoped per-component; no CSS framework, no Tailwind
- ESLint with `plugin:vue/vue3-essential` + `eslint:recommended`
- Keep `package-lock.json` and `go.sum` committed; Renovate manages dependency updates

## Build & Run

```
npm install && npm run build   # frontend
cd backend && CGO_ENABLED=0 go run .  # backend (serves embedded frontend on :8080)
make frontend  # dev frontend (:3000, proxies /topics.json)
make backend   # dev backend (:8080)
```

## Key Patterns

- Backend refreshes topics from RFD API on a randomized 60–90s interval in a goroutine
- First fetch is immediate on startup (no initial delay)
- Topics are written atomically to disk as JSON (`TOPICS_PATH`, default `./topics.json`)
- Frontend fetches `/topics.json` as a static file; all filtering and sorting is client-side
- Redirect URL stripping uses `regexp2` named capture groups
- Frontend uses `localStorage` for persisting theme, sort method, view mode, and filter state

## Releasing a New Version

1. Update the `VERSION` file with the new version number (e.g. `0.2.0`)
2. Add a new section to `CHANGELOG.md` under the new version with the date and changes
3. Commit both files together
