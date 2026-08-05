import {
  ENRICHMENT_KEY,
  mergeEnrichment,
  parseEnrichment,
  sanitizeModelName,
  validateTagBatch,
} from "../_shared/enrichment";
import { withSecurityHeaders } from "../_shared/responses";
import { readTopics } from "../_shared/topics";

/**
 * Receives tags from the local Ollama enricher.
 *
 * Invalid entries are dropped and reported rather than failing the batch, so a
 * single hallucinated tag does not discard the rest of a batch of real work.
 */
export async function onRequestPost({ request, env }) {
  const expectedSecret = env.REFRESH_SECRET;
  const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response("not found", { status: 404, headers: withSecurityHeaders() });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const { accepted, rejected } = validateTagBatch(payload.topics);
  const model = sanitizeModelName(payload.model);

  const knownTopicIds = (await readTopics(env)).map((topic) => String(topic.topic_id));
  const existing = parseEnrichment(await env.TOPICS_KV.get(ENRICHMENT_KEY));
  const merged = mergeEnrichment(existing, accepted, knownTopicIds, model);

  await env.TOPICS_KV.put(ENRICHMENT_KEY, JSON.stringify(merged));

  return jsonResponse({
    accepted: Object.keys(accepted).length,
    rejected,
    stored: Object.keys(merged.topics).length,
  }, 200);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withSecurityHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    }),
  });
}
