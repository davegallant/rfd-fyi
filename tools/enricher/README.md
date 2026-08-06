# Deal enricher

Tags deals with an LLM and pushes the results to the deployed app.

It pulls `topics.json` and `enrichment.json`, classifies whatever is untagged,
and posts the result to `/admin/enrich`. If it doesn't run, tags simply go stale
— the deal feed is unaffected.

It runs on a machine that can reach both the model and the internet. Cloudflare
Workers cannot reach a LAN, which is why the tagging pushes results in rather
than being called.

## Requirements

- Node 18+ (uses built-in `fetch`; no dependencies)
- A reachable Ollama
- The `REFRESH_SECRET` already configured on the Pages project
- **The Pages Functions deployed.** `/enrichment.json` and `/admin/enrich` must
  exist, otherwise Cloudflare Pages serves the SPA's `index.html` for those
  routes with a 200 and the enricher reports that it received HTML.

## Providers

| `ENRICH_PROVIDER` | Endpoint | Default model |
| --- | --- | --- |
| `ollama` (default) | `/api/chat` | `qwen2.5:7b-instruct` |

The provider is a pluggable adapter (`providers.mjs`) that owns only the wire
format. Prompt, JSON schema, tag validation, batching, and concurrency are
shared, so adding one is ~25 lines and the table-driven tests pick it up
automatically. Only `ollama` ships today.

### Model choice

`qwen2.5:7b-instruct` (~4.7GB q4) is the default because **`llama3.2:3b` was
measured and failed**. On 55 real RFD deals, 3b put 31% of them in `computing`
— including a BBQ, an espresso machine, a pharmacy promo, and a Zelda game —
and saturated the 2-tag limit on 52 of 55. It was emitting the head of the
category list rather than classifying. 7b assigned `computing` as a primary tag
zero times in 50 deals, used single tags correctly, and got `health`, `gaming`
and `dining` right.

If you want to try a smaller model, re-measure rather than assuming; see
**Judging tag quality** below.

### Ollama on another machine

The enricher does not have to run on the Ollama host — point `ENRICH_BASE_URL`
at it:

```sh
ENRICH_BASE_URL=http://hephaestus:11434 node tools/enricher/enrich.mjs
```

**Ollama listens on `127.0.0.1` by default and will refuse LAN connections**
until you set `OLLAMA_HOST=0.0.0.0` on that machine (`systemctl edit
ollama.service` → `Environment="OLLAMA_HOST=0.0.0.0"`, then restart), and open
port 11434 in its firewall. Check reachability before blaming this script:

```sh
curl http://hephaestus:11434/api/tags
```

That endpoint has no authentication, so only expose it on a network you trust.

For an unattended timer, run the enricher on whichever machine is actually
always on — usually the Ollama host, which then needs no `ENRICH_BASE_URL` at
all. Running it on a laptop means tags only update while the laptop is awake.

## First run

```sh
export REFRESH_SECRET=...          # same value as the Pages secret
export RFD_FYI_ORIGIN=https://rfd.davegallant.ca

# Try 20 deals first and eyeball the tags before a full backfill.
ENRICH_LIMIT=20 node tools/enricher/enrich.mjs
```

Then backfill everything:

```sh
node tools/enricher/enrich.mjs
```

Results flush every 50 topics, so an interrupted run resumes rather than
starting over. Steady state is only a handful of new deals per run.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `REFRESH_SECRET` | *(required)* | Bearer token for `/admin/enrich` |
| `RFD_FYI_ORIGIN` | *(required)* | Deployed app origin, or `http://localhost:8788` for `pages:dev` |
| `ENRICH_PROVIDER` | `ollama` | Only `ollama` ships today |
| `ENRICH_MODEL` | `qwen2.5:7b-instruct` | Model to classify with |
| `ENRICH_BASE_URL` | `http://localhost:11434` | Ollama host |
| `ENRICH_CONCURRENCY` | `1` | Requests in flight (one GPU gains nothing from more) |
| `ENRICH_FLUSH_EVERY` | `50` | Topics per write back |
| `ENRICH_LIMIT` | `0` (no limit) | Cap topics per run, for trying things out |

The vocabulary, the glosses **and the prompt** are deliberately not configured
here. All three are fetched from the server's `/enrichment.json`, so this script
cannot drift from what `/admin/enrich` will accept. To change any of them, edit
`functions/_shared/enrichment.ts` (`TAG_VOCABULARY`, `TAG_GLOSSES`,
`CLASSIFIER_INSTRUCTIONS`), bump `VOCABULARY_VERSION`, and redeploy — the next
run re-tags every stored entry automatically.

`providers.mjs` keeps a fallback prompt used only when the server publishes
none, e.g. against an older deployment.

## Iterating without deploying

`evaluate.mjs` measures a vocabulary change against the model **before** it goes
anywhere near Cloudflare. It reads the vocabulary from
`functions/_shared/enrichment.ts` — the file you are editing — instead of from
`/enrichment.json`, and never writes tags back, so the only thing it talks to is
Ollama.

```sh
# Score the current glosses against 121 hand-labelled deals.
node tools/enricher/evaluate.mjs

# Save a baseline, change a gloss, then measure what moved.
node tools/enricher/evaluate.mjs --out before.json
$EDITOR functions/_shared/enrichment.ts
node tools/enricher/evaluate.mjs --compare before.json
```

Output is per-class, because a single accuracy number hides the trade a change
actually made:

```
class                   expect        score
power tools             home          6/7
video games             gaming        4/6
...
vs before.json:
  power tools              3 -> 6  +3
  video games              6 -> 4  -2
```

`eval-cases.json` holds real RFD titles with the category their gloss implies.
Only unambiguous deals are in it — a gaming laptop or a bank promo that pays out
in AirPods was dropped, because scoring arguable cases measures the labeller
rather than the model. Add cases as you find real misclassifications; that is
how the set earns its keep.

Other flags:

| Flag | Purpose |
| --- | --- |
| `--rotate` | Rotate the category list per topic (see below) |
| `--corpus topics.json` | Also classify a full snapshot and print distribution shape |
| `--limit N` | First N cases only, for a quick smoke test |

`--corpus` wants a saved `/topics.json`; fetch one with
`curl -o topics.json https://rfd.davegallant.ca/topics.json`. It is gitignored.
A full 1000-deal run takes a while — the labelled cases are the fast loop.

Requires Node 22.6+, which imports the TypeScript source directly. Everything
else here still runs on Node 18.

### The head-slot bias, and `--rotate`

**Whichever tag is listed first over-attracts by roughly 140 deals in 1000,
regardless of what any gloss says.** v9 measured this by moving `computing` from
first to last-but-one and changing nothing else: `computing` fell 140 → 13 while
`electronics`, which inherited the slot, rose 116 → 256. Laptops and monitors
left `computing`, whose gloss names them, for `electronics`, whose gloss does
not.

Reordering can only aim that bias, since some tag must be first. `--rotate`
spreads it instead, seeding the rotation with the topic id so each tag leads for
about one deal in eighteen and a given deal still classifies the same way on
every run.

**It was measured and it does not work: 101 → 93.** The bias does not spread
across eighteen tags, it moves to `electronics`, which wins anything electrical
once `computing` is no longer reliably first — monitors fell 5/8 → 1/8. Moving
`home` to the head instead was equally bad (-8): power tools reached 7/7 while
monitors went 6/8 → 0/8. The flag stays for re-testing against a different
model, but it is off, and the head slot remains an open problem.

### Two runs, then trust the number

Ollama at `temperature: 0` reproduces exactly between back-to-back runs, but not
across a model reload — the same prompt scored 107 once and 105 twice. **Treat a
delta of ±2 as noise, and always re-measure the baseline in the same session as
the variant**, which `--out`/`--compare` makes cheap:

```sh
git stash && node tools/enricher/evaluate.mjs --out base.json && git stash pop
node tools/enricher/evaluate.mjs --compare base.json
```

## Judging tag quality

Each entry records the model that produced it, so a model change is measurable
rather than a matter of opinion:

```sh
node -e '(async () => {
  const o = process.env.RFD_FYI_ORIGIN || "http://localhost:8788";
  const [t, e] = await Promise.all([
    fetch(o + "/topics.json").then((r) => r.json()),
    fetch(o + "/enrichment.json").then((r) => r.json()),
  ]);
  const by = {};
  for (const [id, v] of Object.entries(e.topics)) {
    const x = t.find((z) => String(z.topic_id) === id);
    (by[v.m ?? "unknown"] ??= []).push([v.tags.join(","), x?.Offer?.dealer_name ?? "-", x?.title]);
  }
  for (const [model, rows] of Object.entries(by)) {
    const hist = {};
    for (const [tags] of rows) hist[tags.split(",")[0]] = (hist[tags.split(",")[0]] ?? 0) + 1;
    console.log("\n== " + model + " (" + rows.length + ") ==", JSON.stringify(hist));
    for (const [tags, dealer, title] of rows) {
      console.log(tags.padEnd(24), "|", String(dealer).padEnd(18), "|", title);
    }
  }
})()'
```

What to look for:

- **One category dominating** (say >25% of entries) usually means the model is
  emitting the head of the list rather than classifying. That is what disqualified
  `llama3.2:3b`.
- **Nearly every entry carrying two tags** means the model is filling the schema
  to `maxItems` instead of choosing. Most deals should have one.
- **A high `other` rate** on an otherwise sane model points at a gap in the
  vocabulary rather than a bad model — that is how `dining` and `pets` were found.
- **Nonsense inside a small category.** A missing category does not reliably
  show up as `other`; the model puts the deal somewhere nearby and looks
  confident. `sports` was found because golf balls and a camping tent were
  tagged `pets`. Read the members of your smallest categories, not just the
  histogram.

## Adding a provider

Add an object to `PROVIDERS` in `providers.mjs` with `buildRequest()` and
`extractContent()`. Prompt, schema, validation, batching, and concurrency are
shared, so an adapter is about 25 lines. The table-driven tests in
`providers.test.mjs` run against every registered provider automatically.

## Running it on a timer

systemd user units, every 15 minutes:

```ini
# ~/.config/systemd/user/rfd-enrich.service
[Unit]
Description=Tag RFD deals
After=network-online.target

[Service]
Type=oneshot
Environment=RFD_FYI_ORIGIN=https://rfd.davegallant.ca
EnvironmentFile=%h/.config/rfd-enrich.env
ExecStart=/usr/bin/node %h/src/rfd-fyi/tools/enricher/enrich.mjs
```

```ini
# ~/.config/systemd/user/rfd-enrich.timer
[Unit]
Description=Tag RFD deals every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
```

Keep `REFRESH_SECRET=...` in `~/.config/rfd-enrich.env` (mode `600`) rather
than in the unit file, then:

```sh
systemctl --user enable --now rfd-enrich.timer
journalctl --user -u rfd-enrich -f
```

The script exits non-zero when the provider or the endpoint fails — with the
HTTP status and response body in the message — so failures surface in
`journalctl` rather than passing silently.
