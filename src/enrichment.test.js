import { describe, expect, it } from "vitest";

import { TAG_FILTER_PREFIX, attachTags, tagFilterTerm, tagSuggestions, visibleTags } from "./enrichment.js";

function topic(overrides = {}) {
  return { topic_id: 1, title: "Sample Deal", Offer: { dealer_name: "Amazon" }, ...overrides };
}

describe("attachTags", () => {
  const enrichment = {
    topics: {
      1: { tags: ["computing"], vv: 1 },
      2: { tags: ["grocery", "home"], vv: 1 },
    },
  };

  it("attaches tags to the matching topic", () => {
    const [tagged] = attachTags([topic({ topic_id: 1 })], enrichment);
    expect(tagged.tags).toEqual(["computing"]);
  });

  it("attaches multiple tags in order", () => {
    const [tagged] = attachTags([topic({ topic_id: 2 })], enrichment);
    expect(tagged.tags).toEqual(["grocery", "home"]);
  });

  it("gives untagged topics an empty array rather than undefined", () => {
    const [tagged] = attachTags([topic({ topic_id: 99 })], enrichment);
    expect(tagged.tags).toEqual([]);
  });

  it("leaves every topic untagged when enrichment is missing", () => {
    const tagged = attachTags([topic({ topic_id: 1 })], null);
    expect(tagged[0].tags).toEqual([]);
  });

  it("leaves every topic untagged when the document has no topics map", () => {
    expect(attachTags([topic({ topic_id: 1 })], {})[0].tags).toEqual([]);
  });

  it("ignores an entry whose tags are not an array", () => {
    const broken = { topics: { 1: { tags: "computing" } } };
    expect(attachTags([topic({ topic_id: 1 })], broken)[0].tags).toEqual([]);
  });

  it("preserves the original topic fields", () => {
    const [tagged] = attachTags([topic({ topic_id: 1, score: 42 })], enrichment);
    expect(tagged).toEqual(expect.objectContaining({ topic_id: 1, score: 42, title: "Sample Deal" }));
  });

  it("does not mutate the input topics", () => {
    const input = [topic({ topic_id: 1 })];
    attachTags(input, enrichment);
    expect(input[0].tags).toBeUndefined();
  });
});

describe("tagFilterTerm", () => {
  it("prefixes a tag so it cannot collide with a plain title search", () => {
    expect(tagFilterTerm("computing")).toBe(`${TAG_FILTER_PREFIX}computing`);
  });
});

describe("tagSuggestions", () => {
  const tags = ["computing", "electronics", "gaming", "grocery", "home"];

  it("suggests nothing without the tag prefix", () => {
    expect(tagSuggestions("gam", tags)).toEqual([]);
    expect(tagSuggestions("", tags)).toEqual([]);
    expect(tagSuggestions(null, tags)).toEqual([]);
  });

  it("lists every tag for a bare prefix, prefixed and alphabetical", () => {
    expect(tagSuggestions("#", tags)).toEqual(["#computing", "#electronics", "#gaming", "#grocery", "#home"]);
  });

  it("ranks prefix matches ahead of substring matches", () => {
    // "computing" merely contains a "g"; the other two start with one.
    expect(tagSuggestions("#g", tags)).toEqual(["#gaming", "#grocery", "#computing"]);
  });

  it("matches case-insensitively", () => {
    expect(tagSuggestions("#GAM", tags)).toEqual(["#gaming"]);
  });

  it("returns nothing for an exact match so Enter applies the filter", () => {
    expect(tagSuggestions("#gaming", tags)).toEqual([]);
    expect(tagSuggestions("#Gaming", tags)).toEqual([]);
  });

  it("returns nothing when no tag matches", () => {
    expect(tagSuggestions("#xyz", tags)).toEqual([]);
    expect(tagSuggestions("#gam", null)).toEqual([]);
    expect(tagSuggestions("#gam", undefined)).toEqual([]);
  });

  it("dedupes tags and skips non-strings", () => {
    expect(tagSuggestions("#", ["gaming", "gaming", null, ""])).toEqual(["#gaming"]);
  });
});

describe("visibleTags", () => {
  /**
   * `other` is a quarantine for deals that are genuinely not products —
   * megathreads, flyer dumps — so it stays in the vocabulary and keeps those
   * out of real categories. It just tells a reader nothing, so it is not
   * rendered. Filtering by `#other` still works, since that reads topic.tags.
   */
  it("hides the catch-all tag", () => {
    expect(visibleTags(["other"])).toEqual([]);
  });

  it("keeps meaningful tags", () => {
    expect(visibleTags(["computing"])).toEqual(["computing"]);
  });

  it("drops only the catch-all from a mixed list, preserving order", () => {
    expect(visibleTags(["grocery", "other"])).toEqual(["grocery"]);
    expect(visibleTags(["other", "sports"])).toEqual(["sports"]);
  });

  it("returns an empty array for a topic with no tags", () => {
    expect(visibleTags(undefined)).toEqual([]);
    expect(visibleTags(null)).toEqual([]);
    expect(visibleTags([])).toEqual([]);
  });

  it("does not mutate the array it was given", () => {
    const tags = ["grocery", "other"];
    visibleTags(tags);
    expect(tags).toEqual(["grocery", "other"]);
  });
});
