# AGENTS.md

Compact, actionable rules for automated agents and contributors.

- Production / build notes:
  - Cloudflare Pages serves the Vite/Vue `dist/` output.
  - Pages Functions in `functions/` serve `/topics.json`, `/enrichment.json`, `/html`, `/admin/refresh`, and `/admin/enrich` from Cloudflare KV.
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

- Deal tags (enrichment):
  - Tags live in the `enrichment.json` KV key, never on topic objects. `compactTopic()` whitelists fields and `refreshTopics()` re-compacts stored topics every run, so a `tags` field on a topic is stripped within one cron cycle. `functions/_shared/topics.test.ts` guards this.
  - `functions/_shared/enrichment.ts` is the single source of truth for the vocabulary. The enricher reads the vocabulary from `/enrichment.json` rather than keeping a copy, so changing tags means editing that file, bumping `VOCABULARY_VERSION`, and redeploying — entries then re-tag automatically.
  - The model provider is a pluggable adapter (`tools/enricher/providers.mjs`); only `ollama` ships. Adapters own the wire format; prompt, JSON schema, tag validation, batching, and concurrency are shared. Adding one means adding an object to `PROVIDERS` — the tests iterate it automatically.
  - `llama3.2:3b` was measured against real RFD data and failed: it put 31% of deals in `computing` (the first category in the list) and saturated the 2-tag limit on 52 of 55. Default is `qwen2.5:7b-instruct`. Each entry records the model in `m`, so re-measure rather than assume — see "Judging tag quality" in the enricher README.
  - `TAG_GLOSSES` exists because bare tag names were read too narrowly: `automotive` fired once in fifty deals while motor oil and a bike rack fell to `other`. Change `TAG_VOCABULARY` and `TAG_GLOSSES` together, and bump `VOCABULARY_VERSION` — a test in `enrichment.test.ts` pins the tag set to the version so the pair cannot drift.
  - Vocabulary changes are driven by measurement, not intuition. v2 added `dining`/`pets` after restaurant and pet deals landed in `other`; v3 added `sports` after golf balls and a camping tent were tagged `pets` across 1000 deals. A tag with no home does not produce `other` — it produces confident misclassification into whatever is nearest, so inspect categories, not just the `other` rate.
  - `/admin/enrich` drops invalid entries and reports them instead of rejecting a whole batch, and returns `404` (not `401`) on bad auth, matching `/admin/refresh`.
  - In the filter UI, `#tag` terms search tags only and unprefixed terms never search tags — otherwise a plain search for "computing" would match the `#computing` tag as a substring.

- Tests & linting:
  - Frontend tests: `npm test` (runs Vitest per `vite.config.mjs`). Coverage: `npm run test:coverage`.
  - Lint: `npm run lint` (eslint configured in package.json).
  - Build: `npm run build`.
  - Worker dry run: `npx wrangler deploy --dry-run --config worker/wrangler.toml`.
  - Pages Functions build: `npx wrangler pages functions build functions --outdir /tmp/rfd-fyi-pages-functions`.

- CI / release conventions:
  - Versioning: update `VERSION` and add the release notes to `CHANGELOG.md` in the same commit before cutting a release.
  - The repository keeps `package-lock.json` committed; dependency updates are managed by Renovate.
