import { describe, expect, it } from "vitest";
import {
  CLASSIFIER_INSTRUCTIONS,
  MAX_TAGS_PER_TOPIC,
  TAG_GLOSSES,
  TAG_VOCABULARY,
  VOCABULARY_VERSION,
  mergeEnrichment,
  parseEnrichment,
  sanitizeModelName,
  selectTopicsNeedingTags,
  validateTagBatch,
} from "./enrichment";

describe("vocabulary", () => {
  it("is a non-empty closed list containing a catch-all", () => {
    expect(TAG_VOCABULARY.length).toBeGreaterThan(0);
    expect(TAG_VOCABULARY).toContain("other");
  });

  it("has no duplicate tags", () => {
    expect(new Set(TAG_VOCABULARY).size).toBe(TAG_VOCABULARY.length);
  });

  // Observed on real RFD data: restaurant and pet deals had nowhere to go and
  // landed in `other` or, worse, `grocery` and `apparel`.
  it("covers restaurants and pets", () => {
    expect(TAG_VOCABULARY).toContain("dining");
    expect(TAG_VOCABULARY).toContain("pets");
  });

  it("glosses every tag, so the model is not guessing from the bare name", () => {
    for (const tag of TAG_VOCABULARY) {
      expect(TAG_GLOSSES[tag], `no gloss for "${tag}"`).toBeTruthy();
    }
  });

  it("glosses nothing outside the vocabulary", () => {
    expect(Object.keys(TAG_GLOSSES).sort()).toEqual([...TAG_VOCABULARY].sort());
  });

  // Measured on 1000 real deals: golf balls and a camping tent were tagged
  // `pets`, Sporting Life fell to `other`, and bikes drifted into `automotive`.
  it("covers sporting goods, which had nowhere to go", () => {
    expect(TAG_VOCABULARY).toContain("sports");
  });

  it("does not send bikes to automotive, which is what pulled them out of sports", () => {
    expect(TAG_GLOSSES.automotive).not.toMatch(/\bbikes?\b/i);
    expect(TAG_GLOSSES.sports).toMatch(/\bbikes?\b/i);
  });

  // Observed on real data: an electric scooter, given only its bare title, was
  // tagged `gaming` — the vocabulary had nowhere better for it to go.
  it("gives scooters somewhere to go other than gaming", () => {
    expect(TAG_GLOSSES.gaming).not.toMatch(/scooter/i);
    expect(TAG_GLOSSES.sports).toMatch(/scooter/i);
    expect(TAG_GLOSSES.automotive).toMatch(/scooter/i);
  });

  /**
   * Tripwire in both directions: changing the tag set, the glosses or the
   * instructions without bumping VOCABULARY_VERSION would leave every stored
   * entry tagged the old way forever, since re-tagging is driven entirely by
   * that number. Bumping without changing anything is equally deliberate.
   */
  it("pairs the current tag set with a version that has been bumped for it", () => {
    expect({ version: VOCABULARY_VERSION, tags: [...TAG_VOCABULARY] }).toEqual({
      version: 5,
      tags: [
        "computing", "electronics", "gaming", "telecom", "grocery", "dining",
        "home", "apparel", "sports", "health", "pets", "travel", "financial",
        "automotive", "kids", "entertainment", "other",
      ],
    });
  });
});

describe("parseEnrichment", () => {
  it("returns an empty document when KV holds null", () => {
    expect(parseEnrichment(null)).toEqual({
      vocabulary_version: VOCABULARY_VERSION,
      vocabulary: [...TAG_VOCABULARY],
      glosses: TAG_GLOSSES,
      instructions: CLASSIFIER_INSTRUCTIONS,
      max_tags: MAX_TAGS_PER_TOPIC,
      updated_at: null,
      topics: {},
    });
  });

  it("returns an empty document when KV holds malformed JSON", () => {
    expect(parseEnrichment("{not json").topics).toEqual({});
  });

  it("returns an empty document when the stored value is an array", () => {
    expect(parseEnrichment("[1,2,3]").topics).toEqual({});
  });

  it("returns an empty topics map when topics is not an object", () => {
    expect(parseEnrichment('{"topics":"nope"}').topics).toEqual({});
  });

  /**
   * The deployed constant is authoritative, never the stored copy. Trusting the
   * stored one deadlocks re-tagging: entries sit at the old version, the
   * document reports that same old version, nothing is ever selected, and so
   * nothing ever rewrites the document.
   */
  it("ignores a stored vocabulary_version in favour of the deployed one", () => {
    const raw = JSON.stringify({ vocabulary_version: 1, topics: {} });
    expect(parseEnrichment(raw).vocabulary_version).toBe(VOCABULARY_VERSION);
  });

  it("preserves stored entries", () => {
    const raw = JSON.stringify({
      vocabulary_version: 1,
      updated_at: "2026-08-05T00:00:00.000Z",
      topics: { "42": { tags: ["computing"], vv: 1 } },
    });
    expect(parseEnrichment(raw).topics["42"]).toEqual({ tags: ["computing"], vv: 1 });
  });

  it("round-trips an empty document through JSON, as the endpoint serves it", () => {
    expect(JSON.parse(JSON.stringify(parseEnrichment(null))).topics).toEqual({});
  });
});

describe("published classifier instructions", () => {
  /**
   * The prompt is published with the vocabulary rather than living in the
   * enricher, so a wording change is covered by VOCABULARY_VERSION like any
   * other change to how tags are produced. Previously it sat in providers.mjs,
   * where editing it changed every future tag while leaving stored entries
   * looking current.
   */
  it("is published so the enricher does not carry its own copy", () => {
    expect(parseEnrichment(null).instructions).toBe(CLASSIFIER_INSTRUCTIONS);
    expect(mergeEnrichment(parseEnrichment(null), {}, []).instructions).toBe(CLASSIFIER_INSTRUCTIONS);
  });

  // RYOBI tools split across home/other/computing depending on whether the
  // title said "(Tool-Only)"; gift-card and spend-and-get deals fell to `other`.
  it("tells the model to ignore how the promotion is structured", () => {
    expect(CLASSIFIER_INSTRUCTIONS).toMatch(/gift card/i);
    expect(CLASSIFIER_INSTRUCTIONS).toMatch(/promotion/i);
  });

  it("still asks for a single tag by default", () => {
    expect(CLASSIFIER_INSTRUCTIONS).toMatch(/single|one/i);
  });
});

describe("published vocabulary", () => {
  // The local enricher reads the vocabulary from this payload to build Ollama's
  // JSON schema, rather than keeping its own copy that could drift.
  it("is included in an empty document", () => {
    const empty = parseEnrichment(null);
    expect(empty.vocabulary).toEqual([...TAG_VOCABULARY]);
    expect(empty.max_tags).toBe(MAX_TAGS_PER_TOPIC);
  });

  it("is written into every merged document so reads can stay raw", () => {
    const merged = mergeEnrichment(parseEnrichment(null), { "1": ["gaming"] }, ["1"]);
    expect(merged.vocabulary).toEqual([...TAG_VOCABULARY]);
    expect(merged.max_tags).toBe(MAX_TAGS_PER_TOPIC);
  });

  it("publishes the glosses too, so the enricher prompts with them", () => {
    expect(parseEnrichment(null).glosses).toEqual(TAG_GLOSSES);
    expect(mergeEnrichment(parseEnrichment(null), {}, []).glosses).toEqual(TAG_GLOSSES);
  });
});

describe("validateTagBatch", () => {
  it("accepts a well-formed entry", () => {
    const result = validateTagBatch({ "42": ["computing"] });
    expect(result.accepted).toEqual({ "42": ["computing"] });
    expect(result.rejected).toEqual([]);
  });

  it("rejects a tag outside the vocabulary without discarding valid siblings", () => {
    const result = validateTagBatch({ "42": ["computing"], "43": ["laptops"] });
    expect(result.accepted).toEqual({ "42": ["computing"] });
    expect(result.rejected).toEqual([
      { topic_id: "43", reason: "unknown tag: laptops" },
    ]);
  });

  it("rejects more than the maximum number of tags", () => {
    const tooMany = TAG_VOCABULARY.slice(0, MAX_TAGS_PER_TOPIC + 1);
    const result = validateTagBatch({ "42": tooMany });
    expect(result.accepted).toEqual({});
    expect(result.rejected[0].reason).toBe(
      `too many tags: ${MAX_TAGS_PER_TOPIC + 1} (max ${MAX_TAGS_PER_TOPIC})`,
    );
  });

  it("rejects a non-numeric topic id", () => {
    const result = validateTagBatch({ "abc": ["computing"] });
    expect(result.accepted).toEqual({});
    expect(result.rejected[0].reason).toBe("topic_id is not numeric");
  });

  it("rejects an entry whose tags are not an array", () => {
    const result = validateTagBatch({ "42": "computing" });
    expect(result.accepted).toEqual({});
    expect(result.rejected[0].reason).toBe("tags is not an array");
  });

  it("rejects an entry with no tags", () => {
    const result = validateTagBatch({ "42": [] });
    expect(result.accepted).toEqual({});
    expect(result.rejected[0].reason).toBe("no tags");
  });

  it("deduplicates repeated tags rather than rejecting them", () => {
    const result = validateTagBatch({ "42": ["computing", "computing"] });
    expect(result.accepted).toEqual({ "42": ["computing"] });
    expect(result.rejected).toEqual([]);
  });

  it("returns nothing accepted when given a non-object", () => {
    expect(validateTagBatch(null).accepted).toEqual({});
    expect(validateTagBatch([]).accepted).toEqual({});
  });
});

describe("mergeEnrichment", () => {
  const existing = {
    vocabulary_version: VOCABULARY_VERSION,
    updated_at: "2026-08-01T00:00:00.000Z",
    topics: {
      "1": { tags: ["grocery"] as const, vv: 1 },
      "2": { tags: ["home"] as const, vv: 1 },
    },
  };

  it("adds newly tagged topics", () => {
    const merged = mergeEnrichment(existing, { "3": ["gaming"] }, ["1", "2", "3"]);
    expect(merged.topics["3"]).toEqual({ tags: ["gaming"], vv: VOCABULARY_VERSION });
  });

  it("overwrites an existing entry with the newer tags", () => {
    const merged = mergeEnrichment(existing, { "1": ["computing"] }, ["1", "2"]);
    expect(merged.topics["1"]).toEqual({ tags: ["computing"], vv: VOCABULARY_VERSION });
  });

  it("keeps entries that were not part of this batch", () => {
    const merged = mergeEnrichment(existing, { "1": ["computing"] }, ["1", "2"]);
    expect(merged.topics["2"]).toEqual({ tags: ["home"], vv: 1 });
  });

  it("prunes entries whose topic is no longer in topics.json", () => {
    const merged = mergeEnrichment(existing, {}, ["1"]);
    expect(merged.topics["2"]).toBeUndefined();
    expect(merged.topics["1"]).toBeDefined();
  });

  it("does not prune when the known topic list is empty, to survive a failed topics fetch", () => {
    const merged = mergeEnrichment(existing, {}, []);
    expect(Object.keys(merged.topics).sort()).toEqual(["1", "2"]);
  });

  it("stamps updated_at with the current time", () => {
    const before = Date.now();
    const merged = mergeEnrichment(existing, { "1": ["computing"] }, ["1"]);
    expect(new Date(merged.updated_at as string).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("does not mutate the document it was given", () => {
    mergeEnrichment(existing, { "1": ["computing"] }, ["1"]);
    expect(existing.topics["1"].tags).toEqual(["grocery"]);
  });
});

describe("recording which model produced a tag", () => {
  const empty = parseEnrichment(null);

  it("stamps the model on entries written in this batch", () => {
    const merged = mergeEnrichment(empty, { "1": ["gaming"] }, ["1"], "qwen2.5:7b-instruct");
    expect(merged.topics["1"].m).toBe("qwen2.5:7b-instruct");
  });

  it("omits the field entirely when no model is reported", () => {
    const merged = mergeEnrichment(empty, { "1": ["gaming"] }, ["1"]);
    expect(merged.topics["1"]).not.toHaveProperty("m");
  });

  it("leaves the model on entries that were not part of this batch", () => {
    const existing = {
      ...empty,
      topics: { "1": { tags: ["gaming"] as const, vv: 1, m: "llama3.2:3b" } },
    };
    const merged = mergeEnrichment(existing, { "2": ["grocery"] }, ["1", "2"], "qwen2.5:7b-instruct");
    expect(merged.topics["1"].m).toBe("llama3.2:3b");
    expect(merged.topics["2"].m).toBe("qwen2.5:7b-instruct");
  });

  it("overwrites the model when a topic is re-tagged", () => {
    const existing = {
      ...empty,
      topics: { "1": { tags: ["gaming"] as const, vv: 1, m: "llama3.2:3b" } },
    };
    const merged = mergeEnrichment(existing, { "1": ["grocery"] }, ["1"], "qwen2.5:7b-instruct");
    expect(merged.topics["1"].m).toBe("qwen2.5:7b-instruct");
  });
});

describe("sanitizeModelName", () => {
  it("accepts a normal model identifier", () => {
    expect(sanitizeModelName("qwen2.5:7b-instruct")).toBe("qwen2.5:7b-instruct");
  });

  it("returns undefined for anything that is not a string", () => {
    expect(sanitizeModelName(undefined)).toBeUndefined();
    expect(sanitizeModelName(42)).toBeUndefined();
    expect(sanitizeModelName({ model: "x" })).toBeUndefined();
  });

  it("returns undefined for an empty or whitespace-only name", () => {
    expect(sanitizeModelName("")).toBeUndefined();
    expect(sanitizeModelName("   ")).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeModelName("  llama3.2:3b  ")).toBe("llama3.2:3b");
  });

  it("truncates an absurdly long name rather than storing it", () => {
    expect(sanitizeModelName("x".repeat(500))).toHaveLength(64);
  });
});

describe("selectTopicsNeedingTags", () => {
  const enrichment = {
    vocabulary_version: VOCABULARY_VERSION,
    updated_at: null,
    topics: {
      "1": { tags: ["grocery"] as const, vv: VOCABULARY_VERSION },
      "2": { tags: ["home"] as const, vv: VOCABULARY_VERSION - 1 },
    },
  };

  const topics = [
    { topic_id: 1, title: "already tagged" },
    { topic_id: 2, title: "tagged under an older vocabulary" },
    { topic_id: 3, title: "never tagged" },
  ];

  it("skips topics already tagged at the current vocabulary version", () => {
    const selected = selectTopicsNeedingTags(topics, enrichment);
    expect(selected.map((topic) => topic.topic_id)).not.toContain(1);
  });

  it("selects topics tagged under an older vocabulary version", () => {
    const selected = selectTopicsNeedingTags(topics, enrichment);
    expect(selected.map((topic) => topic.topic_id)).toContain(2);
  });

  it("selects topics that have never been tagged", () => {
    const selected = selectTopicsNeedingTags(topics, enrichment);
    expect(selected.map((topic) => topic.topic_id)).toContain(3);
  });

  it("selects everything when no enrichment exists yet", () => {
    const selected = selectTopicsNeedingTags(topics, parseEnrichment(null));
    expect(selected).toHaveLength(3);
  });
});
