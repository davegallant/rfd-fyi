#!/usr/bin/env node
/**
 * Tags RedFlagDeals topics with an LLM and pushes the results to the deployed app.
 *
 * Provider-agnostic: point ENRICH_PROVIDER at a local Ollama, Claude, or
 * anything OpenAI-compatible. Runs wherever the model is reachable — for a
 * local model that must be your own machine, since Cloudflare Workers cannot
 * reach a LAN.
 *
 * Usage:
 *   REFRESH_SECRET=... node tools/enricher/enrich.mjs
 */

import { chunk, classifyBatch, selectUntagged } from "./lib.mjs";
import { resolveProvider } from "./providers.mjs";

const origin = (process.env.RFD_FYI_ORIGIN || "https://rfd.fyi").replace(/\/$/, "");
const secret = process.env.REFRESH_SECRET;
/** Flush partway through so an interrupted backfill resumes instead of restarting. */
const flushEvery = Number(process.env.ENRICH_FLUSH_EVERY || 50);
const limit = Number(process.env.ENRICH_LIMIT || 0);

/** Resolved inside main() so a bad provider name reports cleanly instead of throwing at import. */
function loadProvider() {
  const provider = resolveProvider(process.env.ENRICH_PROVIDER || "ollama");
  const config = {
    model: process.env.ENRICH_MODEL || provider.defaultModel,
    baseUrl: process.env.ENRICH_BASE_URL || provider.defaultBaseUrl,
  };

  if (!secret) throw new Error("REFRESH_SECRET is required");

  const concurrency = Number(process.env.ENRICH_CONCURRENCY || provider.defaultConcurrency);
  return { provider, config, concurrency };
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
  return response.json();
}

async function flush(tags, model) {
  if (Object.keys(tags).length === 0) return;

  const response = await fetch(`${origin}/admin/enrich`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ model, topics: tags }),
  });

  if (!response.ok) {
    throw new Error(`POST /admin/enrich returned ${response.status}`);
  }

  const body = await response.json();
  console.log(`  flushed ${body.accepted} tagged, ${body.stored} stored`);
  for (const entry of body.rejected ?? []) {
    console.warn(`  rejected ${entry.topic_id}: ${entry.reason}`);
  }
}

async function main() {
  const { provider, config, concurrency } = loadProvider();

  const [topics, enrichment] = await Promise.all([
    getJson(`${origin}/topics.json`),
    getJson(`${origin}/enrichment.json`),
  ]);

  const { vocabulary, glosses, max_tags: maxTags } = enrichment;
  if (!Array.isArray(vocabulary) || vocabulary.length === 0) {
    throw new Error("server published no vocabulary; is /enrichment.json deployed?");
  }

  let pending = selectUntagged(topics, enrichment);
  if (limit > 0) pending = pending.slice(0, limit);

  console.log(
    `${topics.length} topics, ${pending.length} need tags `
    + `(${provider.name}/${config.model}, concurrency ${concurrency})`,
  );
  if (pending.length === 0) return;

  const startedAt = Date.now();
  let tagged = 0;
  let skipped = 0;

  for (const batch of chunk(pending, flushEvery)) {
    const result = await classifyBatch(batch, {
      provider, config, vocabulary, glosses, maxTags, concurrency,
    });

    tagged += Object.keys(result.tags).length;
    skipped += result.skipped.length;
    for (const topic of result.skipped) {
      console.warn(`  no usable tags for ${topic.topic_id}: ${topic.title}`);
    }

    await flush(result.tags, config.model);
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`done: ${tagged} tagged, ${skipped} skipped, ${seconds}s`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
