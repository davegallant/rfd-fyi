import { describe, expect, it, vi } from "vitest";
import {
  chunk,
  classifyTopic,
  fetchJson,
  formatProgress,
  postTags,
  mapWithConcurrency,
  parseTags,
  rotateVocabulary,
  selectUntagged,
} from "./lib.mjs";
import { resolveProvider } from "./providers.mjs";

const VOCABULARY = ["computing", "gaming", "grocery", "other"];
const TOPIC = { topic_id: 1, title: "RTX 5070", Offer: { dealer_name: "Newegg" } };

describe("selectUntagged", () => {
  const topics = [
    { topic_id: 1, title: "tagged now" },
    { topic_id: 2, title: "tagged under old vocabulary" },
    { topic_id: 3, title: "never tagged" },
  ];
  const enrichment = {
    vocabulary_version: 2,
    topics: { 1: { tags: ["gaming"], vv: 2 }, 2: { tags: ["gaming"], vv: 1 } },
  };

  it("skips topics tagged at the current vocabulary version", () => {
    expect(selectUntagged(topics, enrichment).map((t) => t.topic_id)).not.toContain(1);
  });

  it("reselects topics tagged under an older vocabulary version", () => {
    expect(selectUntagged(topics, enrichment).map((t) => t.topic_id)).toContain(2);
  });

  it("selects topics with no entry at all", () => {
    expect(selectUntagged(topics, enrichment).map((t) => t.topic_id)).toContain(3);
  });

  it("selects everything when the enrichment document is empty", () => {
    expect(selectUntagged(topics, { vocabulary_version: 2, topics: {} })).toHaveLength(3);
  });
});

describe("parseTags", () => {
  it("extracts tags from the model's JSON output", () => {
    expect(parseTags('{"tags":["computing"]}', VOCABULARY, 2)).toEqual(["computing"]);
  });

  it("drops tags outside the published vocabulary", () => {
    expect(parseTags('{"tags":["computing","laptops"]}', VOCABULARY, 2)).toEqual(["computing"]);
  });

  it("truncates to the maximum tag count", () => {
    expect(parseTags('{"tags":["computing","gaming","grocery"]}', VOCABULARY, 2))
      .toEqual(["computing", "gaming"]);
  });

  it("deduplicates repeated tags", () => {
    expect(parseTags('{"tags":["gaming","gaming"]}', VOCABULARY, 2)).toEqual(["gaming"]);
  });

  it("tolerates prose wrapped around the JSON, which weaker models emit", () => {
    expect(parseTags('Sure!\n{"tags":["gaming"]}\nHope that helps.', VOCABULARY, 2))
      .toEqual(["gaming"]);
  });

  it("returns null for unparseable content", () => {
    expect(parseTags("sorry, I cannot", VOCABULARY, 2)).toBeNull();
  });

  it("returns null when no tag survives validation", () => {
    expect(parseTags('{"tags":["laptops"]}', VOCABULARY, 2)).toBeNull();
  });

  it("returns null when tags is missing", () => {
    expect(parseTags('{"category":"computing"}', VOCABULARY, 2)).toBeNull();
  });

  it("returns null for null content", () => {
    expect(parseTags(null, VOCABULARY, 2)).toBeNull();
  });
});

describe("chunk", () => {
  it("splits a list into batches of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty list unchanged", () => {
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("mapWithConcurrency", () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  };

  it("returns results in input order regardless of completion order", async () => {
    const results = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("runs no more than the limit at once", async () => {
    let running = 0;
    let peak = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
    });

    expect(peak).toBe(2);
  });

  it("actually overlaps work rather than running serially", async () => {
    const first = deferred();
    const finished = [];

    const all = mapWithConcurrency([0, 1], 2, async (index) => {
      if (index === 0) await first.promise;
      finished.push(index);
      return index;
    });

    // Real time passes while item 0 is blocked. A serial implementation would
    // still be stuck on it and finish nothing.
    await new Promise((r) => setTimeout(r, 10));
    expect(finished).toEqual([1]);

    first.resolve();
    await expect(all).resolves.toEqual([0, 1]);
    expect(finished).toEqual([1, 0]);
  });

  it("passes the index to the worker", async () => {
    expect(await mapWithConcurrency(["a", "b"], 1, async (item, index) => `${index}${item}`))
      .toEqual(["0a", "1b"]);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it("rejects when a worker throws", async () => {
    await expect(mapWithConcurrency([1, 2], 2, async () => { throw new Error("boom"); }))
      .rejects.toThrow("boom");
  });
});

describe("fetchJson", () => {
  const url = "https://rfd.example/enrichment.json";

  it("returns the parsed body on success", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    await expect(fetchJson(url, fetchImpl)).resolves.toEqual({ ok: true });
  });

  it("names the URL and status when the response is not ok", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(fetchJson(url, fetchImpl)).rejects.toThrow(/enrichment\.json.*404/);
  });

  /**
   * Cloudflare Pages serves the SPA's index.html for unmatched routes, with a
   * 200. Without this the enricher reported `Unexpected token '<'` and no URL,
   * which says nothing about the actual cause: the endpoint is not deployed.
   */
  it("explains an HTML body rather than failing on a JSON parse error", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!DOCTYPE html><html>…</html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));

    const error = await fetchJson(url, fetchImpl).catch((e) => e);

    expect(error.message).toMatch(/enrichment\.json/);
    expect(error.message).toMatch(/HTML/i);
    expect(error.message).toMatch(/deployed/i);
    expect(error.message).not.toMatch(/Unexpected token/);
  });

  it("names the URL when the connection fails outright", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(fetchJson(url, fetchImpl)).rejects.toThrow(/enrichment\.json.*fetch failed/);
  });

  it("shows a snippet when the body is neither JSON nor HTML", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json at all", { status: 200 }));
    await expect(fetchJson(url, fetchImpl)).rejects.toThrow(/not json at all/);
  });
});

describe("postTags", () => {
  const origin = "https://rfd.example";

  it("posts the tags and model, and returns the server's report", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ accepted: 2, rejected: [], stored: 900 }));

    const body = await postTags(origin, "s3cret", { 1: ["gaming"] }, "qwen2.5:7b-instruct", fetchImpl);

    expect(body.accepted).toBe(2);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://rfd.example/admin/enrich");
    expect(init.headers.authorization).toBe("Bearer s3cret");
    expect(JSON.parse(init.body)).toEqual({ model: "qwen2.5:7b-instruct", topics: { 1: ["gaming"] } });
  });

  /**
   * /admin/enrich returns 404 rather than 401 on bad auth so it does not
   * advertise itself. That makes a missing secret look identical to a missing
   * route, so the enricher has to say which it probably is.
   */
  it("reads a 404 as an auth problem, since that is what it means here", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }));

    const error = await postTags(origin, "wrong", {}, "m", fetchImpl).catch((e) => e);

    expect(error.message).toMatch(/REFRESH_SECRET/);
    expect(error.message).toMatch(/404/);
  });

  it("reports other failures with their status", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    await expect(postTags(origin, "s", {}, "m", fetchImpl)).rejects.toThrow(/500/);
  });
});

describe("formatProgress", () => {
  it("reports position and percentage", () => {
    expect(formatProgress(450, 1000, 60_000)).toContain("450/1000 (45%)");
  });

  it("estimates the time left from the rate so far", () => {
    // 100 items in 10s = 10/s; 900 left is 90s.
    expect(formatProgress(100, 1000, 10_000)).toContain("~1m 30s left");
  });

  it("shows seconds alone when under a minute remains", () => {
    expect(formatProgress(900, 1000, 90_000)).toContain("~10s left");
  });

  it("omits the estimate on the final batch", () => {
    expect(formatProgress(1000, 1000, 60_000)).toBe("1000/1000 (100%)");
  });

  it("omits the estimate before anything has been processed", () => {
    expect(formatProgress(0, 1000, 0)).toBe("0/1000 (0%)");
  });

  it("does not divide by zero when no time has elapsed yet", () => {
    expect(formatProgress(50, 1000, 0)).toBe("50/1000 (5%)");
  });

  it("handles an empty work set without producing NaN", () => {
    expect(formatProgress(0, 0, 0)).not.toMatch(/NaN|Infinity/);
  });
});

describe("classifyTopic", () => {
  function run(fetchImpl, config = {}) {
    return classifyTopic(TOPIC, {
      provider: resolveProvider("ollama"),
      config,
      vocabulary: VOCABULARY,
      glosses: undefined,
      maxTags: 2,
      fetchImpl,
    });
  }

  it("returns validated tags from an ollama response", async () => {
    const fetchMock = vi.fn(async () => Response.json({ message: { content: '{"tags":["computing"]}' } }));

    await expect(run(fetchMock)).resolves.toEqual(["computing"]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/chat");
  });

  it("routes to a remote Ollama host", async () => {
    const fetchMock = vi.fn(async () => Response.json({ message: { content: '{"tags":["gaming"]}' } }));

    await run(fetchMock, { baseUrl: "http://hephaestus:11434" });

    expect(fetchMock.mock.calls[0][0]).toBe("http://hephaestus:11434/api/chat");
  });

  it("throws with the status and provider name so a failed run is diagnosable", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));

    await expect(run(fetchMock)).rejects.toThrow(/ollama.*500/);
  });

  it("includes the response body in the error, where the reason usually is", async () => {
    const fetchMock = vi.fn(async () => new Response("model not found", { status: 404 }));

    await expect(run(fetchMock)).rejects.toThrow(/model not found/);
  });

  it("returns null rather than throwing when the model gives no usable tags", async () => {
    const fetchMock = vi.fn(async () => Response.json({ message: { content: "I refuse" } }));

    await expect(run(fetchMock)).resolves.toBeNull();
  });
});

describe("rotateVocabulary", () => {
  const vocabulary = ["computing", "electronics", "gaming", "other"];

  it("moves a different tag to the front for each offset", () => {
    expect(rotateVocabulary(vocabulary, 1)).toEqual(["electronics", "gaming", "other", "computing"]);
    expect(rotateVocabulary(vocabulary, 2)).toEqual(["gaming", "other", "computing", "electronics"]);
  });

  it("keeps every tag exactly once, so the schema enum stays complete", () => {
    for (let seed = 0; seed < 10; seed += 1) {
      expect([...rotateVocabulary(vocabulary, seed)].sort()).toEqual([...vocabulary].sort());
    }
  });

  it("wraps rather than running off the end", () => {
    expect(rotateVocabulary(vocabulary, 4)).toEqual(vocabulary);
    expect(rotateVocabulary(vocabulary, 5)).toEqual(rotateVocabulary(vocabulary, 1));
  });

  // Seeded by topic id, so the same deal gets the same ordering on every run.
  // Without that, a re-tag would move deals for no reason and no two
  // evaluations would be comparable.
  it("is deterministic for a given seed", () => {
    expect(rotateVocabulary(vocabulary, 7)).toEqual(rotateVocabulary(vocabulary, 7));
  });

  it("does not mutate the list it was given", () => {
    const original = [...vocabulary];
    rotateVocabulary(vocabulary, 2);
    expect(vocabulary).toEqual(original);
  });

  it("survives a negative or missing seed rather than producing a hole", () => {
    expect(rotateVocabulary(vocabulary, -1)).toEqual(["other", "computing", "electronics", "gaming"]);
    expect(rotateVocabulary(vocabulary, 0)).toEqual(vocabulary);
  });

  it("returns an empty vocabulary untouched", () => {
    expect(rotateVocabulary([], 3)).toEqual([]);
  });
});

describe("classifyTopic transport errors", () => {
  /**
   * The most common failure is an unreachable model: Ollama binds to 127.0.0.1
   * and refuses LAN connections until OLLAMA_HOST is set. A bare `fetch failed`
   * names neither the host nor the port.
   */
  it("names the URL and provider when the connection fails outright", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); });

    const error = await classifyTopic(TOPIC, {
      provider: resolveProvider("ollama"),
      config: { baseUrl: "http://hephaestus:11434" },
      vocabulary: VOCABULARY,
      glosses: {},
      instructions: "classify",
      maxTags: 2,
      fetchImpl,
    }).catch((e) => e);

    expect(error.message).toMatch(/hephaestus:11434/);
    expect(error.message).toMatch(/ollama/);
    expect(error.message).toMatch(/reachable/);
  });
});

describe("classifyTopic rotation", () => {
  const run = async (rotate, topicId) => {
    const fetchImpl = vi.fn(async () => Response.json({ message: { content: '{"tags":["gaming"]}' } }));
    await classifyTopic({ ...TOPIC, topic_id: topicId }, {
      provider: resolveProvider("ollama"),
      config: {},
      vocabulary: VOCABULARY,
      glosses: {},
      instructions: "classify",
      maxTags: 2,
      rotate,
      fetchImpl,
    });
    return JSON.parse(fetchImpl.mock.calls[0][1].body);
  };

  it("leaves the order alone unless rotation is asked for", async () => {
    const body = await run(false, 1);
    expect(body.format.properties.tags.items.enum).toEqual(VOCABULARY);
  });

  it("rotates both the prompt and the schema enum, so they cannot disagree", async () => {
    const body = await run(true, 1);
    expect(body.format.properties.tags.items.enum).toEqual(["gaming", "grocery", "other", "computing"]);
    expect(body.messages[0].content).toMatch(/Allowed categories:\n- gaming/);
  });

  it("gives different topics different leading tags", async () => {
    const first = await run(true, 1);
    const second = await run(true, 2);
    expect(first.format.properties.tags.items.enum[0]).not.toBe(second.format.properties.tags.items.enum[0]);
  });
});
