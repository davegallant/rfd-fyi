import { afterEach, expect, it, vi } from "vitest";
import { fetchJson } from "./fetchJson.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("revalidates a stable URL so the browser can reuse its cached body", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([1])));
  expect(await fetchJson("/topics.json")).toEqual([1]);
  expect(fetch).toHaveBeenCalledWith("/topics.json", expect.objectContaining({ cache: "no-cache" }));
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
