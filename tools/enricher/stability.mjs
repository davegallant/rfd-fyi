/**
 * Measures how *reproducible* a classification is, which is a different
 * question from whether it is right.
 *
 * `evaluate.mjs` scores one run against hand labels. This classifies the same
 * deals REPEATS times and reports, per deal, how often the answer agrees with
 * itself. The two diverge: a deal can be stably wrong, or — the case this was
 * built for — right most of the time and wrong on the run that happened to
 * reach production. `minimax-m3` is a reasoning model whose reasoning length
 * varies per call at `temperature: 0`, so its answers are not deterministic and
 * a single run cannot distinguish "the gloss is wrong" from "this one rolled
 * badly".
 *
 * That distinction has teeth because `selectTopicsNeedingTags` filters on `vv`.
 * A deal tagged on a bad roll keeps that tag until the next VOCABULARY_VERSION
 * bump — v18 was found exactly this way, with CAA basic membership stored as
 * `financial` while the model answered `automotive` on three runs of four.
 *
 * What it measured when it was written, against v19:
 *   - 44 benchmark cases from the classes that had been unstable: 43/44 fully
 *     stable over 7 runs. The instability those classes used to show was the
 *     gloss gaps v16-v19 closed, not an irreducible property of the model.
 *   - 40 random live deals: 38/40 fully stable, the other two at p≈0.71.
 *   - Majority-of-3 voting was therefore rejected: it lifts p=0.71 to 0.80
 *     rather than fixing it, worth +0.4pp overall for 3x the model calls.
 * Re-run it before revisiting that decision on a different model — a model
 * that reproduces exactly would make the whole question moot, and one that
 * wobbles more would change the arithmetic.
 *
 * Usage:
 *   # labelled cases — agreement is measured against `expect`
 *   node tools/enricher/stability.mjs --cases tools/enricher/eval-cases.json
 *
 *   # unlabelled live deals — agreement is measured against the modal answer
 *   curl -s https://rfd.davegallant.ca/topics.json > topics.json
 *   node tools/enricher/stability.mjs --corpus topics.json --sample 40
 *
 * Requires Node 22.6+ for the TypeScript import, like `evaluate.mjs`. Note that
 * Node's fetch ignores `http_proxy`; behind one, set `NODE_USE_ENV_PROXY=1` or
 * the run fails with a bare "fetch failed" that looks like an unreachable host.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  TAG_VOCABULARY,
  TAG_GLOSSES,
  CLASSIFIER_INSTRUCTIONS,
  MAX_TAGS_PER_TOPIC,
} from "../../functions/_shared/enrichment.ts";
import { classifyBatch } from "./lib.mjs";
import { resolveProvider } from "./providers.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Probability that majority-of-3 voting lands on an answer the model gives with
 * probability `p`, assuming the three samples are independent.
 *
 * Independence is the assumption worth doubting: the samples share a prompt and
 * a temperature, and only the generated reasoning differs. Treat the result as
 * an upper bound on what voting can buy.
 */
export function majorityOfThree(p) {
  return p ** 3 + 3 * p ** 2 * (1 - p);
}

/** The answer a deal received most often, as a joined tag string. */
export function modalAnswer(answers) {
  const counts = new Map();
  for (const answer of answers) counts.set(answer, (counts.get(answer) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Per-deal agreement across repeated runs.
 *
 * `expect` present means agreement with the hand label, using the same
 * "expected tag appears at all" rule as `scoreCases`. Absent — a live deal with
 * no label — means agreement with the deal's own modal answer, which measures
 * reproducibility rather than correctness.
 */
export function summariseStability(deals, runs) {
  const rows = deals.map((deal, index) => {
    const key = String(index + 1);
    const answers = runs.map((tags) => (tags[key] ?? ["(none)"]).join("+"));
    const modal = modalAnswer(answers);
    const hits = deal.expect
      ? runs.map((tags) => Array.isArray(tags[key]) && tags[key].includes(deal.expect))
      : answers.map((answer) => answer === modal);
    const p = hits.filter(Boolean).length / runs.length;
    return { p, majority: majorityOfThree(p), reference: deal.expect ?? modal, title: deal.title, answers };
  });

  const mean = (pick) => rows.reduce((sum, row) => sum + pick(row), 0) / (rows.length || 1);
  return {
    rows,
    singleShot: mean((row) => row.p),
    majority: mean((row) => row.majority),
    stable: rows.filter((row) => row.p === 1).length,
    unstable: rows.filter((row) => row.p > 0 && row.p < 1).length,
    alwaysWrong: rows.filter((row) => row.p === 0).length,
  };
}

function parseArgs(argv) {
  const args = { cases: null, corpus: null, sample: 0, repeats: 7 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cases") args.cases = argv[++index];
    else if (arg === "--corpus") args.corpus = argv[++index];
    else if (arg === "--sample") args.sample = Number(argv[++index]) || 0;
    else if (arg === "--repeats") args.repeats = Number(argv[++index]) || 7;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.cases && !args.corpus) args.cases = resolve(here, "eval-cases.json");
  return args;
}

function loadDeals(args) {
  if (args.corpus) {
    const topics = JSON.parse(readFileSync(args.corpus, "utf8"));
    const picked = args.sample > 0 ? topics.slice(0, args.sample) : topics;
    return picked.map((topic) => ({ title: topic.title, dealer: topic.Offer?.dealer_name }));
  }
  return JSON.parse(readFileSync(args.cases, "utf8")).cases;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const deals = loadDeals(args);

  const provider = resolveProvider(process.env.ENRICH_PROVIDER || "litellm");
  const options = {
    provider,
    config: {
      baseUrl: process.env.ENRICH_BASE_URL || provider.defaultBaseUrl,
      model: process.env.ENRICH_MODEL || provider.defaultModel,
      apiKey: process.env.ENRICH_API_KEY,
    },
    vocabulary: [...TAG_VOCABULARY],
    glosses: TAG_GLOSSES,
    instructions: CLASSIFIER_INSTRUCTIONS,
    maxTags: MAX_TAGS_PER_TOPIC,
    concurrency: Number(process.env.ENRICH_CONCURRENCY) || 8,
    rotate: false,
  };

  console.log(`${deals.length} deals x ${args.repeats} runs, model ${options.config.model}`);
  const runs = [];
  for (let run = 0; run < args.repeats; run += 1) {
    // Sequential by design: the runs are the measurement, and overlapping them
    // would put far more load on the endpoint than the enricher ever does.
    const { tags } = await classifyBatch(deals.map((deal, index) => ({
      topic_id: index + 1,
      title: deal.title,
      Offer: { dealer_name: deal.dealer },
    })), options);
    runs.push(tags);
    process.stderr.write(`  run ${run + 1}/${args.repeats}\n`);
  }

  const result = summariseStability(deals, runs);
  console.log("\np     maj3   reference    title");
  for (const row of [...result.rows].sort((a, b) => a.p - b.p)) {
    console.log(`${row.p.toFixed(2)}  ${row.majority.toFixed(2)}   ${String(row.reference).padEnd(12)} ${row.title.slice(0, 62)}`);
    if (row.p < 1) console.log(`                            saw: ${[...new Set(row.answers)].join(" | ")}`);
  }

  const pct = (value) => `${(100 * value).toFixed(1)}%`;
  console.log(`\nsingle-shot agreement : ${pct(result.singleShot)}`);
  console.log(`majority-of-3         : ${pct(result.majority)}  (upper bound; assumes independent samples)`);
  console.log(`fully stable          : ${result.stable}/${result.rows.length}`);
  console.log(`unstable              : ${result.unstable}/${result.rows.length}`);
  console.log(`never correct         : ${result.alwaysWrong}/${result.rows.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
