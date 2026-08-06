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
  - The prompt (`CLASSIFIER_INSTRUCTIONS`) is published in `/enrichment.json` alongside the vocabulary and glosses, so changing it is covered by `VOCABULARY_VERSION` like any other tagging change. It previously lived in `providers.mjs`, where editing it silently changed every future tag while stored entries kept looking current. The enricher keeps a fallback copy only for the case where the server publishes none.
  - `VOCABULARY_VERSION` versions *how tags are produced* — vocabulary, glosses and prompt — not just the tag list. The field is still called `vocabulary_version` on the wire.
  - `TAG_GLOSSES` exists because bare tag names were read too narrowly: `automotive` fired once in fifty deals while motor oil and a bike rack fell to `other`. Change `TAG_VOCABULARY` and `TAG_GLOSSES` together, and bump `VOCABULARY_VERSION` — a test in `enrichment.test.ts` pins the tag set to the version so the pair cannot drift.
  - Vocabulary changes are driven by measurement, not intuition. v2 added `dining`/`pets` after restaurant and pet deals landed in `other`; v3 added `sports` after golf balls and a camping tent were tagged `pets` across 1000 deals. A tag with no home does not produce `other` — it produces confident misclassification into whatever is nearest, so inspect categories, not just the `other` rate.
  - **The first tag in `TAG_VOCABULARY` over-attracts by ~140 deals in 1000, whatever it is, and this outweighs the glosses.** v9 tested it by moving `computing` from first to last-but-one and changing nothing else: `computing` fell 140 → 13, `electronics` inherited the slot and rose 116 → 256 (25.8%), and 27 laptops and 7 monitors left `computing` — whose gloss names them — for `electronics`, whose gloss does not. Order cannot fix this, only aim it, since some tag must be first; `computing` holds the slot because it is broad enough to absorb the bias. Before attributing any misclassification to wording, check whether the winning tag is simply first. The open fix is to rotate the list per topic (`topic_id % length`) so no tag owns the slot.
  - **A gloss states only what a category includes, never what it excludes**, and `enrichment.test.ts` enforces this mechanically. Measured across the v7 deployment, six of seven negated phrases pulled in the very deals they excluded (48 of them): `computing` said "not power tools" and took 17, `rewards` said "not airline or hotel points transfers" and took 9. The model matches gloss text lexically and "not" contributes nothing. To keep a noun out of a category, name it in the category that should win — that is what fixed phones (16/1 → 17/17 `electronics`).
  - Re-measure the baseline in the same session as the variant. Ollama at `temperature: 0` reproduces exactly between back-to-back runs but not across a model reload — the same prompt scored 107 once and 105 twice — so **a delta of ±2 on the 121-case benchmark is noise**. `git stash` the change, run `--out base.json`, pop, then `--compare base.json`.
  - Measure a gloss change with `node tools/enricher/evaluate.mjs` **before** deploying it. It reads the vocabulary from `functions/_shared/enrichment.ts` rather than `/enrichment.json` and never writes tags back, so the loop is edit → score → compare against 121 hand-labelled deals, with no deploy and no re-tag. Scoring is per-class because a single accuracy number hides the trade a change made — v6 beat v8 on unambiguous product classes while losing badly on distribution shape.
  - Ship gloss changes **one variable at a time**. They cannot be validated by tests, only by deploying and re-running the enricher, so a version that changes a dozen things at once — as v7 did — cannot be untangled when the aggregate comes back worse. v7 improved `other` (94 → 36) and phones while regressing `computing` to 19.7%; separating those took a full re-measurement.
  - The strongest evidence for a gloss change is *the same deal classified two ways in one run*. The enricher runs at `temperature: 0`, so this is never sampling noise — it means the glosses do not partition that boundary, and it is measurable with no model by bucketing titles by keyword and counting disagreements. v7 was found this way: a Fanttik drill was both `home` and `computing`, a Galaxy Fold 8 pre-order both `computing` and `electronics`, Shell fuel promos both `automotive` and `other`. A negative exclusion alone does not settle a boundary — v6 excluded power tools from `computing` and they stayed split 12/10 until `home` named them positively.
  - `other` is normalized out of multi-tag entries in `validateTagBatch`, not rejected. Rejecting would loop: no entry stored → `selectTopicsNeedingTags` picks the topic up next run → same answer at temperature 0 → rejected again.
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
