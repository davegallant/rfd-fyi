import { describe, expect, it, vi, afterEach } from "vitest";
import { refreshTopics, stripRedirects } from "./topics";

function topic(overrides = {}) {
  return {
    topic_id: 1,
    forum_id: 9,
    title: "Deal",
    total_views: 10,
    total_replies: 1,
    web_path: "/deal-1/",
    post_time: "2026-06-28T04:47:33+00:00",
    last_post_time: "2026-06-28T04:47:33+00:00",
    votes: { total_up: 3, total_down: 1 },
    offer: { dealer_name: "Dealer", url: "" },
    ...overrides,
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function pageFromUrl(url) {
  return Number(new URL(String(url)).searchParams.get("page"));
}

describe("refreshTopics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes all hot-deals pages and writes the newest API topics to KV", async () => {
    const target = topic({
      topic_id: 2818435,
      title: "[Premium Only] 1000 Scene+ Pts on 25L Fill V-Power at Shell",
      votes: { total_up: 19, total_down: 1 },
      offer: { dealer_name: "Shell", url: "" },
    });
    const put = vi.fn();

    const fetchMock = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("redirects.json")) return jsonResponse([]);

      const page = pageFromUrl(requestUrl);
      const topics = Array.from({ length: 40 }, (_, index) => topic({
        topic_id: page * 1000 + index,
        title: `Page ${page} deal ${index}`,
      }));
      if (page === 1) topics[8] = target;

      return jsonResponse({ topics });
    });
    vi.stubGlobal("fetch", fetchMock);

    const refreshed = await refreshTopics({ TOPICS_KV: { get: vi.fn(), put } });

    expect(fetchMock).toHaveBeenCalledTimes(26);
    expect(refreshed).toHaveLength(1000);
    expect(refreshed).toContainEqual(expect.objectContaining({
      topic_id: 2818435,
      title: "[Premium Only] 1000 Scene+ Pts on 25L Fill V-Power at Shell",
      score: 18,
      Offer: expect.objectContaining({ dealer_name: "Shell" }),
    }));
    expect(put).toHaveBeenCalledOnce();
    expect(JSON.parse(put.mock.calls[0][1])).toContainEqual(expect.objectContaining({ topic_id: 2818435 }));
  });

  it("keeps RedFlagDeals API requests bounded instead of starting every page at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("redirects.json")) return jsonResponse([]);

      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;

      const page = pageFromUrl(requestUrl);
      return jsonResponse({ topics: [topic({ topic_id: page })] });
    }));

    await refreshTopics({ TOPICS_KV: { get: vi.fn(), put: vi.fn() } });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });
});

describe("stripRedirects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compiles redirect patterns once per refresh instead of once per topic", () => {
    const RealRegExp = RegExp;
    const regExpSpy = vi.fn((pattern, flags) => new RealRegExp(pattern, flags));
    vi.stubGlobal("RegExp", regExpSpy);

    const topics = Array.from({ length: 100 }, (_, index) => topic({
      topic_id: index,
      Offer: { dealer_name: "Store", url: "https://example.com/product" },
    }));

    stripRedirects(topics, [
      { name: "affiliate", pattern: "affiliate\\.example\\?url=(?<baseUrl>.*)" },
      { name: "tracker", pattern: "tracker\\.example\\?u=(?<baseUrl>.*)" },
    ]);

    expect(regExpSpy).toHaveBeenCalledTimes(2);
  });
});
