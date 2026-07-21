# Changelog

All notable changes to this project will be documented in this file.

## [0.11.2] - 2026-07-21

### Changed

- Light and dark themes now use the Catppuccin Latte and Mocha palettes, respectively, instead of the previous stark white/grey and plain near-black schemes.
- Rounded corners across buttons, inputs, dropdowns, deal cards, and overlays for a more relaxed, casual look.

## [0.11.1] - 2026-06-28

### Changed

- Scheduled refresh now fetches RedFlagDeals pages in bounded parallel batches and reuses compiled redirect matchers, reducing CPU usage so new deals continue to appear promptly.

## [0.11.0] - 2026-06-27

### Added

- Infinite scrolling renders the first 100 matching deals up front, then loads additional batches as you scroll while filters and sorting still apply to the full fetched dataset.

### Changed

- Backend refresh now fetches up to 1,000 Hot Deals topics so filtering can search a deeper deal history.

## [0.10.1] - 2026-06-23

### Added

- Just recipes for local Cloudflare Pages, local Worker, frontend-only dev, and seeding local KV.

### Changed

- Mobile deal rows now keep content inline, constrain long retailer names, and hide compact dates to preserve narrow-screen space.

## [0.10.0] - 2026-06-23

### Added

- Cloudflare Pages deployment with Pages Functions serving `/topics.json`, `/html`, and a protected manual refresh endpoint from KV.
- Scheduled Cloudflare Worker refreshes RedFlagDeals topics into KV every five minutes.
- Wrangler scripts and local development docs for running Pages Functions, seeding local KV, and deploying the refresh Worker.

### Removed

- Go backend and Docker/container deployment in favour of Cloudflare Pages, Workers, and KV.

## [0.9.0] - 2026-06-09

### Changed

- Deal rows now show the merchant first with a larger, bolder label to make scanning by merchant easier.
- Fast-rising hot deals are flagged with a fire icon, and filtered-out lists now show an empty state with a clear-filters action.

## [0.8.0] - 2026-05-26

### Added

- **Seen Deals**: click a deal to mark it seen. See a dimmed overlay on seen rows, filter them from the list with "Hide seen", mass-mark visible deals in one hit, or clear the entire history. Everything is stored locally with a soft 30-day expiry.
- Keyboard shortcuts: `h` toggles hide-seen, `m` marks all visible deals as seen.

## [0.7.0] - 2026-05-22

### Changed

- PWA accent color changed from orange to red for better visual impact.

## [0.6.0] - 2026-05-15

### Added

- PWA home screen support: saving the site to your iOS or Android home screen now shows the correct app icon and name instead of a screenshot thumbnail. Includes an Apple Touch Icon (180×180) for iOS and a web app manifest for Android.

## [0.5.0] - 2026-04-14

### Added

- Sort method is now encoded in the URL as `?sort=` — changing the sort via the dropdown or `s` key updates the URL, and loading a URL with `?sort=views` (etc.) applies that sort immediately. This makes sorted views shareable and bookmarkable.

## [0.4.3] - 2026-04-12

### Added

- Make the dealer label a clickable filter
- Add headers to the menu when in hamburger menu

### Changed

- Pin the header to the top when scrolling

## [0.4.2] - 2026-04-12

### Added

- Regex filter support: wrapping a filter term in `/slashes/` (e.g. `/gpu|rtx/i`) applies it as a regular expression against deal title and retailer name. Invalid patterns fall back to literal substring matching and show a red border on the input to signal the error.

## [0.4.1] - 2026-04-11

### Changed

- Info panel is now visibly distinct in dark mode

### Removed

- Card/grid view mode and its toggle button — the app now always uses the list view.

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
