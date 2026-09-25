/** Stable URLs let the browser revalidate cached ETags and reuse 304 bodies. */
export async function fetchJson(path, signal, timeoutMs = 15000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(path, { cache: "no-cache", signal: controller.signal });
    if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
