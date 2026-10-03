import { afterEach, expect, it, vi } from "vitest";
import { fetchJson, isUnchangedPayload, NOT_MODIFIED } from "./fetchJson.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("revalidates a stable URL so the browser can reuse its cached body", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([1])));
  expect(await fetchJson("/topics.json")).toEqual({ data: [1], etag: null });
  expect(fetch).toHaveBeenCalledWith("/topics.json", expect.objectContaining({ cache: "no-cache" }));
});

it("returns the 304 sentinel instead of throwing when the cached body is reused", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 304 })));
  expect(await fetchJson("/topics.json")).toBe(NOT_MODIFIED);
  expect(isUnchangedPayload(NOT_MODIFIED, null, [1])).toBe(true);
});

it("prefers ETags over content comparison when both are available", async () => {
  const headers = new Headers({ etag: '"abc"' });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([1]), { headers })));
  const result = await fetchJson("/topics.json");
  expect(result).toEqual({ data: [1], etag: '"abc"' });
  expect(isUnchangedPayload(result, '"abc"', [2])).toBe(true);
  expect(isUnchangedPayload(result, '"def"', [1])).toBe(false);
});

it("falls back to a content comparison when the response carries no ETag", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([1])));
  const result = await fetchJson("/topics.json");
  expect(isUnchangedPayload(result, null, [1])).toBe(true);
  expect(isUnchangedPayload(result, null, [2])).toBe(false);
});

it("aborts stalled body reads at the deadline", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (_path, { signal }) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
  })));
  const request = fetchJson("/topics.json", undefined, 1000);
  const rejected = expect(request).rejects.toThrow("aborted");
  await vi.advanceTimersByTimeAsync(1000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
