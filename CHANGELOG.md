# Changelog

All notable changes to this project will be documented in this file.

## [0.15.0] - 2026-08-13

### Added

- A "Hide bad deals" toggle, in the visibility dropdown below "Hide seen" and in the mobile menu. When on, deals with a score below -5 are filtered out of the list. It defaults to off so bad deals show by default, and persists alongside the other UI preferences.

### Changed

- Renamed the visibility icon's tooltip from "Seen deals" to "Visibility". The icon now switches to `visibility_off` whenever either hide-seen or hide-bad-deals is active, rather than only tracking hide-seen.

## [0.14.0] - 2026-08-12

### Added

- Tag completion in the filter input. Typing `#` opens a dropdown of every tag in the published vocabulary, narrowing as you type; arrows navigate, Enter or Tab inserts the highlighted tag, and a second Enter applies the filter. Typing a tag out in full closes the dropdown, so Enter applies it directly as before. Completion is a filtering affordance rather than rendering, so `#other` is suggested too — it remains the audit path for the quarantine bucket.

## [0.13.12] - 2026-08-10

### Fixed

- Vocabulary version 20 names household paper goods in `home`. On the live corpus the aisle split three ways at `temperature: 0`: Charmin toilet paper was stored as both `grocery` and `home`, Cottonelle and SpongeTowels as `grocery`, Royale as `other`. The same deal classified two ways is the signal the glosses do not partition a boundary, and here they plainly did not — nothing in the vocabulary mentioned paper.
- The partition it restores was already in place. Tide detergent, Nature Clean surface spray and Dawn degreaser were unanimously `home`, all off the single word "cleaning", which paper goods are not. So the fix names them where the rest of the aisle already sits rather than moving anything: `home` now says "cleaning supplies and laundry detergent, toilet paper, paper towels and tissues" where it said "cleaning".
- `grocery` is left alone deliberately. It stays food and drink and says nothing about paper — six of seven negated phrases measured in v7 pulled in the very deals they excluded, so an exclusion there would attract paper goods back.

### Notes

- Measured with six new `household consumables` benchmark cases, which the 159-case set had no equivalent of. The class went 3/6 → 6/6 and the total 162/165 → 165/165, with every other class identical across two variant runs. The +3 headline is the noise floor for `minimax-m3`, so read the class rather than the total: the three misses were the three toilet-paper cases and only those, and the paper towel, detergent and cleaner cases passed before and after.
- A seventh case guards the word "tissues" against the false friend it creates. The corpus holds a "Deep Tissue Fascia Massager", and the model is documented to match gloss text lexically, so the massager is now a `pharmacy` case — `health` held 7/7 over two runs, but the wording is a lexical hazard and the benchmark had nothing that would have caught it.
- The version bump re-tags all 1000 stored entries, not the four paper deals. As in v18, that also re-rolls every deal frozen on the losing side of a coin flip, so expect the live diff to be wider than this entry describes.

## [0.13.11] - 2026-08-09

### Fixed

- Vocabulary version 19 moves points transfers from `travel` to `rewards`, resolving a contradiction between two published rules rather than a misclassification. The instructions said points-valued deals are `rewards`; the `travel` gloss claimed "airline and hotel points transfers". Both shipped, and live tags split exactly as that predicts — Amex→Bonvoy and Avion→Asia miles were `rewards`, Cathay Asia miles was `travel`.
- The clause is relocated, not deleted. v6 excluded power tools from `computing` without naming them anywhere and they stayed split; v12 fixed the mirror case by naming jump starters in `automotive` while dropping them from `tools`. So `rewards` now names transfer bonuses positively, worded to avoid "airline", "hotel" and "credit card" so it cannot re-trigger the v7 leak into `financial` and `travel`.

### Notes

- Evidence is thin. The instruction was already winning 8 times in 9 before the change, so this was another coin flip rather than a systematic error, and transfers went 8/9 → 9/9 over three runs per arm — n=3, not significant. The measurable part was the risk: v8 put the clause in `travel` deliberately to stop `rewards` swallowing it, so the question was whether `travel` would lose deals. It did not — `flights and hotels` held 5/5 in every variant run and totals were identical at mean 158.67 per arm.

## [0.13.10] - 2026-08-09

### Fixed

- Vocabulary version 18 names roadside assistance and auto club memberships in `automotive`. "CAA basic membership for 2" was stored as `financial`, whose gloss names insurance — CAA is a large Canadian insurance brand, so the dealer name outranked the product. Same mechanism as v14, where a dealer literally called TopCashback outranked the instruction to categorise by what the buyer ends up with.
- The model was not confidently wrong here, it was unstable: under v17 the case returned `automotive` on three runs of four and `financial` on the fourth. Production sampled the losing side. Because `selectTopicsNeedingTags` filters on `vv`, a bad roll is frozen until the next version bump — so this release also unfreezes every other deal currently stuck on the wrong side of a coin flip.

### Notes

- This version is justified by mechanism rather than by measurement, and the numbers cannot carry it: there is exactly one such deal in the corpus, so the benefit is n=1 (5/5 with the clause against 3/4 without, nowhere near significant). What was measurable is the risk — `automotive` is the longest gloss in the vocabulary, and v11 measured lengthening the then-longest gloss at −3. That did not repeat: totals held at mean 155.6 over 5 runs against 155.5 over 4. Re-check the CAA case on the next live corpus rather than trusting 5/5.

## [0.13.9] - 2026-08-09

### Fixed

- Vocabulary version 17 settles the flyer rule. The benchmark had no `other` class at all, so the one rule the prompt states outright — a whole store's flyer, weekly sale or photo report goes to `other` — was never tested. Thirteen real flyer, round-up and photo-report posts joined `eval-cases.json`, taking it to 155 cases.
- The failure is recurring rather than one-off: the "Week of ... grocery round up (QUEBEC)" post publishes weekly, and went `other`, `other`, `grocery` across three consecutive weeks of live data.
- The obvious fix was measured and rejected first. Naming "round-up" in the rule was worth +1, inside noise, and both arms went on failing identically — so the missing word was never the cause. It is the word "grocery" in the title outranking the rule, the same mechanism v11 found with "PC Express Pass". The rule now says `other` applies "even when its title names one category or one product".
- Eight runs per arm on the same 155 cases in one session: v16 wording averaged 153.0 (151–155) with the flyer class at 11.1/13 (9–13); v17 averaged 154.6 (153–155) with the class at 12.9/13 (12–13). Read the class line, not the total — the +1.6 aggregate is inside the ±3 noise band and proves nothing. The class effect is +1.75 of 13 at a pooled t of roughly 3.8, and the spread collapses from 9–13 to 12–13, so the rule stops being a coin flip.
- Three runs per arm had looked like cleanly separated distributions (155/155/155 against 153/154/153). That was under-sampling: at eight runs the baseline reaches 13/13 once and the variant drops to 12/13 once. On a model that does not reproduce, three runs justifies measuring more, not claiming a separation.

## [0.13.8] - 2026-08-08

### Fixed

- Vocabulary version 16 names running shoes and athletic footwear in `apparel`. Found by grading the live v15 corpus: 18 footwear deals split 11 `apparel` / 5 `sports` / 2 both, with two adidas running shoes landing on opposite sides in the same run at temperature 0 — the signature of a boundary the glosses do not partition. `apparel` said only "footwear", generic enough to lose an ASICS Novablast to `sports`' "sporting goods and equipment", while `sports` names no footwear at all. Named in `apparel` only, with no exclusion added to `sports`.
- Three of the live misses join `eval-cases.json` (139 → 142 cases, `clothing and shoes` 8 → 11), which could previously see only one of them. Climbing shoes and a golf shoe were left out: those are arguably sporting equipment, and scoring arguable cases measures the labeller.

- Measured with `evaluate.mjs`, both arms on the same 142 cases in one session: 137 → 142, with +4 of that on `clothing and shoes` (7/11 → 11/11). The v15 arm missed four running shoes to `sports`; v16 recovers all four. +5 is outside `minimax-m3`'s ±3 noise band.

### Notes

- v16 saturated the benchmark at 142/142, which is what v17 had to fix before it could measure anything.

## [0.13.7] - 2026-08-06

### Fixed

- Vocabulary version 14 names VPN and antivirus subscriptions in `computing`, taking VPN deals from 1/5 to 5/5. Four of the six in the corpus were tagged `financial` and one `rewards`, because VPNs are almost always advertised as cashback and the dealer is often literally called TopCashback, which outweighed the instruction to categorise a cashback promotion by what the buyer ends up with. This supersedes a note from v6 that recorded `telecom` as the right home for a VPN.

## [0.13.6] - 2026-08-06

### Changed

- Vocabulary version 13 covers what the v12 re-tag exposed. `entertainment` had fallen from 24 deals to 10 on the live corpus while `other` rose from 30 to 54, and the benchmark could not see any of it — it had no `entertainment` cases at all. The gloss now names ebooks, cinema, live sport and theatre tickets, and news subscriptions: the New York Times and the Globe and Mail were sitting in `other`, Kindle deals in `computing`, Cineplex tickets in `dining`.
- `entertainment` also moved from seventeenth in the tag list to seventh. Position matters all the way down the list, not only at the head: its own classes gained 4 and the move cost 2 elsewhere, so ordering is close to zero-sum.
- Together 119 → 126 of 134 (94.0%), on a benchmark grown by the twelve cases these live failures produced.

## [0.13.5] - 2026-08-06

### Added

- New `tools` tag for power and hand tools, split out of `home`. Measured with `evaluate.mjs`: power tools went 3/7 to 7/7. `home` had the longest gloss in the vocabulary and kept losing its own items to `computing` and `electronics`; trimming that gloss was measured first and did nothing, so the cause was never dilution — the category simply had no dedicated claim. Tags render from the tag string, so no UI change was needed.

### Changed

- Vocabulary version 12 settles three more boundaries, each measured against the same session baseline: `automotive` names jump starters, battery chargers and tire inflators, which `tools` had taken; `kids` names LEGO and building sets, which `gaming` had taken via its board-game clause; and `computing` says "computer monitors and portable displays" rather than bare "monitors", which read as screens like TVs. Together 108 → 115 of 122 (94.3%).

## [0.13.4] - 2026-08-06

### Added

- `tools/enricher/evaluate.mjs` measures a vocabulary change against the model without deploying it, scoring 121 hand-labelled deals from `eval-cases.json` in about a minute. It reads the vocabulary from `functions/_shared/enrichment.ts` rather than `/enrichment.json` and never writes tags back, so the loop is edit → score → compare instead of edit → commit → deploy → re-tag 1000 deals. Scoring is per-class, since a single accuracy number hides the trade a change makes.

### Changed

- Vocabulary version 11 tells the model that running on electricity or having a battery does not decide the category. Worth +4 on the benchmark (101 → 105) and the largest single win measured: espresso machines, blenders, cordless drills and car battery chargers were being read as `computing` or `electronics` because they plug in.
- `grocery` now names supermarket pickup passes, PC Express among them. "PC Express Pass" was tagged `computing`, because "PC" reads as personal computer and the dealer field saying "President's Choice" was not enough to override it.

### Fixed

- `classifyTopic` now names the host and provider when a connection fails, instead of a bare `fetch failed`. An unreachable Ollama is the enricher's most common failure.

## [0.13.3] - 2026-08-06

### Fixed

- Vocabulary version 10 restores the v8 tag order, reverting the v9 experiment. v9 answered its question and cost accuracy doing so: moving `computing` off the head of the list collapsed it from 140 to 13 while `electronics` inherited the slot and rose from 116 to 256 (25.8%). Laptops and monitors followed the position rather than the glosses, leaving `computing` — which names them — for `electronics`, which does not.
- The finding is recorded on `TAG_VOCABULARY`: the first slot in the category list is worth roughly 140 deals in 1000 to whichever tag holds it, regardless of gloss text. Order can only aim that bias, not remove it, so `computing` holds the slot as the tag broad enough to absorb it with the least distortion.

## [0.13.2] - 2026-08-06

### Changed

- Vocabulary version 9 moves `computing` from the head of the tag list to last-but-one, and changes nothing else — no gloss, instruction or tag. v8 ranked best of the three versions measured live (largest category 15.2%, `other` 3.0%) but left `computing` at 141 against v6's 111, with power tools at 15 `computing` / 8 `home` and home-gym gear at 4 `gaming` / 0 `sports` — in both cases the category that names the item explicitly lost to one that does not, and in both the winner sat earlier in the list. This isolates position as the variable so the next re-tag answers it.

## [0.13.1] - 2026-08-06

### Fixed

- Vocabulary version 8 removes every exclusion clause from the tag glosses. Measured on the live v7 re-tag of 1000 deals, six of the seven negated phrases pulled in the deals they excluded — 48 in total. `computing` said "not kitchen appliances, power tools or personal-care devices" and took 10, 17 and 3 of them, growing 112 → 197 (19.7%, the share the enricher README defines as disqualifying), while power tools inverted from 13 `home` / 8 `computing` to 20 `computing` / 3 `home`. Each concrete noun now appears in exactly one gloss, and the two `rewards` carve-outs are stated positively in `financial` and `travel` instead.

## [0.13.0] - 2026-08-06

### Added

- New `rewards` tag for deals whose value is points, miles or stored value rather than a product — loyalty promotions, discounted gift cards and fuel-points offers. Measured on 1000 live deals, 29 of these had nowhere to go and sat in `other`, and near-identical Shell/Journie offers split between `automotive` and `other` depending on whether the title said "c/L" or "points".

### Changed

- Vocabulary version 7: the device, tool, tabletop-game and home-gym boundaries are now named explicitly in the glosses, and the prompt says where store-wide flyers belong. Each was measured splitting near-identical deals across categories — one Galaxy Fold 8 pre-order was `computing` while another was `electronics`, and the same cordless drill was both `home` and `computing`.
- Glosses also name eight one-off misses seen on live data: diapers and strollers (`kids`), bakeries and dessert shops (`dining`), aquariums and fish (`pets`), pest control (`home`), car care and jacks (`automotive`), and smart glasses (`electronics`).

### Fixed

- `other` is no longer stored alongside a real tag. It means "nothing else fits", so it cannot be true beside `grocery`; 11 of 1000 entries had it filling the unused second slot. It is normalized away rather than rejected, since a rejected entry would be re-selected and re-rejected on every subsequent run.

## [0.12.0] - 2026-08-05

### Added

- Deals can now be tagged with a closed vocabulary of 17 categories (`computing`, `grocery`, `dining`, `telecom`, …) generated by a local LLM. Tags render as chips beside the deal title and are clickable to filter.
- Tag filtering reuses the existing filter box: `#gaming` matches tags only, a bare `#` matches any tagged deal, and unprefixed terms never search tags.
- New `/enrichment.json` endpoint serving tags, and a protected `/admin/enrich` endpoint for writing them.
- `tools/enricher/` tags untagged deals via Ollama and pushes results back. Cloudflare Workers cannot reach a LAN, so the tagging runs where the model is and initiates both directions.
- The no-JavaScript `/html` view renders tags as plain text.

### Changed

- Tags are stored in their own KV key rather than on topic objects. `/topics.json` is byte-for-byte unchanged, and the app renders normally when no tags exist.

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
