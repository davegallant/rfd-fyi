/**
 * Offline evaluator: measures a vocabulary change without deploying it.
 *
 * Until this existed, judging a gloss edit meant editing enrichment.ts,
 * committing, deploying Pages, re-tagging 1000 deals, and diffing the result —
 * twenty minutes and a production change per experiment, which is why v7
 * shipped a dozen edits at once and could not be untangled when it regressed.
 *
 * The loop is offline because the only thing that needed the server was the
 * vocabulary: /topics.json is read-only and /admin/enrich is for writing tags
 * back, which an evaluation never does. So this reads the vocabulary straight
 * from functions/_shared/enrichment.ts — the file you are editing — and talks
 * only to the model.
 *
 * Usage:
 *   node tools/enricher/evaluate.mjs                      # score the cases
 *   node tools/enricher/evaluate.mjs --rotate             # with list rotation
 *   node tools/enricher/evaluate.mjs --out before.json
 *   node tools/enricher/evaluate.mjs --rotate --compare before.json
 *   node tools/enricher/evaluate.mjs --corpus topics.json # distribution shape
 *
 * Requires Node 22.6+, which imports the TypeScript source directly.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  CLASSIFIER_INSTRUCTIONS,
  MAX_TAGS_PER_TOPIC,
  TAG_GLOSSES,
  TAG_VOCABULARY,
  VOCABULARY_VERSION,
} from "../../functions/_shared/enrichment.ts";
import { classifyBatch, formatProgress } from "./lib.mjs";
import { resolveProvider } from "./providers.mjs";
import { compareScores, scoreCases, summarise } from "./scoring.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { rotate: false, out: null, compare: null, corpus: null, limit: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--rotate") args.rotate = true;
    else if (arg === "--out") args.out = argv[++index];
    else if (arg === "--compare") args.compare = argv[++index];
    else if (arg === "--corpus") args.corpus = argv[++index];
    else if (arg === "--limit") args.limit = Number(argv[++index]) || 0;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Cases carry no topic id, but rotation is seeded by one. The index is used so
 * a case gets a stable rotation across runs, which is what makes two
 * evaluations comparable.
 */
function casesAsTopics(cases) {
  return cases.map((testCase, index) => ({
    topic_id: index,
    title: testCase.title,
    Offer: testCase.dealer ? { dealer_name: testCase.dealer } : undefined,
  }));
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printScore(score) {
  console.log("\nclass".padEnd(24) + "expect".padEnd(14) + "score");
  for (const entry of score.classes) {
    const ratio = `${entry.correct}/${entry.total}`;
    console.log(entry.name.padEnd(24) + entry.expect.padEnd(14) + ratio);
  }
  console.log("\n" + "total".padEnd(24) + "".padEnd(14) + `${score.correct}/${score.total} (${percent(score.accuracy)})`);

  const misses = score.classes.flatMap((entry) => entry.misses.map((miss) => ({ ...miss, expect: entry.expect })));
  if (misses.length > 0) {
    console.log("\nmisses:");
    for (const miss of misses) {
      console.log(`  want ${miss.expect.padEnd(12)} got ${miss.got.padEnd(20)} ${miss.title.slice(0, 66)}`);
    }
  }
}

function printSummary(summary, label) {
  console.log(`\n${label} (${summary.count} deals)`);
  if (summary.largest) {
    console.log(`  largest category   ${summary.largest.tag} ${percent(summary.largest.share)}`);
  }
  console.log(`  other rate         ${percent(summary.otherRate)}`);
  console.log(`  two-tag rate       ${percent(summary.multiTagRate)}`);
  console.log(`  other as companion ${summary.otherAsCompanion}`);
  console.log("  " + summary.ranked.map(([tag, count]) => `${tag}:${count}`).join("  "));
}

async function classify(topics, options) {
  const started = Date.now();
  const results = [];

  // Batched only so progress is visible on a 121-case run; the provider is
  // called once per topic either way.
  for (let index = 0; index < topics.length; index += 20) {
    const batch = topics.slice(index, index + 20);
    const { tags } = await classifyBatch(batch, options);
    for (const topic of batch) results.push(tags[String(topic.topic_id)] ?? null);
    console.log(`  ${formatProgress(results.length, topics.length, Date.now() - started)}`);
  }

  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = resolveProvider(process.env.ENRICH_PROVIDER || "ollama");
  const config = {
    baseUrl: process.env.ENRICH_BASE_URL || provider.defaultBaseUrl,
    model: process.env.ENRICH_MODEL || provider.defaultModel,
  };

  const options = {
    provider,
    config,
    vocabulary: [...TAG_VOCABULARY],
    glosses: TAG_GLOSSES,
    instructions: CLASSIFIER_INSTRUCTIONS,
    maxTags: MAX_TAGS_PER_TOPIC,
    concurrency: Number(process.env.ENRICH_CONCURRENCY) || provider.defaultConcurrency,
    rotate: args.rotate,
  };

  console.log(`vocabulary v${VOCABULARY_VERSION}, ${TAG_VOCABULARY.length} tags, model ${config.model}`);
  console.log(`first tag in list: ${TAG_VOCABULARY[0]}${args.rotate ? " (rotating per topic)" : ""}`);

  const { cases } = readJson(resolve(here, "eval-cases.json"));
  const selected = args.limit > 0 ? cases.slice(0, args.limit) : cases;

  console.log(`\nclassifying ${selected.length} labelled cases`);
  const tagsList = await classify(casesAsTopics(selected), options);
  const score = scoreCases(selected, tagsList);
  printScore(score);

  if (args.corpus) {
    const topics = readJson(args.corpus);
    console.log(`\nclassifying ${topics.length} corpus deals for distribution shape`);
    const corpusTags = await classify(topics, options);
    printSummary(summarise(corpusTags), "corpus");
  }

  if (args.compare) {
    const previous = readJson(args.compare);
    const delta = compareScores(previous.score, score);
    console.log(`\nvs ${args.compare}:`);
    for (const entry of delta.classes) {
      const mark = entry.delta > 0 ? `+${entry.delta}` : `${entry.delta}`;
      if (entry.delta !== 0) console.log(`  ${entry.name.padEnd(24)} ${entry.before} -> ${entry.after}  ${mark}`);
    }
    console.log(`  ${"total".padEnd(24)} ${delta.before} -> ${delta.after}  ${delta.delta > 0 ? "+" : ""}${delta.delta}`);
  }

  if (args.out) {
    writeFileSync(args.out, JSON.stringify({
      vocabulary_version: VOCABULARY_VERSION,
      model: config.model,
      rotate: args.rotate,
      score,
    }, null, 2));
    console.log(`\nwrote ${args.out}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
