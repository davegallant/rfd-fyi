import { ENRICHMENT_KEY, parseEnrichment } from "./_shared/enrichment";
import { withSecurityHeaders } from "./_shared/responses";

/**
 * Serves stored tags with the *deployed* vocabulary, version and glosses around
 * them, rather than the copy that happened to be written into KV.
 *
 * This route deliberately parses rather than streaming the stored string
 * through. Serving it verbatim meant `vocabulary_version` was whatever the code
 * said when it was last written, so bumping the constant never took effect —
 * entries never looked stale, nothing re-tagged, and nothing rewrote the
 * version. The document is small (tens of KB, one entry per topic), so the
 * parse is cheap; `topics.json` avoids parsing because it is 1000 objects.
 */
export async function onRequestGet({ env }) {
  const enrichment = parseEnrichment(await env.TOPICS_KV.get(ENRICHMENT_KEY));

  return new Response(JSON.stringify(enrichment), {
    headers: withSecurityHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
    }),
  });
}
