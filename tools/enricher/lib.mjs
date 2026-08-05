/**
 * Provider-agnostic helpers for the deal enricher.
 *
 * Wire formats live in providers.mjs; everything here is shared across them.
 * The tag vocabulary is deliberately not defined in this directory — it is
 * fetched from the deployed /enrichment.json so the enricher cannot drift from
 * what /admin/enrich will accept.
 */

/** Topics with no entry, or tagged under a superseded vocabulary version. */
export function selectUntagged(topics, enrichment) {
  const current = enrichment.vocabulary_version;
  return topics.filter((topic) => {
    const entry = enrichment.topics?.[String(topic.topic_id)];
    return !entry || entry.vv < current;
  });
}

/**
 * Extracts tags from the model's answer, dropping anything the server would
 * reject. Returns null when nothing usable survives, so the caller can skip the
 * topic rather than write a bad tag.
 */
export function parseTags(content, vocabulary, maxTags) {
  const parsed = parseJson(content);
  if (!Array.isArray(parsed?.tags)) return null;

  const allowed = new Set(vocabulary);
  const tags = [];
  for (const tag of parsed.tags) {
    if (!allowed.has(tag) || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length === maxTags) break;
  }

  return tags.length > 0 ? tags : null;
}

function parseJson(content) {
  if (typeof content !== "string") return null;

  try {
    return JSON.parse(content);
  } catch {
    // Schema-constrained providers always return bare JSON, but a local model
    // behind an OpenAI-compatible shim may wrap it in prose.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving input
 * order in the results. Serial is right for a single local GPU; a hosted API
 * wants several in flight or a 1000-item backfill crawls.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = Array.from({ length: items.length });
  let next = 0;

  async function drain() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
  return results;
}

export function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

/**
 * Classifies a batch, returning tags keyed by topic id (as strings, matching
 * the enrichment document) plus the topics the model gave nothing usable for.
 *
 * A provider failure propagates: a rate limit or bad key should stop the run,
 * not quietly write a partial batch.
 */
export async function classifyBatch(topics, { provider, config, vocabulary, glosses, maxTags, concurrency, fetchImpl }) {
  const results = await mapWithConcurrency(topics, concurrency, (topic) =>
    classifyTopic(topic, { provider, config, vocabulary, glosses, maxTags, fetchImpl }));

  const tags = {};
  const skipped = [];
  results.forEach((result, index) => {
    if (result) tags[String(topics[index].topic_id)] = result;
    else skipped.push(topics[index]);
  });

  return { tags, skipped };
}

/**
 * Classifies one topic through the given provider.
 *
 * Throws on transport/HTTP failure so a misconfigured run stops loudly rather
 * than quietly tagging nothing; returns null when the call succeeded but the
 * model produced no usable tags.
 */
export async function classifyTopic(topic, { provider, config, vocabulary, glosses, maxTags, fetchImpl = fetch }) {
  const { url, headers, body } = provider.buildRequest({ topic, vocabulary, glosses, maxTags, config });

  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`${provider.name} returned ${response.status} for topic ${topic.topic_id}: ${detail}`);
  }

  return parseTags(provider.extractContent(await response.json()), vocabulary, maxTags);
}
