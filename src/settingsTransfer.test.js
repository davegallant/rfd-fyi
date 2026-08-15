import { describe, expect, it } from "vitest";

import {
  SETTINGS_STORAGE_KEYS,
  exportLocalStorageSettings,
  importLocalStorageSettings,
} from "./settingsTransfer.js";

function createMemoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
  };
}

describe("settings transfer", () => {
  it("exports every rfd-fyi localStorage setting without unrelated keys", () => {
    const storage = createMemoryStorage({
      sortMethod: "score",
      theme: "dark",
      "rfd-fyi-ui": '{"theme":"dark"}',
      "rfd-seen-deals": '{"123":123456}',
      unrelated: "leave out",
    });

    expect(JSON.parse(exportLocalStorageSettings(storage))).toEqual({
      version: 1,
      settings: {
        sortMethod: "score",
        theme: "dark",
        "rfd-fyi-ui": '{"theme":"dark"}',
        "rfd-seen-deals": '{"123":123456}',
      },
    });
  });

  it("restores an export exactly while preserving unrelated storage", () => {
    const storage = createMemoryStorage({
      sortMethod: "title",
      theme: "light",
      "rfd-seen-deals": "old",
      unrelated: "keep me",
    });

    expect(importLocalStorageSettings(JSON.stringify({
      version: 1,
      settings: { theme: "dark", "rfd-fyi-ui": '{"theme":"dark"}' },
    }), storage)).toBe(true);

    expect(storage.getItem("sortMethod")).toBeNull();
    expect(storage.getItem("theme")).toBe("dark");
    expect(storage.getItem("rfd-fyi-ui")).toBe('{"theme":"dark"}');
    expect(storage.getItem("rfd-seen-deals")).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep me");
  });

  it("rejects invalid exports without changing storage", () => {
    const storage = createMemoryStorage({ theme: "light" });
    const before = SETTINGS_STORAGE_KEYS.map((key) => storage.getItem(key));

    expect(importLocalStorageSettings('{"version":1,"settings":{"theme":true}}', storage)).toBe(false);
    expect(importLocalStorageSettings('{"version":2,"settings":{}}', storage)).toBe(false);
    expect(SETTINGS_STORAGE_KEYS.map((key) => storage.getItem(key))).toEqual(before);
  });
});
