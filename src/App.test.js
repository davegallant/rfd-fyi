import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";

import axios from "axios";
import App from "./App.vue";
import { UI_PREFS_STORAGE_KEY } from "./preferences.js";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

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
  vi.clearAllMocks();
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

  it("restores absent merchants and filters rendered deals with a persistent searchable checklist", async () => {
    storage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ hiddenMerchants: ["Defunct Shop"] }));
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    axios.get
      .mockResolvedValueOnce({ data: [deal(1, "Amazon"), deal(2, "Best Buy")] })
      .mockResolvedValueOnce({ data: {} });

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
