import { describe, expect, it, vi } from "vitest";
import {
  MAX_TAGS_PER_TOPIC,
  TAG_GLOSSES,
  TAG_VOCABULARY,
  VOCABULARY_VERSION,
} from "./_shared/enrichment";
import { onRequestPost as postEnrich } from "./admin/enrich";
import { onRequestGet as getEnrichmentJson } from "./enrichment.json";
import { onRequestGet as getHealthJson } from "./health.json";
import { onRequestGet as getHtml } from "./html";
import { onRequestGet as getTopicsJson } from "./topics.json";

function topic(overrides = {}) {
  return {
    topic_id: 1,
    title: "Deal",
    web_path: "/deal-1/",
    score: 1,
    Offer: { dealer_name: "Dealer", url: "https://dealer.example" },
    ...overrides,
  };
}

function envWithTopics(value) {
  return { TOPICS_KV: { get: vi.fn().mockResolvedValue(value), put: vi.fn() } };
}

describe("topics.json function", () => {
  it("serves raw topic JSON with API and security headers", async () => {
    const data = JSON.stringify([topic({ topic_id: 42 })]);
    const response = await getTopicsJson({ env: envWithTopics(data) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    await expect(response.json()).resolves.toEqual([expect.objectContaining({ topic_id: 42 })]);
  });

  it("serves an empty array when KV has no topics", async () => {
    const response = await getTopicsJson({ env: envWithTopics(null) });

    await expect(response.text()).resolves.toBe("[]");
  });
});

describe("health.json function", () => {
  it("serves refresh status without caching", async () => {
    const status = JSON.stringify({ ok: true, refreshed: 400, stored: 1000, completed_at: "2026-06-29T19:55:00.000Z" });
    const response = await getHealthJson({ env: envWithTopics(status) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ ok: true, stored: 1000 }));
  });
});

describe("html function", () => {
  it("renders topics sorted by score with escaped content", async () => {
    const response = await getHtml({ env: envWithTopics(JSON.stringify([
      topic({
        topic_id: 1,
        title: "Low <script>alert(1)</script>",
        web_path: "/low?x=<bad>",
        score: 1,
        Offer: { dealer_name: "Low & Co", url: "https://low.example/?q=<bad>" },
      }),
      topic({
        topic_id: 2,
        title: "High & Hot",
        web_path: "/high/",
        score: 9,
        Offer: { dealer_name: "High Store", url: "https://high.example/deal" },
      }),
    ])) });

    const html = await response.text();

    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html.indexOf("High &amp; Hot")).toBeLessThan(html.indexOf("Low &lt;script&gt;alert(1)&lt;/script&gt;"));
    expect(html).toContain("https://forums.redflagdeals.com/low?x=&lt;bad&gt;");
    expect(html).toContain("Low &amp; Co —");
    expect(html).toContain("https://low.example/?q=&lt;bad&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("renders topics without optional offer fields", async () => {
    const response = await getHtml({ env: envWithTopics(JSON.stringify([
      topic({ topic_id: 3, title: "Thread only", score: undefined, Offer: undefined }),
      topic({ topic_id: 4, title: "Offer without dealer", score: undefined, Offer: { url: "https://offer.example" } }),
    ])) });

    const html = await response.text();

    expect(html).toContain("Score 0");
    expect(html).toContain("https://offer.example");
    expect(html).not.toContain("undefined —");
  });

  it("renders an empty state when topics are missing or invalid", async () => {
    const response = await getHtml({ env: envWithTopics("not json") });

    await expect(response.text()).resolves.toContain("No deals loaded yet.");
  });

  it("renders tags for enriched topics", async () => {
    const store = new Map([
      ["topics.json", JSON.stringify([topic({ topic_id: 7, title: "RTX 5070" })])],
      ["enrichment.json", JSON.stringify({ topics: { 7: { tags: ["computing", "gaming"], vv: 1 } } })],
    ]);
    const env = { TOPICS_KV: { get: async (key) => store.get(key) ?? null, put: async () => {} } };

    const html = await (await getHtml({ env })).text();

    expect(html).toContain("computing");
    expect(html).toContain("gaming");
  });

  it("renders topics normally when no enrichment exists", async () => {
    const response = await getHtml({ env: envWithTopics(JSON.stringify([topic({ title: "Plain deal" })])) });

    const html = await response.text();
    expect(html).toContain("Plain deal");
    expect(html).not.toContain("undefined");
  });

  it("does not render the catch-all tag, which tells a reader nothing", async () => {
    const store = new Map([
      ["topics.json", JSON.stringify([topic({ topic_id: 7, title: "Weekly flyer thread" })])],
      ["enrichment.json", JSON.stringify({ topics: { 7: { tags: ["other"], vv: 4 } } })],
    ]);
    const env = { TOPICS_KV: { get: async (key) => store.get(key) ?? null, put: async () => {} } };

    const html = await (await getHtml({ env })).text();

    expect(html).toContain("Weekly flyer thread");
    expect(html).not.toContain('class="tag"');
  });

  it("escapes tag content", async () => {
    const store = new Map([
      ["topics.json", JSON.stringify([topic({ topic_id: 7 })])],
      ["enrichment.json", JSON.stringify({ topics: { 7: { tags: ["<script>x</script>"], vv: 1 } } })],
    ]);
    const env = { TOPICS_KV: { get: async (key) => store.get(key) ?? null, put: async () => {} } };

    const html = await (await getHtml({ env })).text();

    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

/** KV double backed by a real map, so writes are observable across keys. */
function envWithStore(entries = {}, extra = {}) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    env: {
      TOPICS_KV: {
        get: async (key) => (store.has(key) ? store.get(key) : null),
        put: async (key, value) => { store.set(key, value); },
      },
      ...extra,
    },
  };
}

function enrichRequest(body, secret = "s3cret") {
  return new Request("https://rfd.davegallant.ca/admin/enrich", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("enrichment.json function", () => {
  it("serves stored enrichment with API and security headers", async () => {
    const stored = JSON.stringify({ vocabulary_version: 1, updated_at: null, topics: { 42: { tags: ["computing"], vv: 1 } } });
    const { env } = envWithStore({ "enrichment.json": stored });

    const response = await getEnrichmentJson({ env });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      topics: { 42: { tags: ["computing"], vv: 1 } },
    }));
  });

  it("serves an empty document when KV has no enrichment", async () => {
    const { env } = envWithStore();

    const response = await getEnrichmentJson({ env });

    await expect(response.json()).resolves.toEqual(expect.objectContaining({ topics: {} }));
  });

  /**
   * Regression: serving the stored document verbatim meant `vocabulary_version`
   * came from whenever it was last written. Bumping the constant then had no
   * effect — entries never looked stale, so nothing re-tagged and nothing
   * rewrote the version.
   */
  it("reports the deployed vocabulary, not whatever was baked into KV", async () => {
    const stale = JSON.stringify({
      vocabulary_version: 1,
      vocabulary: ["obsolete"],
      glosses: { obsolete: "gone" },
      max_tags: 9,
      topics: { 7: { tags: ["computing"], vv: 1 } },
    });
    const { env } = envWithStore({ "enrichment.json": stale });

    const body = await (await getEnrichmentJson({ env })).json();

    expect(body.vocabulary_version).toBe(VOCABULARY_VERSION);
    expect(body.vocabulary).toEqual([...TAG_VOCABULARY]);
    expect(body.glosses).toEqual(TAG_GLOSSES);
    expect(body.max_tags).toBe(MAX_TAGS_PER_TOPIC);
  });

  it("still serves the stored tags while refreshing the vocabulary around them", async () => {
    const stale = JSON.stringify({
      vocabulary_version: 1,
      topics: { 7: { tags: ["computing"], vv: 1, m: "llama3.2:3b" } },
    });
    const { env } = envWithStore({ "enrichment.json": stale });

    const body = await (await getEnrichmentJson({ env })).json();

    expect(body.topics["7"]).toEqual({ tags: ["computing"], vv: 1, m: "llama3.2:3b" });
  });
});

describe("admin/enrich function", () => {
  const topicsJson = JSON.stringify([{ topic_id: 42 }, { topic_id: 43 }]);

  it("returns 404 when the provided secret is wrong", async () => {
    const { env } = envWithStore({ "topics.json": topicsJson }, { REFRESH_SECRET: "s3cret" });

    const response = await postEnrich({ request: enrichRequest({ topics: { 42: ["computing"] } }, "wrong"), env });

    expect(response.status).toBe(404);
  });

  it("returns 404 when no secret is configured", async () => {
    const { env } = envWithStore({ "topics.json": topicsJson });

    const response = await postEnrich({ request: enrichRequest({ topics: { 42: ["computing"] } }), env });

    expect(response.status).toBe(404);
  });

  it("stores accepted tags and reports the count", async () => {
    const { env, store } = envWithStore({ "topics.json": topicsJson }, { REFRESH_SECRET: "s3cret" });

    const response = await postEnrich({ request: enrichRequest({ topics: { 42: ["computing"] } }), env });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ accepted: 1, rejected: [] }));
    expect(JSON.parse(store.get("enrichment.json")).topics["42"].tags).toEqual(["computing"]);
  });

  it("accepts valid entries and reports invalid ones in the same batch", async () => {
    const { env, store } = envWithStore({ "topics.json": topicsJson }, { REFRESH_SECRET: "s3cret" });

    const response = await postEnrich({
      request: enrichRequest({ topics: { 42: ["computing"], 43: ["laptops"] } }),
      env,
    });

    const body = await response.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toEqual([{ topic_id: "43", reason: "unknown tag: laptops" }]);
    expect(JSON.parse(store.get("enrichment.json")).topics["43"]).toBeUndefined();
  });

  it("prunes stored tags for topics that have aged out of topics.json", async () => {
    const stale = JSON.stringify({
      vocabulary_version: 1,
      updated_at: null,
      topics: { 42: { tags: ["home"], vv: 1 }, 999: { tags: ["home"], vv: 1 } },
    });
    const { env, store } = envWithStore(
      { "topics.json": topicsJson, "enrichment.json": stale },
      { REFRESH_SECRET: "s3cret" },
    );

    await postEnrich({ request: enrichRequest({ topics: { 42: ["computing"] } }), env });

    const written = JSON.parse(store.get("enrichment.json")).topics;
    expect(written["999"]).toBeUndefined();
    expect(written["42"].tags).toEqual(["computing"]);
  });

  it("returns 400 on a malformed request body without writing", async () => {
    const { env, store } = envWithStore({ "topics.json": topicsJson }, { REFRESH_SECRET: "s3cret" });
    const request = new Request("https://rfd.davegallant.ca/admin/enrich", {
      method: "POST",
      headers: { authorization: "Bearer s3cret" },
      body: "{not json",
    });

    const response = await postEnrich({ request, env });

    expect(response.status).toBe(400);
    expect(store.has("enrichment.json")).toBe(false);
  });

  it("records the reporting model on the entries it writes", async () => {
    const { env, store } = envWithStore({ "topics.json": topicsJson }, { REFRESH_SECRET: "s3cret" });

    await postEnrich({
      request: enrichRequest({ model: "qwen2.5:7b-instruct", topics: { 42: ["computing"] } }),
      env,
    });

    expect(JSON.parse(store.get("enrichment.json")).topics["42"].m).toBe("qwen2.5:7b-instruct");
  });

  it("stores tags without a model when none is reported", async () => {
    const { env, store } = envWithStore({ "topics.json": topicsJson }, { REFRESH_SECRET: "s3cret" });

    await postEnrich({ request: enrichRequest({ topics: { 42: ["computing"] } }), env });

    const entry = JSON.parse(store.get("enrichment.json")).topics["42"];
    expect(entry.tags).toEqual(["computing"]);
    expect(entry.m).toBeUndefined();
  });

  it("ignores a model field that is not a usable string", async () => {
    const { env, store } = envWithStore({ "topics.json": topicsJson }, { REFRESH_SECRET: "s3cret" });

    await postEnrich({ request: enrichRequest({ model: { evil: true }, topics: { 42: ["computing"] } }), env });

    expect(JSON.parse(store.get("enrichment.json")).topics["42"].m).toBeUndefined();
  });

  it("does not cache its response", async () => {
    const { env } = envWithStore({ "topics.json": topicsJson }, { REFRESH_SECRET: "s3cret" });

    const response = await postEnrich({ request: enrichRequest({ topics: { 42: ["computing"] } }), env });

    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
