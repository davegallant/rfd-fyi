import { describe, expect, it } from "vitest";

import {
  filterTopicsByActiveFilters,
  getFilteredSortedTopics,
  sortTopics,
} from "./filterTopics.js";

function topic(overrides = {}) {
  return {
    topic_id: 1,
    title: "Sample Deal",
    last_post_time: "2024-01-02T00:00:00Z",
    post_time: "2024-01-01T00:00:00Z",
    score: 5,
    total_replies: 10,
    total_views: 100,
    Offer: { dealer_name: "Amazon", url: "" },
    web_path: "/foo",
    ...overrides,
  };
}

describe("filterTopicsByActiveFilters", () => {
  const deals = [
    topic({ topic_id: 1, title: "SSD Sale", Offer: { dealer_name: "Best Buy" } }),
    topic({ topic_id: 2, title: "Coffee beans", Offer: { dealer_name: "Amazon" } }),
    topic({ topic_id: 3, title: "SSD from Newegg", Offer: { dealer_name: "Newegg" } }),
  ];

  it("returns every deal when no filter is active", () => {
    const out = filterTopicsByActiveFilters(deals, []);
    expect(out.map((d) => d.topic_id).sort()).toEqual([1, 2, 3]);
  });

  it("returns only deals whose combined title and dealer text match all filter terms", () => {
    const out = filterTopicsByActiveFilters(deals, ["ssd"]);
    expect(out.map((d) => d.topic_id).sort()).toEqual([1, 3]);
  });

  it("returns an empty array when the deals list is empty", () => {
    expect(filterTopicsByActiveFilters([], ["anything"])).toEqual([]);
    expect(filterTopicsByActiveFilters([], [])).toEqual([]);
  });

  it("returns no deals when the filter matches nothing", () => {
    const out = filterTopicsByActiveFilters(deals, ["nonexistent-xyz-123"]);
    expect(out).toEqual([]);
  });

  it("requires every term to match (AND semantics)", () => {
    const out = filterTopicsByActiveFilters(deals, ["ssd", "newegg"]);
    expect(out.map((d) => d.topic_id)).toEqual([3]);
  });
});

describe("getFilteredSortedTopics", () => {
  it("applies filter then sort so results are ordered", () => {
    const deals = [
      topic({ topic_id: 1, title: "B Deal", score: 1 }),
      topic({ topic_id: 2, title: "A Deal", score: 99 }),
    ];
    const out = getFilteredSortedTopics(deals, [], "title");
    expect(out.map((d) => d.topic_id)).toEqual([2, 1]);
  });
});

describe("sortTopics", () => {
  it("defaults invalid sort keys to score order", () => {
    const deals = [
      topic({ topic_id: 1, score: 1 }),
      topic({ topic_id: 2, score: 10 }),
    ];
    const out = sortTopics(deals, "not-a-real-method");
    expect(out.map((d) => d.topic_id)).toEqual([2, 1]);
  });
});
