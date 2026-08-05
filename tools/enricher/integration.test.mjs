import { describe, expect, it, vi } from "vitest";
import { classifyBatch } from "./lib.mjs";
import { resolveProvider } from "./providers.mjs";

const VOCABULARY = ["computing", "dining", "telecom", "grocery", "other"];
const GLOSSES = {
  computing: "computers, laptops, PC parts",
  dining: "restaurants, fast food, cafes",
  telecom: "mobile and internet plans",
  grocery: "supermarket food and drink",
  other: "anything that fits nothing above",
};

/** Titles in the shape RFD actually produces, including Canadian dealers. */
const TOPICS = [
  { topic_id: 1, title: "Lian Li Vector V100 ATX Case $80", Offer: { dealer_name: "Amazon.ca" } },
  { topic_id: 2, title: "Free A&W float with $2 purchase", Offer: { dealer_name: "A&W" } },
  { topic_id: 3, title: "150gb roaming in Italy", Offer: { dealer_name: "lyca mobile" } },
];

const ANSWERS = { "Lian Li": ["computing"], "A&W": ["dining"], "lyca": ["telecom"] };

function fakeOllama(answers, assertRequest = () => {}) {
  return vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    assertRequest({ url, headers: init.headers, body });

    const prompt = JSON.stringify(body);
    const key = Object.keys(answers).find((k) => prompt.includes(k));
    return Response.json({ message: { content: JSON.stringify({ tags: answers[key] ?? ["other"] }) } });
  });
}

function run(topics, fetchImpl, overrides = {}) {
  return classifyBatch(topics, {
    provider: resolveProvider("ollama"),
    config: {},
    vocabulary: VOCABULARY,
    glosses: GLOSSES,
    maxTags: 2,
    concurrency: 2,
    fetchImpl,
    ...overrides,
  });
}

describe("classifyBatch end to end", () => {
  it("tags a batch of real-shaped deals", async () => {
    const fetchImpl = fakeOllama(ANSWERS);

    const { tags, skipped } = await run(TOPICS, fetchImpl);

    expect(tags).toEqual({ 1: ["computing"], 2: ["dining"], 3: ["telecom"] });
    expect(skipped).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("sends the vocabulary, the glosses, and the deal in one request", async () => {
    const seen = [];
    await run(TOPICS.slice(0, 1), fakeOllama(ANSWERS, (req) => seen.push(req)));

    const [{ url, body }] = seen;
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(body.format.properties.tags.items.enum).toEqual(VOCABULARY);
    expect(body.messages[0].content).toContain("restaurants, fast food, cafes");
    expect(body.messages[1].content).toContain("Lian Li Vector V100");
    expect(body.messages[1].content).toContain("Amazon.ca");
  });

  it("reports topics the model could not tag instead of dropping them silently", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ message: { content: "no idea" } }));

    const { tags, skipped } = await run(TOPICS, fetchImpl);

    expect(tags).toEqual({});
    expect(skipped.map((t) => t.topic_id)).toEqual([1, 2, 3]);
  });

  it("propagates a provider failure rather than writing partial tags", async () => {
    const fetchImpl = vi.fn(async () => new Response("model not found", { status: 404 }));

    await expect(run(TOPICS, fetchImpl)).rejects.toThrow(/404/);
  });

  it("keys tags by topic_id as strings, matching the enrichment document", async () => {
    const { tags } = await run(TOPICS.slice(0, 1), fakeOllama(ANSWERS));
    expect(Object.keys(tags)).toEqual(["1"]);
  });

  it("drops a tag the model invents, even though the schema should prevent it", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      message: { content: JSON.stringify({ tags: ["restaurants", "dining"] }) },
    }));

    const { tags } = await run(TOPICS.slice(0, 1), fetchImpl);

    expect(tags["1"]).toEqual(["dining"]);
  });
});
