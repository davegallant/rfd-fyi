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

import { chunk, classifyBatch, fetchJson, formatProgress, postTags, selectUntagged } from "./lib.mjs";
import { resolveProvider } from "./providers.mjs";

const origin = (process.env.RFD_FYI_ORIGIN || "").replace(/\/$/, "");
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

  if (!origin) {
    throw new Error("RFD_FYI_ORIGIN is required (e.g. https://rfd.davegallant.ca or http://localhost:8788)");
  }
  if (!secret) throw new Error("REFRESH_SECRET is required");

  const concurrency = Number(process.env.ENRICH_CONCURRENCY || provider.defaultConcurrency);
  return { provider, config, concurrency };
}

async function flush(tags, model, progress) {
  if (Object.keys(tags).length === 0) return;

  const body = await postTags(origin, secret, tags, model);
  console.log(`  flushed ${body.accepted} tagged, ${body.stored} stored — ${progress}`);
  for (const entry of body.rejected ?? []) {
    console.warn(`  rejected ${entry.topic_id}: ${entry.reason}`);
  }
}

async function main() {
  const { provider, config, concurrency } = loadProvider();

  const [topics, enrichment] = await Promise.all([
    fetchJson(`${origin}/topics.json`),
    fetchJson(`${origin}/enrichment.json`),
  ]);

  const { vocabulary, glosses, instructions, max_tags: maxTags } = enrichment;
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

  // Prove the secret works before spending GPU time on a batch we cannot write.
  await postTags(origin, secret, {}, config.model);

  const startedAt = Date.now();
  let tagged = 0;
  let skipped = 0;
  let processed = 0;

  for (const batch of chunk(pending, flushEvery)) {
    const result = await classifyBatch(batch, {
      provider, config, vocabulary, glosses, instructions, maxTags, concurrency,
    });

    tagged += Object.keys(result.tags).length;
    skipped += result.skipped.length;
    processed += batch.length;
    for (const topic of result.skipped) {
      console.warn(`  no usable tags for ${topic.topic_id}: ${topic.title}`);
    }

    await flush(result.tags, config.model, formatProgress(processed, pending.length, Date.now() - startedAt));
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`done: ${tagged} tagged, ${skipped} skipped, ${seconds}s`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
