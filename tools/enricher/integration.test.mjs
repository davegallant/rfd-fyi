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

  it("sends the vocabulary, glosses, instructions, and the deal in one request", async () => {
    const seen = [];
    await run(TOPICS.slice(0, 1), fakeOllama(ANSWERS, (req) => seen.push(req)), {
      instructions: "Categorise by what the buyer ends up with.",
    });

    const [{ url, body }] = seen;
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(body.format.properties.tags.items.enum).toEqual(VOCABULARY);
    expect(body.messages[0].content).toContain("Categorise by what the buyer ends up with.");
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

/**
 * The two shapes a proxy can answer in. Which one you get depends on whether
 * the backend has native structured output or LiteLLM emulated it with tool
 * calling, and the enricher must not care.
 */
describe("classifyBatch through an OpenAI-compatible proxy", () => {
  function fakeProxy(toMessage) {
    return vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      const prompt = JSON.stringify(body);
      const key = Object.keys(ANSWERS).find((k) => prompt.includes(k));
      return Response.json({ choices: [{ message: toMessage(ANSWERS[key] ?? ["other"]) }] });
    });
  }

  function runProxy(fetchImpl, config = {}) {
    return run(TOPICS, fetchImpl, { provider: resolveProvider("litellm"), config });
  }

  it("tags a batch when the model answers in content", async () => {
    const { tags } = await runProxy(fakeProxy((tags) => ({ content: JSON.stringify({ tags }) })));
    expect(tags).toEqual({ 1: ["computing"], 2: ["dining"], 3: ["telecom"] });
  });

  it("tags a batch when response_format was emulated with a tool call", async () => {
    const { tags } = await runProxy(fakeProxy((tags) => ({
      content: null,
      tool_calls: [{ function: { arguments: JSON.stringify({ tags }) } }],
    })));
    expect(tags).toEqual({ 1: ["computing"], 2: ["dining"], 3: ["telecom"] });
  });

  it("constrains the answer to the vocabulary and authenticates when given a key", async () => {
    const seen = [];
    const fetchImpl = vi.fn(async (url, init) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return Response.json({ choices: [{ message: { content: '{"tags":["computing"]}' } }] });
    });

    await run(TOPICS.slice(0, 1), fetchImpl, {
      provider: resolveProvider("litellm"),
      config: { apiKey: "sk-secret" },
    });

    const [{ url, headers, body }] = seen;
    expect(url).toBe("http://hephaestus:4000/v1/chat/completions");
    expect(headers.authorization).toBe("Bearer sk-secret");
    for (const tag of VOCABULARY) expect(body.messages[0].content).toContain(tag);
    expect(body.messages[0].content).toMatch(/JSON only/i);
    expect(body.messages[1].content).toContain("Lian Li Vector V100");
  });

  it("propagates a rate limit rather than writing partial tags", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limit exceeded", { status: 429 }));
    await expect(runProxy(fetchImpl)).rejects.toThrow(/429/);
  });
});
