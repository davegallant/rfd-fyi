# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-04-11

### Added

- Frontend unit tests for topic filtering (`filterTopics.js`) and user preferences (`preferences.js`); logic extracted from `App.vue` into dedicated modules.
- Backend unit tests covering HTTP handlers, caching (`cache.go`), and topic transformation (`topics_transform.go`).
- CI runs both frontend and backend test suites on each push.

### Changed

- Visual and colour improvements across the frontend: updated theme variables, richer contrast, and refined styling on the `/html` list page.
- Upgraded Vite to v8 and Vitest to v4.

## [0.3.1] - 2026-04-10

### Added

- Info panel links to the `/html` HTML-only deals list.

### Changed

- `/html` list page uses the site title in the header and a shorter subtitle (JSON link only).
- `index.html` `<noscript>` message no longer links to the home page separately; the HTML-only list link remains.

## [0.3.0] - 2026-04-10

### Added

- `GET /html` — server-rendered list of hot deals (no JavaScript required); uses the same on-disk data as `/topics.json`, sorted by score like the SPA default
- Embedded HTML template and `loadTopicsFromFile` helper in the Go backend
- Vite dev proxy for `/html` to the backend (with `/topics.json`)

### Changed

- `index.html` `<noscript>` now links to `/html` and `/` instead of stating the site is unusable without JavaScript

## [0.2.0] - 2026-04-03

### Changed

- Removed HTTP API (`/api/v1/topics`, `/api/v1/topics/{id}`) to reduce attack surface
- Backend now writes topics to a static JSON file on disk (`topics.json`) instead of holding them in memory
- Frontend fetches `/topics.json` instead of `/api/v1/topics`
- Replaced `gorilla/mux` with `net/http` stdlib `ServeMux`
- Topics file is written atomically (temp file + rename) to prevent serving partial data
- First topic fetch happens immediately on startup (no initial delay)

### Removed

- `gorilla/mux` dependency
- `listTopics`, `getTopicDetails` HTTP handlers, `respondWithJSON` helper
- `TopicDetails` model (detail endpoint removed)
- Server-side filtering (all filtering is now client-side)
- Vite dev proxy for `/api` (replaced with `/topics.json` proxy)

### Added

- `TOPICS_PATH` environment variable (default `./topics.json`, set to `/data/topics.json` in Docker)
- `/topics.json` endpoint serving pre-generated JSON from disk

## [0.1.1] - 2026-03-26

- Renovate/dependabot updates

## [0.1.0] - 2026-03-16

### Added

- Sort dropdown with six options: Title, Last Reply, Thread Start, Score, Replies, and Views
- Sort selection persists to `localStorage`
- `VERSION` file as the single source of truth for the project version
- Version displayed in the info overlay, injected at build time via Vite
- Copilot instructions (`.github/copilot-instructions.md`)

### Changed

- Replaced rotating sort icon button with a single `sort` icon that opens a dropdown menu
