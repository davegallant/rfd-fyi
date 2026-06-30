import { describe, expect, it, vi } from "vitest";
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
});
