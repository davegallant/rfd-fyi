/**
 * Provider-agnostic helpers for the deal enricher.
 *
 * Wire formats live in providers.mjs; everything here is shared across them.
 * The tag vocabulary is deliberately not defined in this directory — it is
 * fetched from the deployed /enrichment.json so the enricher cannot drift from
 * what /admin/enrich will accept.
 */

/**
 * GETs JSON, failing with the URL and what actually came back.
 *
 * The HTML case is the one that matters: Cloudflare Pages serves the SPA's
 * index.html for unmatched routes with a 200, so hitting an endpoint that has
 * not been deployed yet looks like a JSON syntax error rather than a missing
 * route.
 */
export async function fetchJson(url, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`GET ${url} failed: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}`);
  }

  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(body)
      || (response.headers.get("content-type") ?? "").includes("html");
    if (looksLikeHtml) {
      throw new Error(
        `GET ${url} returned HTML, not JSON — the route is probably not deployed `
        + "(Cloudflare Pages serves index.html for unmatched routes)",
      );
    }
    throw new Error(`GET ${url} returned invalid JSON: ${body.slice(0, 120)}`);
  }
}

/**
 * Writes tags back. An empty batch is a valid auth preflight.
 *
 * /admin/enrich returns 404 rather than 401 on bad auth so it does not
 * advertise itself, which makes a wrong secret indistinguishable from a missing
 * route — hence the explicit hint.
 */
export async function postTags(origin, secret, tags, model, fetchImpl = fetch) {
  const url = `${origin}/admin/enrich`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ model, topics: tags }),
    });
  } catch (error) {
    throw new Error(`POST ${url} failed: ${error.message}`);
  }

  if (response.status === 404) {
    throw new Error(
      `POST ${url} returned 404 — this endpoint answers 404 for a bad or unset `
      + "REFRESH_SECRET, so check the secret is set for this environment "
      + "(Pages preview and production have separate secrets)",
    );
  }
  if (!response.ok) {
    throw new Error(`POST ${url} returned ${response.status}`);
  }

  return response.json();
}

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

/**
 * Progress line for a long backfill: `450/1000 (45%), ~4m 30s left`.
 *
 * The estimate is dropped when it would be meaningless — nothing processed yet,
 * no time elapsed, or already finished — rather than printed as NaN.
 */
export function formatProgress(processed, total, elapsedMs) {
  const percent = total > 0 ? Math.round((processed / total) * 100) : 100;
  const position = `${processed}/${total} (${percent}%)`;

  if (processed >= total || processed === 0 || elapsedMs <= 0) return position;

  const perSecond = processed / (elapsedMs / 1000);
  return `${position}, ~${formatSeconds(Math.round((total - processed) / perSecond))} left`;
}

function formatSeconds(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
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
export async function classifyBatch(topics, { provider, config, vocabulary, glosses, instructions, maxTags, concurrency, fetchImpl }) {
  const results = await mapWithConcurrency(topics, concurrency, (topic) =>
    classifyTopic(topic, { provider, config, vocabulary, glosses, instructions, maxTags, fetchImpl }));

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
export async function classifyTopic(topic, { provider, config, vocabulary, glosses, instructions, maxTags, fetchImpl = fetch }) {
  const { url, headers, body } = provider.buildRequest({ topic, vocabulary, glosses, instructions, maxTags, config });

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
