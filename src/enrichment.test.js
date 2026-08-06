import { describe, expect, it } from "vitest";

import { TAG_FILTER_PREFIX, attachTags, tagFilterTerm } from "./enrichment.js";

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
