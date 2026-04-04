# Changelog

All notable changes to this project will be documented in this file.

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
