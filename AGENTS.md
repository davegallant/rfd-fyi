# AGENTS.md

Vue 3 frontend + Go backend that aggregates RedFlagDeals topics.

## Stack

- **Frontend:** Vue 3 (Composition-style in `<script>`), Vite, vanilla CSS (scoped `<style>`), axios, dayjs, vue-router
- **Backend:** Go 1.26, gorilla/mux, zerolog, embed (serves built frontend via `embed.FS`)
- **Dev env:** Nix flake, Makefile, Docker multi-stage build
- **CI:** GitHub Actions (dependency-review, publish-container)

## Project Layout

- `src/` — Vue SPA (`App.vue` is the main component, `src/components/` for sub-components)
- `backend/` — Go HTTP server (`main.go` entrypoint, `app.go` routes/logic, `model.go` types, `pkg/` utilities)
- `backend/dist/` — embedded frontend build output (via `//go:embed dist/*`)
- `vite.config.mjs` — Vite config; dev server proxies `/api` → `localhost:8080`

## Conventions

- Frontend is a single-page app; all routing is client-side via vue-router with hash-based URLs
- Backend API base path: `/api/v1`; JSON responses via `respondWithJSON`
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
make frontend  # dev frontend (:3000, proxies API)
make backend   # dev backend (:8080)
```

## Key Patterns

- Backend refreshes topics from RFD API on a randomized 60–90s interval in a goroutine
- Topics are held in memory (`App.CurrentTopics`), no database
- Filtering is done both server-side (query param `filters`) and client-side
- Redirect URL stripping uses `regexp2` named capture groups
- Frontend uses `localStorage` for persisting theme, sort method, view mode, and filter state
