/** Keys owned by rfd-fyi that contain user settings. */
export const SETTINGS_STORAGE_KEYS = [
  "sortMethod",
  "theme",
  "rfd-fyi-ui",
  "rfd-seen-deals",
];

const EXPORT_VERSION = 1;

/**
 * Serializes every rfd-fyi localStorage setting into a portable JSON document.
 */
export function exportLocalStorageSettings(storage = localStorage) {
  const settings = {};
  for (const key of SETTINGS_STORAGE_KEYS) {
    const value = storage.getItem(key);
    if (value != null) settings[key] = value;
  }
  return JSON.stringify({ version: EXPORT_VERSION, settings }, null, 2);
}

/**
 * Restores an export produced by exportLocalStorageSettings.
 * Missing keys are removed, so importing is an exact replacement of app settings.
 */
export function importLocalStorageSettings(contents, storage = localStorage) {
  let parsed;
  try {
    parsed = typeof contents === "string" ? JSON.parse(contents) : contents;
  } catch {
    return false;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.version !== EXPORT_VERSION ||
    !parsed.settings ||
    typeof parsed.settings !== "object" ||
    Array.isArray(parsed.settings)
  ) {
    return false;
  }

  for (const key of SETTINGS_STORAGE_KEYS) {
    const value = parsed.settings[key];
    if (value != null && typeof value !== "string") return false;
  }

  for (const key of SETTINGS_STORAGE_KEYS) {
    const value = parsed.settings[key];
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, value);
  }
  return true;
}
