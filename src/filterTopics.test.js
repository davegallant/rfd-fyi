import { describe, expect, it } from "vitest";

import {
  filterTopicsByActiveFilters,
  getFilteredSortedTopics,
  parseFilterTerm,
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

// ---------------------------------------------------------------------------
// parseFilterTerm
// ---------------------------------------------------------------------------

describe("parseFilterTerm", () => {
  it("empty string — no error, no regex, empty literal", () => {
    const result = parseFilterTerm("");
    expect(result).toEqual({ regex: null, literal: "", isRegexError: false });
  });

  it("whitespace-only string — treated as empty", () => {
    const result = parseFilterTerm("   ");
    expect(result).toEqual({ regex: null, literal: "", isRegexError: false });
  });

  it("plain substring — lowercased literal, no regex", () => {
    const result = parseFilterTerm("GPU");
    expect(result.regex).toBeNull();
    expect(result.literal).toBe("gpu");
    expect(result.isRegexError).toBe(false);
  });

  it("case-insensitive regex /gpu|nvidia/i — returns compiled RegExp", () => {
    const result = parseFilterTerm("/gpu|nvidia/i");
    expect(result.regex).toBeInstanceOf(RegExp);
    expect(result.regex.flags).toContain("i");
    expect(result.isRegexError).toBe(false);
    expect(result.regex.test("NVIDIA RTX 4090")).toBe(true);
    expect(result.regex.test("AMD Radeon")).toBe(false);
  });

  it("regex without flags /GPU/ — case-sensitive, no i flag", () => {
    const result = parseFilterTerm("/GPU/");
    expect(result.regex).toBeInstanceOf(RegExp);
    expect(result.regex.flags).not.toContain("i");
    expect(result.isRegexError).toBe(false);
    // Case-sensitive: "GPU" matches, "gpu" does not
    expect(result.regex.test("GPU sale")).toBe(true);
    expect(result.regex.test("gpu sale")).toBe(false);
  });

  it("regex with multiple flags /deal/gim — all flags preserved", () => {
    const result = parseFilterTerm("/deal/gim");
    expect(result.regex).toBeInstanceOf(RegExp);
    expect(result.regex.flags).toContain("i");
    expect(result.regex.flags).toContain("m");
    expect(result.isRegexError).toBe(false);
  });

  it("invalid regex /[invalid/ — isRegexError true, falls back to literal", () => {
    const result = parseFilterTerm("/[invalid/");
    expect(result.regex).toBeNull();
    expect(result.isRegexError).toBe(true);
    // Falls back to the full raw string as the literal
    expect(result.literal).toBe("/[invalid/");
  });

  it("invalid regex /(?P<bad>)/ — isRegexError true", () => {
    const result = parseFilterTerm("/(?P<bad>)/");
    expect(result.isRegexError).toBe(true);
    expect(result.regex).toBeNull();
  });

  it("string with a single leading slash is NOT treated as regex", () => {
    const result = parseFilterTerm("/notaregex");
    expect(result.regex).toBeNull();
    expect(result.literal).toBe("/notaregex");
    expect(result.isRegexError).toBe(false);
  });

  it("string with only slashes // — is a valid (empty-pattern) regex", () => {
    // /(?:)/ equivalent — matches everything
    const result = parseFilterTerm("//");
    // '//' matches REGEX_LITERAL with pattern="" which is invalid for our regex
    // since REGEX_LITERAL requires (.+) — at least one char.
    // So "//" is NOT treated as regex; it becomes a literal.
    expect(result.regex).toBeNull();
    expect(result.literal).toBe("//");
    expect(result.isRegexError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterTopicsByActiveFilters
// ---------------------------------------------------------------------------

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

  it("case-insensitive regex /ssd/i matches title regardless of case", () => {
    const mixedCase = [
      topic({ topic_id: 1, title: "SSD Sale", Offer: { dealer_name: "Best Buy" } }),
      topic({ topic_id: 2, title: "ssd deal", Offer: { dealer_name: "Amazon" } }),
      topic({ topic_id: 3, title: "Coffee", Offer: { dealer_name: "Newegg" } }),
    ];
    const out = filterTopicsByActiveFilters(mixedCase, ["/ssd/i"]);
    expect(out.map((d) => d.topic_id).sort()).toEqual([1, 2]);
  });

  it("case-sensitive regex /SSD/ does not match lowercase ssd", () => {
    const mixedCase = [
      topic({ topic_id: 1, title: "SSD Sale", Offer: { dealer_name: "Best Buy" } }),
      topic({ topic_id: 2, title: "ssd deal", Offer: { dealer_name: "Amazon" } }),
    ];
    const out = filterTopicsByActiveFilters(mixedCase, ["/SSD/"]);
    expect(out.map((d) => d.topic_id)).toEqual([1]);
  });

  it("regex alternation /coffee|ssd/i matches multiple unrelated titles", () => {
    const out = filterTopicsByActiveFilters(deals, ["/coffee|ssd/i"]);
    expect(out.map((d) => d.topic_id).sort()).toEqual([1, 2, 3]);
  });

  it("invalid regex falls back to literal match (the raw /[bad/ string)", () => {
    // "/[invalid/" as a literal almost certainly won't match any title,
    // but it should not throw — it degrades to substring search.
    const out = filterTopicsByActiveFilters(deals, ["/[invalid/"]);
    // No deal title/dealer contains the literal "/[invalid/"
    expect(out).toEqual([]);
  });

  it("empty string filter matches all deals", () => {
    // An empty string after trim is treated as no constraint
    const out = filterTopicsByActiveFilters(deals, [""]);
    // literal is "" — "".includes("") is true, so all pass
    expect(out.map((d) => d.topic_id).sort()).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// getFilteredSortedTopics
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// sortTopics
// ---------------------------------------------------------------------------

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
