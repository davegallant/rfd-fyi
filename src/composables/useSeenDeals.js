/**
 * useSeenDeals — module-scoped reactive "seen deals" state backed by localStorage.
 *
 * Storage format: JSON object of { [id]: seenAtTimestamp (ms) }
 * Key: rfd-seen-deals
 * Expiry: entries older than 30 days are pruned on load and on every write.
 */

import { shallowRef, triggerRef } from "vue";

const STORAGE_KEY = "rfd-seen-deals";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return new Map();
    const now = Date.now();
    const map = new Map();
    for (const [id, seenAt] of Object.entries(obj)) {
      if (typeof seenAt === "number" && now - seenAt < THIRTY_DAYS_MS) {
        map.set(String(id), seenAt);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function persist(map) {
  const obj = {};
  for (const [id, seenAt] of map.entries()) {
    obj[id] = seenAt;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // quota exceeded or private-browsing restriction — fail silently
  }
}

/** Mutates the map in-place, removing entries older than 30 days. */
function prune(map) {
  const now = Date.now();
  for (const [id, seenAt] of map.entries()) {
    if (now - seenAt >= THIRTY_DAYS_MS) {
      map.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level reactive state — all component instances share the same ref.
// ---------------------------------------------------------------------------

export const seen = shallowRef(load());

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Records the current timestamp for the given deal ID, prunes expired entries,
 * and persists the map to localStorage.
 * @param {string|number} id
 */
export function markSeen(id) {
  seen.value.set(String(id), Date.now());
  prune(seen.value);
  persist(seen.value);
  triggerRef(seen);
}

/**
 * Removes the entry for the given deal ID and persists.
 * @param {string|number} id
 */
export function markUnseen(id) {
  seen.value.delete(String(id));
  persist(seen.value);
  triggerRef(seen);
}

/**
 * Returns true if the given deal ID has been seen.
 * @param {string|number} id
 * @returns {boolean}
 */
export function isSeen(id) {
  return seen.value.has(String(id));
}

/**
 * Bulk-marks an array of deal objects as seen (uses their `topic_id` field).
 * @param {object[]} deals
 */
export function markAllSeen(deals) {
  const now = Date.now();
  for (const deal of deals) {
    if (deal && deal.topic_id != null) {
      seen.value.set(String(deal.topic_id), now);
    }
  }
  prune(seen.value);
  persist(seen.value);
  triggerRef(seen);
}

/**
 * Clears all seen entries from the reactive state and from localStorage.
 */
export function clearSeen() {
  seen.value.clear();
  triggerRef(seen);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Composable entry point (for use in setup() or <script setup>)
// ---------------------------------------------------------------------------

export default function useSeenDeals() {
  return { seen, markSeen, markUnseen, isSeen, markAllSeen, clearSeen };
}
