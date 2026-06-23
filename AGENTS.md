# AGENTS.md

Compact, actionable rules for automated agents and contributors.

- Production / build notes:
  - Cloudflare Pages serves the Vite/Vue `dist/` output.
  - Pages Functions in `functions/` serve `/topics.json`, `/html`, and `/admin/refresh` from Cloudflare KV.
  - The scheduled Worker in `worker/` refreshes RedFlagDeals topics into KV every 5 minutes.
  - `wrangler.toml` configures Pages; `worker/wrangler.toml` configures the scheduled Worker.

- Important env vars, bindings, and files:
  - `TOPICS_KV` is the KV binding used by both Pages Functions and the Worker.
  - `REFRESH_SECRET` optionally protects manual refresh endpoints.
  - `RFD_BASE_URL` and `REDIRECTS_URL` can override fetch targets for the Worker/Functions.
  - `VERSION` is read by Vite at build time and injected as `__APP_VERSION__`. Updating `VERSION` requires rebuilding the frontend to take effect.

- Cloudflare behavior and gotchas an agent might miss:
  - The frontend expects `/topics.json` to preserve the old API shape, including `Offer`, `Votes`, and `score` fields.
  - KV can return `null`; functions should serve `[]` when topics are missing.
  - Redirect stripping uses JavaScript `RegExp` named groups and may need adjustment if redirect patterns use regexp features unsupported by JS.
  - The Worker URL is not the app UI; it intentionally returns `404` except for the protected `/refresh` endpoint.

- Tests & linting:
  - Frontend tests: `npm test` (runs Vitest per `vite.config.mjs`). Coverage: `npm run test:coverage`.
  - Lint: `npm run lint` (eslint configured in package.json).
  - Build: `npm run build`.
  - Worker dry run: `npx wrangler deploy --dry-run --config worker/wrangler.toml`.
  - Pages Functions build: `npx wrangler pages functions build functions --outdir /tmp/rfd-fyi-pages-functions`.

- CI / release conventions:
  - Versioning: update `VERSION` and add the release notes to `CHANGELOG.md` in the same commit before cutting a release.
  - The repository keeps `package-lock.json` committed; dependency updates are managed by Renovate.
