import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_UI_PREFERENCES,
  UI_PREFS_STORAGE_KEY,
  loadUiPreferences,
  persistUiPreferences,
} from "./preferences.js";

function createMemoryStorage() {
  const data = Object.create(null);
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
    clear: () => {
      Object.keys(data).forEach((k) => delete data[k]);
    },
  };
}

describe("loadUiPreferences / persistUiPreferences", () => {
  let memory;

  beforeEach(() => {
    memory = createMemoryStorage();
    vi.stubGlobal("localStorage", memory);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists preferences to storage when values change", () => {
    persistUiPreferences({
      sortMethod: "title",
      theme: "dark",
    });

    expect(memory.getItem("sortMethod")).toBe("title");
    expect(memory.getItem("theme")).toBe("dark");
    expect(JSON.parse(memory.getItem(UI_PREFS_STORAGE_KEY))).toEqual({
      sortMethod: "title",
      theme: "dark",
    });
  });

  it("restores preferences that were previously saved", () => {
    persistUiPreferences({
      sortMethod: "replies",
      theme: "light",
    });

    expect(loadUiPreferences()).toEqual({
      sortMethod: "replies",
      theme: "light",
    });
  });

  it("returns defaults when keys are missing and does not throw", () => {
    expect(loadUiPreferences()).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("falls back to legacy keys when the JSON blob is malformed", () => {
    memory.setItem("sortMethod", "views");
    memory.setItem("theme", "dark");
    memory.setItem(UI_PREFS_STORAGE_KEY, "{not valid json");

    expect(loadUiPreferences()).toEqual({
      sortMethod: "views",
      theme: "dark",
    });
  });

  it("uses defaults for malformed blob when legacy keys are also absent", () => {
    memory.setItem(UI_PREFS_STORAGE_KEY, "{not valid json");
    expect(loadUiPreferences()).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("ignores invalid values in storage and substitutes defaults", () => {
    memory.setItem("sortMethod", "nope");
    memory.setItem("theme", "infrared");

    expect(loadUiPreferences()).toEqual(DEFAULT_UI_PREFERENCES);
  });
});
