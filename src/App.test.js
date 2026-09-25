import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";

import App from "./App.vue";
import { UI_PREFS_STORAGE_KEY } from "./preferences.js";

let app;
let container;
let mounted;
let storage;

function makeStorage() {
  const data = Object.create(null);
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    clear: () => { Object.keys(data).forEach((key) => delete data[key]); },
  };
}

function deal(topicId, dealerName) {
  return {
    topic_id: topicId,
    title: `${dealerName} deal`,
    post_time: "2026-08-14T12:00:00Z",
    last_post_time: "2026-08-14T12:00:00Z",
    score: 1,
    Offer: { dealer_name: dealerName, url: "" },
    web_path: `/deal-${topicId}`,
  };
}

function mockFeedApi({ topics = [], enrichment = {}, health = null, topicsError = null } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const path = String(input);
    if (path.startsWith("/topics.json")) {
      if (topicsError) throw topicsError;
      return Response.json(topics);
    }
    if (path.startsWith("/enrichment.json")) return Response.json(enrichment);
    if (path.startsWith("/health.json")) return Response.json(health);
    return new Response("not found", { status: 404 });
  }));
}

beforeEach(() => {
  storage = makeStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  if (mounted) app.unmount();
  container?.remove();
  app = undefined;
  container = undefined;
  mounted = false;
  storage = undefined;
  window.history.replaceState({}, "", "/");
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function topic(dealerName) {
  return { Offer: { dealer_name: dealerName } };
}

describe("merchant filters", () => {
  it("shows each loaded merchant once and keeps hidden merchants absent from the feed removable", () => {
    const merchantOptions = App.computed.merchantOptions?.call({
      topics: [topic("Amazon"), topic(" amazon "), topic("Best Buy")],
    });

    expect(merchantOptions).toEqual([
      { key: "amazon", name: "Amazon", count: 2 },
      { key: "best buy", name: "Best Buy", count: 1 },
    ]);

    const hiddenMerchantsNotInFeed = App.computed.hiddenMerchantsNotInFeed?.call({
      hiddenMerchants: ["Amazon", "Defunct Shop"],
      merchantOptions,
    });

    expect(hiddenMerchantsNotInFeed).toEqual(["Defunct Shop"]);
  });

  it("removes a hidden merchant by normalized name", () => {
    const vm = { hiddenMerchants: ["Amazon", "Best Buy"] };

    App.methods.setMerchantHidden?.call(vm, " amazon ", false);

    expect(vm.hiddenMerchants).toEqual(["Best Buy"]);
  });

  it("hides bad deals even when seen-deal filtering is off", () => {
    const filteredTopics = App.computed.filteredTopics.call({
      topics: [deal(1, "Amazon"), { ...deal(2, "Best Buy"), score: -6 }],
      activeFilters: [],
      sortMethod: "score",
      hiddenMerchants: [],
      hideSeen: false,
      hideBadDeals: true,
      seen: new Map(),
    });

    expect(filteredTopics.map(({ topic_id }) => topic_id)).toEqual([1]);
  });

  it("combines seen-deal and bad-deal exclusions", () => {
    const filteredTopics = App.computed.filteredTopics.call({
      topics: [
        deal(1, "Amazon"),
        { ...deal(2, "Best Buy"), score: -6 },
        deal(3, "Newegg"),
      ],
      activeFilters: [],
      sortMethod: "score",
      hiddenMerchants: [],
      hideSeen: true,
      hideBadDeals: true,
      seen: new Map([["1", Date.now()]]),
    });

    expect(filteredTopics.map(({ topic_id }) => topic_id)).toEqual([3]);
  });

  it("opens a mobile merchant sheet with hidden merchants first", async () => {
    storage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ hiddenMerchants: ["Amazon", "Defunct Shop"] }));
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockFeedApi({ topics: [deal(1, "Amazon"), deal(2, "Best Buy")] });

    container = document.createElement("div");
    document.body.append(container);
    app = createApp(App);
    app.config.globalProperties.$router = { replace: () => {} };
    const vm = app.mount(container);
    mounted = true;
    await vi.advanceTimersByTimeAsync(500);
    await nextTick();

    container.querySelector('button[title="Menu"]')?.click();
    await nextTick();
    [...container.querySelectorAll(".mobile-dropdown button")]
      .find((button) => button.textContent.includes("Merchants"))?.click();
    await nextTick();

    const sheet = container.querySelector(".mobile-merchant-sheet");
    expect(sheet).toBeTruthy();
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(sheet.querySelector(".merchant-search"));
    const focusable = [...sheet.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
    focusable.at(-1).focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(focusable[0]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
    expect(document.activeElement).toBe(focusable.at(-1));
    const options = [...sheet.querySelectorAll(".mobile-merchant-option")];
    expect(options.map((option) => option.textContent.trim())).toEqual([
      "Amazon1Restore",
      "Defunct ShopNot in feedRestore",
      "Best Buy1Hide",
    ]);

    options[0].click();
    await nextTick();
    expect(vm.hiddenMerchants).toEqual(["Defunct Shop"]);

    const search = sheet.querySelector(".merchant-search");
    search.value = "defunct";
    search.dispatchEvent(new Event("input"));
    await nextTick();
    expect(sheet.textContent).toContain("Defunct Shop");
    expect(sheet.textContent).not.toContain("Best Buy");

    search.value = "best";
    search.dispatchEvent(new Event("input"));
    await nextTick();
    expect(sheet.textContent).toContain("Best Buy");
    expect(sheet.textContent).not.toContain("Defunct Shop");

    [...sheet.querySelectorAll(".mobile-merchant-option")]
      .find((option) => option.textContent.includes("Best Buy"))
      .click();
    await nextTick();
    expect(vm.hiddenMerchants).toEqual(["Best Buy", "Defunct Shop"]);
    const firstHiddenMerchant = sheet.querySelector(".mobile-merchant-option--hidden");
    expect(firstHiddenMerchant.textContent).toContain("Best Buy");
    expect(document.activeElement).toBe(firstHiddenMerchant);

    sheet.querySelector(".mobile-merchant-sheet-close").click();
    await nextTick();
    expect(container.querySelector(".mobile-merchant-sheet")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(container.querySelector('button[title="Menu"]'));

    vm.openMobileMerchantSheet();
    await nextTick();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(container.querySelector(".mobile-merchant-sheet")).toBeNull();
  });

  it("restores absent merchants and filters rendered deals with a persistent searchable checklist", async () => {
    storage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ hiddenMerchants: ["Defunct Shop"] }));
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockFeedApi({ topics: [deal(1, "Amazon"), deal(2, "Best Buy")] });

    container = document.createElement("div");
    document.body.append(container);
    app = createApp(App);
    app.config.globalProperties.$router = { replace: () => {} };
    const vm = app.mount(container);
    mounted = true;
    await vi.advanceTimersByTimeAsync(500);
    await nextTick();

    container.querySelector(".merchant-dropdown-wrapper .icon-button").click();
    await nextTick();
    const defunctShop = [...container.querySelectorAll(".merchant-missing button")]
      .find((button) => button.textContent.includes("Defunct Shop"));
    expect(defunctShop).toBeTruthy();
    defunctShop.click();
    await nextTick();
    expect(vm.hiddenMerchants).toEqual([]);

    const amazonOption = [...container.querySelectorAll(".merchant-option")]
      .find((option) => option.textContent.includes("Amazon"));
    amazonOption.querySelector('input[type="checkbox"]').click();
    await nextTick();

    expect(vm.hiddenMerchants).toEqual(["Amazon"]);
    expect(container.querySelectorAll(".deal-row")).toHaveLength(1);
    expect(JSON.parse(storage.getItem(UI_PREFS_STORAGE_KEY)).hiddenMerchants).toEqual(["Amazon"]);

    const search = container.querySelector(".merchant-search");
    search.value = "best";
    search.dispatchEvent(new Event("input"));
    await nextTick();
    expect(container.querySelectorAll(".merchant-option")).toHaveLength(1);
    expect(container.querySelector(".merchant-option").textContent).toContain("Best Buy");

    [...container.querySelectorAll(".merchant-reset")].find((button) => !button.disabled).click();
    await nextTick();
    expect(vm.hiddenMerchants).toEqual([]);
    expect(container.querySelectorAll(".deal-row")).toHaveLength(2);
  });
});

describe("deal loading status", () => {
  it("shows a load error instead of an empty-filter message when topics cannot be fetched", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockFeedApi({ topicsError: new Error("offline") });

    container = document.createElement("div");
    document.body.append(container);
    app = createApp(App);
    app.config.globalProperties.$router = { replace: () => {} };
    app.mount(container);
    mounted = true;
    await vi.advanceTimersByTimeAsync(500);
    await nextTick();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not load deals");
    expect(container.textContent).not.toContain("No deals match your filters");
  });

  it("shows the last successful server refresh after loading deals", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockFeedApi({
      topics: [deal(1, "Amazon")],
      health: { ok: false, completed_at: "2026-09-14T12:00:00.000Z" },
    });

    container = document.createElement("div");
    document.body.append(container);
    app = createApp(App);
    app.config.globalProperties.$router = { replace: () => {} };
    app.mount(container);
    mounted = true;
    await vi.advanceTimersByTimeAsync(500);
    await nextTick();

    const status = container.querySelector(".feed-status")?.textContent;
    expect(status).toMatch(/^\s*Last updated 2026-09-14 \d{2}:00 (?:AM|PM)/);
    expect(status).toContain("refresh degraded");
  });
});

describe("URL filters", () => {
  it("drops non-string entries from shared filter URLs", () => {
    window.history.replaceState({}, "", `/?filters=${encodeURIComponent(JSON.stringify(["ssd", 42, null, ""]))}`);

    expect(App.methods.parseFiltersFromUrl()).toEqual(["ssd"]);
  });
});

describe("settings panel", () => {
  it("opens from the gear button and the g key, shows backup controls, and closes on Escape", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockFeedApi({ topics: [deal(1, "Amazon")] });

    container = document.createElement("div");
    document.body.append(container);
    app = createApp(App);
    app.config.globalProperties.$router = { replace: () => {} };
    const vm = app.mount(container);
    mounted = true;
    await vi.advanceTimersByTimeAsync(500);
    await nextTick();

    expect(container.querySelector(".settings-panel")).toBeNull();
    container.querySelector('button[title="Settings"]').click();
    await nextTick();
    expect(vm.settingsPanelVisible).toBe(true);
    let panel = container.querySelector(".settings-panel");
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain("Export settings");
    expect(panel.querySelector('input[type="file"]')).toBeTruthy();
    panel.querySelector(".close-button").click();
    await nextTick();
    expect(vm.settingsPanelVisible).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    await nextTick();
    expect(vm.settingsPanelVisible).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(vm.settingsPanelVisible).toBe(false);
  });
});

function mountFeed() {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement("div");
  document.body.append(container);
  app = createApp(App);
  const vm = app.mount(container);
  mounted = true;
  return vm;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe("refresh without interrupting browsing", () => {
  it("renders topics immediately while optional requests are still pending", async () => {
    const optional = deferred();
    vi.stubGlobal("fetch", vi.fn((path) => path === "/topics.json"
      ? Promise.resolve(Response.json([deal(1, "Amazon")])) : optional.promise));
    const vm = mountFeed();
    await vi.advanceTimersByTimeAsync(0);
    expect(container.querySelector(".deal-title")?.textContent).toBe("Amazon deal");
    expect(vm.isLoading).toBe(false);
    optional.resolve(Response.json({}));
    await vi.advanceTimersByTimeAsync(0);
  });

  it("stages background changes and preserves the loaded count when applied", async () => {
    const topics = Array.from({ length: 250 }, (_, i) => deal(i + 1, "Amazon"));
    mockFeedApi({ topics });
    const vm = mountFeed();
    await vi.advanceTimersByTimeAsync(500);
    vm.visibleTopicCount = 200;
    mockFeedApi({ topics: [deal(999, "New shop"), ...topics] });
    vm.fetchDeals({ background: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(vm.topics).toHaveLength(250);
    expect(container.querySelector(".feed-update")?.textContent).toContain("1 new");
    container.querySelector(".feed-update").click();
    await nextTick();
    expect(vm.topics).toHaveLength(251);
    expect(vm.visibleTopicCount).toBe(200);
    expect(container.querySelector(".feed-update")).toBeNull();
  });

  it("keeps tags after enrichment fails on a later refresh", async () => {
    mockFeedApi({ topics: [deal(1, "Amazon")], enrichment: { vocabulary: ["gaming"], topics: { 1: { tags: ["gaming"] } } } });
    const vm = mountFeed();
    await vi.advanceTimersByTimeAsync(500);
    vi.stubGlobal("fetch", vi.fn(async (path) => {
      if (path.startsWith("/enrichment")) throw new Error("offline");
      return Response.json(path.startsWith("/topics") ? [deal(1, "Amazon")] : null);
    }));
    vm.fetchDeals();
    await vi.advanceTimersByTimeAsync(500);
    expect(vm.topics[0].tags).toEqual(["gaming"]);
    expect(vm.tagVocabulary).toEqual(["gaming"]);
  });

  it("ignores a superseded request even if its response arrives late", async () => {
    const old = deferred();
    vi.stubGlobal("fetch", vi.fn((path) => path.startsWith("/topics") ? old.promise : Promise.resolve(Response.json({}))));
    const vm = mountFeed();
    mockFeedApi({ topics: [deal(2, "Latest")] });
    vm.fetchDeals();
    await vi.advanceTimersByTimeAsync(500);
    old.resolve(Response.json([deal(1, "Old")]));
    await vi.advanceTimersByTimeAsync(500);
    expect(vm.topics.map(t => t.topic_id)).toEqual([2]);
  });

  it("skips hidden-tab polling and refreshes on return only when stale", async () => {
    mockFeedApi({ topics: [deal(1, "Amazon")] });
    const vm = mountFeed();
    await vi.advanceTimersByTimeAsync(500);
    let hidden = true;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    mockFeedApi({ topics: [deal(2, "New shop")] });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(fetch).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(500);
    expect(vm.pendingTopics?.[0].topic_id).toBe(2);
    fetch.mockClear();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("refresh reading position and lifecycle", () => {
  it("keeps the visible deal anchored after manual refresh inserts rows above it", async () => {
    mockFeedApi({ topics: [deal(1, "Amazon")] });
    const vm = mountFeed();
    await vi.advanceTimersByTimeAsync(0);
    const row = container.querySelector('[data-topic-id="1"]');
    let offset = 100;
    row.getBoundingClientRect = () => ({ top: offset, bottom: offset + 80 });
    vi.stubGlobal("scrollBy", vi.fn());
    vm.visibleTopicCount = 200;
    mockFeedApi({ topics: [{ ...deal(2, "New shop"), score: 10 }, deal(1, "Amazon")] });
    // Simulate the browser layout after Vue patches the existing keyed row.
    const patch = new MutationObserver(() => { offset = 180; });
    patch.observe(container, { childList: true, subtree: true });
    vm.fetchDeals();
    await vi.advanceTimersByTimeAsync(0);
    patch.disconnect();
    expect(vm.visibleTopicCount).toBe(200);
    expect(scrollBy).toHaveBeenCalledWith(0, 80);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("does not offer an update when the feed has not changed", async () => {
    mockFeedApi({ topics: [deal(1, "Amazon")] });
    const vm = mountFeed();
    await vi.advanceTimersByTimeAsync(0);
    vm.fetchDeals({ background: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(container.querySelector(".feed-update")).toBeNull();
  });

  it("discards responses after unmount and removes polling", async () => {
    const pending = deferred();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    const vm = mountFeed();
    app.unmount();
    mounted = false;
    pending.resolve(Response.json([deal(1, "Late")]));
    await vi.advanceTimersByTimeAsync(0);
    expect(vm.topics).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("anchors to a surviving visible deal when the first visible deal disappears", async () => {
  mockFeedApi({ topics: [deal(1, "Expired"), deal(2, "Survivor")] });
  const vm = mountFeed();
  await vi.advanceTimersByTimeAsync(0);
  const first = container.querySelector('[data-topic-id="1"]');
  const second = container.querySelector('[data-topic-id="2"]');
  first.getBoundingClientRect = () => ({ top: 100, bottom: 180 });
  let offset = 180;
  second.getBoundingClientRect = () => ({ top: offset, bottom: offset + 80 });
  vi.stubGlobal("scrollBy", vi.fn());
  const patch = new MutationObserver(() => { offset = 100; });
  patch.observe(container, { childList: true, subtree: true });
  mockFeedApi({ topics: [deal(2, "Survivor")] });
  vm.fetchDeals();
  await vi.advanceTimersByTimeAsync(0);
  patch.disconnect();
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith(0, -80);
});
