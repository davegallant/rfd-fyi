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
export RFD_FYI_ORIGIN=https://rfd.fyi

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
| `RFD_FYI_ORIGIN` | `https://rfd.fyi` | Deployed app origin |
| `ENRICH_PROVIDER` | `ollama` | Only `ollama` ships today |
| `ENRICH_MODEL` | `qwen2.5:7b-instruct` | Model to classify with |
| `ENRICH_BASE_URL` | `http://localhost:11434` | Ollama host |
| `ENRICH_CONCURRENCY` | `1` | Requests in flight (one GPU gains nothing from more) |
| `ENRICH_FLUSH_EVERY` | `50` | Topics per write back |
| `ENRICH_LIMIT` | `0` (no limit) | Cap topics per run, for trying things out |

The tag vocabulary is deliberately **not** configured here. It is fetched from
the server's `/enrichment.json`, so this script cannot drift from what
`/admin/enrich` will accept. To change the tags, edit
`functions/_shared/enrichment.ts` (both `TAG_VOCABULARY` and `TAG_GLOSSES`),
bump `VOCABULARY_VERSION`, and redeploy — the next run re-tags every stored
entry automatically.

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
Environment=RFD_FYI_ORIGIN=https://rfd.fyi
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
