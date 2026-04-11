/** JSON blob kept in sync with legacy keys for backwards compatibility and tests. */
export const UI_PREFS_STORAGE_KEY = "rfd-fyi-ui";

export const DEFAULT_UI_PREFERENCES = {
  sortMethod: "score",
  viewMode: "list",
  theme: "auto",
};

export const SORT_METHOD_KEYS = [
  "title",
  "post_time",
  "thread_start",
  "score",
  "replies",
  "views",
];

function normalizeFromPartial(partial) {
  const p = partial || {};
  const sortMethod = SORT_METHOD_KEYS.includes(p.sortMethod)
    ? p.sortMethod
    : DEFAULT_UI_PREFERENCES.sortMethod;
  const viewMode =
    p.viewMode === "cards" || p.viewMode === "list"
      ? p.viewMode
      : DEFAULT_UI_PREFERENCES.viewMode;
  const theme = ["auto", "light", "dark"].includes(p.theme)
    ? p.theme
    : DEFAULT_UI_PREFERENCES.theme;
  return { sortMethod, viewMode, theme };
}

function readLegacy(storage) {
  return normalizeFromPartial({
    sortMethod: storage.getItem("sortMethod"),
    viewMode: storage.getItem("viewMode"),
    theme: storage.getItem("theme"),
  });
}

/**
 * Reads theme / sort / view preferences from localStorage.
 * Tries the JSON blob first; on missing/invalid JSON uses legacy string keys, then defaults.
 */
export function loadUiPreferences(storage = localStorage) {
  const legacy = readLegacy(storage);
  const raw = storage.getItem(UI_PREFS_STORAGE_KEY);
  if (raw == null || raw === "") {
    return legacy;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return legacy;
    }
    return normalizeFromPartial({ ...legacy, ...parsed });
  } catch {
    return legacy;
  }
}

/** Writes legacy keys and the JSON blob so preferences survive and stay consistent. */
export function persistUiPreferences(prefs, storage = localStorage) {
  const normalized = normalizeFromPartial(prefs);
  storage.setItem("sortMethod", normalized.sortMethod);
  storage.setItem("viewMode", normalized.viewMode);
  storage.setItem("theme", normalized.theme);
  storage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(normalized));
}
