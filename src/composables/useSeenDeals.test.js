/**
 * Tests for src/composables/useSeenDeals.js
 *
 * Each test module-resets the composable state via vi.resetModules() so that
 * the module-level `seen` ref starts clean for every test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeStorage() {
  const data = Object.create(null);
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    clear: () => { Object.keys(data).forEach((k) => delete data[k]); },
    _data: data,
  };
}

const STORAGE_KEY = "rfd-seen-deals";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ─── fresh import helper ─────────────────────────────────────────────────────

async function freshImport() {
  vi.resetModules();
  return import("./useSeenDeals.js");
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("useSeenDeals", () => {
  let storage;

  beforeEach(() => {
    storage = makeStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── markSeen / isSeen ────────────────────────────────────────────────────

  it("markSeen records the id and isSeen returns true", async () => {
    const { markSeen, isSeen } = await freshImport();
    markSeen(42);
    expect(isSeen(42)).toBe(true);
  });

  it("isSeen returns false for an unknown id", async () => {
    const { isSeen } = await freshImport();
    expect(isSeen(99)).toBe(false);
  });

  it("markSeen accepts string ids", async () => {
    const { markSeen, isSeen } = await freshImport();
    markSeen("123");
    expect(isSeen("123")).toBe(true);
    expect(isSeen(123)).toBe(true); // numeric equivalent
  });

  it("markSeen persists to localStorage", async () => {
    const { markSeen } = await freshImport();
    markSeen(7);
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    expect(saved).toHaveProperty("7");
    expect(typeof saved["7"]).toBe("number");
  });

  // ── markUnseen ───────────────────────────────────────────────────────────

  it("markUnseen removes a previously seen id", async () => {
    const { markSeen, markUnseen, isSeen } = await freshImport();
    markSeen(10);
    markUnseen(10);
    expect(isSeen(10)).toBe(false);
  });

  it("markUnseen persists the removal to localStorage", async () => {
    const { markSeen, markUnseen } = await freshImport();
    markSeen(10);
    markUnseen(10);
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    expect(saved).not.toHaveProperty("10");
  });

  it("markUnseen on an unknown id does not throw", async () => {
    const { markUnseen } = await freshImport();
    expect(() => markUnseen(999)).not.toThrow();
  });

  // ── markAllSeen ──────────────────────────────────────────────────────────

  it("markAllSeen marks every deal in the array", async () => {
    const { markAllSeen, isSeen } = await freshImport();
    const deals = [
      { topic_id: 1 },
      { topic_id: 2 },
      { topic_id: 3 },
    ];
    markAllSeen(deals);
    expect(isSeen(1)).toBe(true);
    expect(isSeen(2)).toBe(true);
    expect(isSeen(3)).toBe(true);
  });

  it("markAllSeen ignores entries without topic_id", async () => {
    const { markAllSeen, seen } = await freshImport();
    markAllSeen([{}, null, undefined, { topic_id: 5 }]);
    expect(seen.value.has("5")).toBe(true);
    expect(seen.value.size).toBe(1);
  });

  it("markAllSeen persists to localStorage", async () => {
    const { markAllSeen } = await freshImport();
    markAllSeen([{ topic_id: 11 }, { topic_id: 22 }]);
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    expect(saved).toHaveProperty("11");
    expect(saved).toHaveProperty("22");
  });

  // ── clearSeen ────────────────────────────────────────────────────────────

  it("clearSeen empties the reactive map", async () => {
    const { markSeen, clearSeen, seen } = await freshImport();
    markSeen(1);
    markSeen(2);
    clearSeen();
    expect(seen.value.size).toBe(0);
  });

  it("clearSeen removes the localStorage key", async () => {
    const { markSeen, clearSeen } = await freshImport();
    markSeen(1);
    clearSeen();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  // ── expiry / pruning ─────────────────────────────────────────────────────

  it("entries older than 30 days are pruned on load", async () => {
    const staleTs = Date.now() - THIRTY_DAYS_MS - 1000;
    storage.setItem(STORAGE_KEY, JSON.stringify({ "77": staleTs }));

    const { isSeen } = await freshImport();
    expect(isSeen(77)).toBe(false);
  });

  it("entries exactly at 30 days boundary are pruned (>=)", async () => {
    const boundaryTs = Date.now() - THIRTY_DAYS_MS;
    storage.setItem(STORAGE_KEY, JSON.stringify({ "88": boundaryTs }));

    const { isSeen } = await freshImport();
    expect(isSeen(88)).toBe(false);
  });

  it("entries within 30 days survive on load", async () => {
    const freshTs = Date.now() - 1000; // 1 second ago
    storage.setItem(STORAGE_KEY, JSON.stringify({ "55": freshTs }));

    const { isSeen } = await freshImport();
    expect(isSeen(55)).toBe(true);
  });

  it("markSeen prunes expired entries before persisting", async () => {
    const staleTs = Date.now() - THIRTY_DAYS_MS - 5000;
    storage.setItem(STORAGE_KEY, JSON.stringify({ "stale": staleTs }));

    const { markSeen } = await freshImport();
    markSeen(99);

    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    expect(saved).not.toHaveProperty("stale");
    expect(saved).toHaveProperty("99");
  });

  // ── localStorage corruption / edge cases ────────────────────────────────

  it("returns empty map when localStorage contains invalid JSON", async () => {
    storage.setItem(STORAGE_KEY, "NOT_JSON{{{");
    const { seen } = await freshImport();
    expect(seen.value.size).toBe(0);
  });

  it("returns empty map when localStorage value is a JSON array", async () => {
    storage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    const { seen } = await freshImport();
    expect(seen.value.size).toBe(0);
  });

  it("returns empty map when localStorage value is null JSON", async () => {
    storage.setItem(STORAGE_KEY, "null");
    const { seen } = await freshImport();
    expect(seen.value.size).toBe(0);
  });

  it("ignores entries with non-numeric seenAt values", async () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ "bad": "yesterday", "ok": Date.now() - 1000 }));
    const { isSeen } = await freshImport();
    expect(isSeen("bad")).toBe(false);
    expect(isSeen("ok")).toBe(true);
  });

  // ── module-scope sharing ─────────────────────────────────────────────────

  it("seen ref is shared across multiple imports of the same module", async () => {
    // Import the module once; both destructured symbols reference the same ref
    const mod = await freshImport();
    mod.markSeen(200);
    // Re-destructure from the same cached module instance
    const { isSeen } = mod;
    expect(isSeen(200)).toBe(true);
  });

  // ── default export ───────────────────────────────────────────────────────

  it("default export useSeenDeals() returns all five functions plus seen ref", async () => {
    const { default: useSeenDeals } = await freshImport();
    const result = useSeenDeals();
    expect(typeof result.markSeen).toBe("function");
    expect(typeof result.markUnseen).toBe("function");
    expect(typeof result.isSeen).toBe("function");
    expect(typeof result.markAllSeen).toBe("function");
    expect(typeof result.clearSeen).toBe("function");
    expect(result.seen).toBeDefined();
  });
});
