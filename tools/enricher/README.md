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
- A reachable model endpoint — the LiteLLM proxy on hephaestus by default, or
  an Ollama
- **A proxy that publishes the default model name.** `model_name` in LiteLLM's
  `model_list` is arbitrary config; this expects it to be literally
  `minimax-m3`. If yours is called something else, either rename it there or set
  `ENRICH_MODEL` — the value is stored on every entry as its provenance, so
  prefer the rename and keep the two ends comparable. `curl
  http://hephaestus:4000/v1/models` lists what is actually published.
- The `REFRESH_SECRET` already configured on the Pages project
- **The Pages Functions deployed.** `/enrichment.json` and `/admin/enrich` must
  exist, otherwise Cloudflare Pages serves the SPA's `index.html` for those
  routes with a 200 and the enricher reports that it received HTML.

## Providers

| `ENRICH_PROVIDER` | Endpoint | Default model |
| --- | --- | --- |
| `litellm` (default) | `/chat/completions` | `minimax-m3` |
| `ollama` | `/api/chat` | `qwen2.5:7b-instruct` |

The provider is a pluggable adapter (`providers.mjs`) that owns only the wire
format. Prompt, JSON schema, tag validation, batching, and concurrency are
shared, so adding one is ~25 lines and the table-driven tests pick it up
automatically.

`litellm` speaks plain OpenAI chat-completions, so the adapter is not really
LiteLLM-specific — point `ENRICH_BASE_URL` at any compatible endpoint and it
works. The base URL includes `/v1`, the same value an OpenAI client would take.

`litellm` sends `ENRICH_API_KEY` as a bearer token when one is set and omits the
header entirely when it isn't, so a proxy on a trusted LAN needs no key.

**It sends no `response_format`, which was measured rather than assumed.** Across
the 23 models published on hephaestus the field never once changed an answer: the
DeepSeek family rejects it with a 400 (`This response_format type is unavailable
now`), MiniMax and MiMo accept it and ignore it — `minimax-m3` answered the bare
string `tools` under a strict `json_schema` with `finish_reason: stop` — and the
models that return clean JSON return it with or without the field. It is a 400
risk that buys nothing. The adapter asks for the envelope in prose instead, and
`parseTags` does the real enforcement: it validates against the vocabulary,
drops invented tags, and caps at `maxTags` for every provider alike.

That prose directive is an output-shape instruction, the OpenAI-shaped
equivalent of the `format` field the ollama adapter sends. It says nothing about
*which* tag to pick, so it cannot drift from `CLASSIFIER_INSTRUCTIONS`, and it
lives in the litellm adapter only — Ollama's `format` genuinely constrains
output, so adding prose there would perturb a baseline for no gain.

The adapter reads `choices[0].message.content` and falls back to the first tool
call's arguments, since a proxy that emulates structured output with tool
calling leaves `content` null.

### Model choice

`minimax-m3` is the default, chosen by measurement against all 139 labelled
cases:

| Model | Score | Wall clock | vs `--rotate` |
| --- | --- | --- | --- |
| `minimax-m3` | **135–138/139 (97.1–99.3%)** | 38s | −3 |
| `gpt-5-6-luna` | 137/139 (98.6%) | 104s | −2 |
| `deepseek-v4-flash` | 134/139 (96.4%) | 47s | — |
| `mimo-v2-5` | 32/139 (23.0%) | 126s | — |

(139 cases at `ENRICH_CONCURRENCY=8`.) `minimax-m3` ties for the best score at a
third of the runner-up's latency, and its misses are substantive disagreements
rather than failures — most often running shoes, which it reads as `sports`
where the labels say `apparel`. `mimo-v2-5` is not weak so much as unreliable:
it returns clean JSON on one call and empty content on the next.

**`minimax-m3` is a reasoning model, and `max_tokens` is load-bearing because of
it.** It emits `reasoning_content` whose length varies wildly for identical
input at `temperature: 0` — one deal cost 42, 87 and then 256 tokens on three
consecutive runs. When the budget runs out the request still returns 200, with
`finish_reason: "length"` and an empty `content`, so the topic is silently
skipped rather than failing loudly; at temperature 0 it would then be skipped on
every future run too. Measured over 80 live deals, a 256 ceiling truncated 9 of
them and 1024 truncated none, against a median usage of 45 tokens and an
observed maximum of 544. Hence `max_tokens: 1024` in the adapter. If you switch
to another reasoning model, re-measure this before trusting the default.

Most of the remaining models on the proxy are not viable here. The Qwen `plus`
and `max` tiers are reasoning models that narrate before answering —
`qwen3-5-plus` spent 29s and 1651 output tokens on a single two-tag answer,
and `qwen3-7-plus`, `qwen3-7-max` and `qwen3-8-max` time out entirely. That is
disqualifying on efficiency whatever they would score. The `glm-*`, `grok-4-5`
and `kimi-*` entries return `ServiceUnavailable` or `BadRequestError` for every
request, which looks like proxy configuration rather than a model verdict.

`ollama` with `qwen2.5:7b-instruct` (~4.7GB q4) remains the offline option, and
is the default for that provider because **`llama3.2:3b` was measured and
failed**. On 55 real RFD deals, 3b put 31% of them in `computing` — including a
BBQ, an espresso machine, a pharmacy promo, and a Zelda game — and saturated the
2-tag limit on 52 of 55. It was emitting the head of the category list rather
than classifying. 7b assigned `computing` as a primary tag zero times in 50
deals, used single tags correctly, and got `health`, `gaming` and `dining` right.

Whichever model you try, re-measure rather than assuming — `evaluate.mjs` scores
a model change against 139 labelled deals without touching production. See
**Iterating without deploying** below, and **Judging tag quality** for reading
what a change did to live tags.

### Pointing at another machine

The enricher does not have to run on the model host — point `ENRICH_BASE_URL`
at it:

```sh
ENRICH_PROVIDER=ollama ENRICH_BASE_URL=http://hephaestus:11434 \
  node tools/enricher/enrich.mjs
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
always on — hephaestus, which serves the proxy, is the obvious one. Running it
on a laptop means tags only update while the laptop is awake.

## First run

```sh
export REFRESH_SECRET=...          # same value as the Pages secret
export RFD_FYI_ORIGIN=https://rfd.davegallant.ca
export ENRICH_API_KEY=...          # LiteLLM virtual key, if the proxy needs one

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
| `ENRICH_PROVIDER` | `litellm` | `litellm` or `ollama` |
| `ENRICH_API_KEY` | *(unset)* | Bearer token for the proxy; unset sends no header |
| `ENRICH_MODEL` | per provider | `minimax-m3` / `qwen2.5:7b-instruct` |
| `ENRICH_BASE_URL` | per provider | `http://hephaestus:4000/v1` / `http://localhost:11434` |
| `ENRICH_CONCURRENCY` | per provider | Requests in flight — `4` hosted, `1` for Ollama (one GPU gains nothing from more) |
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
the model.

```sh
# Score the current glosses against 139 hand-labelled deals.
node tools/enricher/evaluate.mjs

# Save a baseline, change a gloss, then measure what moved.
node tools/enricher/evaluate.mjs --out before.json
$EDITOR functions/_shared/enrichment.ts
node tools/enricher/evaluate.mjs --compare before.json
```

It reads `ENRICH_PROVIDER` like the enricher does, so the same two commands
compare two models rather than two glosses:

```sh
ENRICH_PROVIDER=ollama node tools/enricher/evaluate.mjs --out qwen.json
node tools/enricher/evaluate.mjs --compare qwen.json
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

**Every number in this section was measured against `qwen2.5:7b-instruct`, and
the bias is a property of the model rather than of the vocabulary.** It is much
weaker on `minimax-m3`: rotating costs it 3 points against qwen's 8, and
`gpt-5-6-luna` loses 2 — both at or inside the noise band, where qwen's loss was
clearly outside it. The fixed order still wins on every model measured, so the
flag stays off, but the head slot is no longer the dominant force it was. Re-run
both arms when you change model rather than assuming either result transfers.

### Two runs, then trust the number

Ollama at `temperature: 0` reproduces exactly between back-to-back runs, but not
across a model reload — the same prompt scored 107 once and 105 twice. **A
reasoning model does not reproduce at all**: four back-to-back full runs of
`minimax-m3` scored 135, 136, 137 and 138 with nothing changed between them,
because the reasoning it generates before answering varies per call. **Treat a
delta of ±3 as noise on this model, ±2 on Ollama, and always re-measure the
baseline in the same session as the variant**, which `--out`/`--compare` makes
cheap:

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

systemd user units, every 30 minutes. A run with nothing to tag costs two GETs
and exits before any model call or auth preflight (`enrich.mjs`, `if
(pending.length === 0) return;`), so a frequent timer is close to free — the
refresh Worker runs every 10 minutes, so that is the floor on how fresh tags can
be:

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
Description=Tag RFD deals every 30 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min
Persistent=true

[Install]
WantedBy=timers.target
```

Keep `REFRESH_SECRET=...` and `ENRICH_API_KEY=...` in `~/.config/rfd-enrich.env`
(mode `600`) rather than in the unit file, then:

```sh
systemctl --user enable --now rfd-enrich.timer
journalctl --user -u rfd-enrich -f
```

The script exits non-zero when the provider or the endpoint fails — with the
HTTP status and response body in the message — so failures surface in
`journalctl` rather than passing silently.

Any provider error does the same — it stops the run rather than quietly writing
a partial batch, which loses up to `ENRICH_FLUSH_EVERY` classifications; the
next timer tick picks them up again. With a self-hosted proxy the likely causes
are an upstream provider being unavailable or a model alias disappearing from
`model_list`, not a rate limit. If a 429 does appear, lower
`ENRICH_CONCURRENCY` before adding retries.
