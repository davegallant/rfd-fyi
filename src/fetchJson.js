/**
 * Sentinel returned when the server answers 304 Not Modified.
 *
 * Stable URLs let the browser revalidate its cached ETag instead of
 * transferring the body again. Note a 304 is not `response.ok`, so without
 * this branch every unchanged background poll would surface as a load error.
 */
export const NOT_MODIFIED = Symbol("not-modified");

/**
 * Fetch JSON with a timeout.
 *
 * Resolves to `{ data, etag }` on 200, or `NOT_MODIFIED` when the server
 * revalidates the browser's cached copy with a 304.
 */
export async function fetchJson(path, signal, timeoutMs = 15000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(path, { cache: "no-cache", signal: controller.signal });
    if (response.status === 304) return NOT_MODIFIED;
    if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
    return { data: await response.json(), etag: response.headers.get("etag") };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * True when a fetchJson result carries no changes versus the last applied
 * payload. Prefers the server's ETag (a SHA-256 of the exact bytes served);
 * falls back to a content comparison when the response carries none, which
 * only happens outside production (local dev, tests).
 */
export function isUnchangedPayload(result, lastEtag, lastData) {
  if (result === NOT_MODIFIED) return true;
  if (result.etag != null || lastEtag != null) return result.etag === lastEtag;
  return JSON.stringify(result.data) === JSON.stringify(lastData);
}
