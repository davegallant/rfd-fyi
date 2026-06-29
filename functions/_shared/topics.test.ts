import { describe, expect, it, vi, afterEach } from "vitest";
import {
  computeScores,
  deduplicateTopics,
  filterNonSponsorTopics,
  readTopics,
  readTopicsJson,
  refreshTopics,
  stripRedirects,
} from "./topics";

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

describe("readTopicsJson", () => {
  it("returns stored JSON when KV has topics", async () => {
    const data = "[{\"topic_id\":1}]";

    await expect(readTopicsJson({ TOPICS_KV: { get: vi.fn().mockResolvedValue(data), put: vi.fn() } }))
      .resolves.toBe(data);
  });

  it("returns an empty array JSON string when KV is empty", async () => {
    await expect(readTopicsJson({ TOPICS_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } }))
      .resolves.toBe("[]");
  });
});

describe("readTopics", () => {
  it("parses topic arrays from KV", async () => {
    const env = { TOPICS_KV: { get: vi.fn().mockResolvedValue(JSON.stringify([topic({ topic_id: 7 })])), put: vi.fn() } };

    await expect(readTopics(env)).resolves.toEqual([expect.objectContaining({ topic_id: 7 })]);
  });

  it("returns an empty array for invalid JSON or non-array JSON", async () => {
    await expect(readTopics({ TOPICS_KV: { get: vi.fn().mockResolvedValue("not json"), put: vi.fn() } }))
      .resolves.toEqual([]);
    await expect(readTopics({ TOPICS_KV: { get: vi.fn().mockResolvedValue("{\"topics\":[]}"), put: vi.fn() } }))
      .resolves.toEqual([]);
  });
});

describe("refreshTopics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes all hot-deals pages and writes the newest API topics to KV", async () => {
    const target = topic({
      topic_id: 2818435,
      title: "[Premium Only] 1000 Scene+ Pts on 25L Fill V-Power at Shell",
      votes: { total_up: 19, total_down: 1, current_vote: 0 },
      offer: { dealer_name: "Shell", url: "", price: "CA $1" },
      summary: { body: "unused API payload" },
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
    const storedTarget = JSON.parse(put.mock.calls[0][1]).find((row) => row.topic_id === 2818435);
    expect(storedTarget).toEqual(expect.objectContaining({ topic_id: 2818435 }));
    expect(storedTarget.summary).toBeUndefined();
    expect(storedTarget.Offer.price).toBeUndefined();
    expect(storedTarget.Votes.current_vote).toBeUndefined();
  });

  it("uses configured API and redirects origins", async () => {
    const fetchMock = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.startsWith("https://redirects.example.test")) return jsonResponse([]);

      expect(requestUrl.startsWith("https://rfd.example.test/api/topics?")).toBe(true);
      return jsonResponse({ topics: [topic({ topic_id: pageFromUrl(requestUrl) })] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await refreshTopics({
      TOPICS_KV: { get: vi.fn(), put: vi.fn() },
      RFD_BASE_URL: "https://rfd.example.test/",
      REDIRECTS_URL: "https://redirects.example.test/list.json",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://redirects.example.test/list.json", expect.any(Object));
  });

  it("does not overwrite KV when every deals request fails", async () => {
    const put = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));

    await expect(refreshTopics({ TOPICS_KV: { get: vi.fn(), put } })).resolves.toEqual([]);

    expect(put).not.toHaveBeenCalled();
  });

  it("treats thrown page fetches as empty pages", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("redirects.json")) return jsonResponse([]);
      if (pageFromUrl(requestUrl) === 2) throw new Error("network down");
      return jsonResponse({ topics: [topic({ topic_id: pageFromUrl(requestUrl) })] });
    }));

    const refreshed = await refreshTopics({ TOPICS_KV: { get: vi.fn(), put: vi.fn() } });

    expect(refreshed).toHaveLength(24);
    expect(refreshed).not.toContainEqual(expect.objectContaining({ topic_id: 2 }));
    expect(warn).toHaveBeenCalledWith("error fetching deals", expect.any(Error));
  });

  it("skips failed pages but preserves successful pages", async () => {
    const put = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("redirects.json")) return jsonResponse([]);
      if (pageFromUrl(requestUrl) === 2) return new Response("nope", { status: 500 });
      return jsonResponse({ topics: [topic({ topic_id: pageFromUrl(requestUrl) })] });
    }));

    const refreshed = await refreshTopics({ TOPICS_KV: { get: vi.fn(), put } });

    expect(refreshed).toHaveLength(24);
    expect(refreshed).not.toContainEqual(expect.objectContaining({ topic_id: 2 }));
    expect(put).toHaveBeenCalledOnce();
  });

  it("continues without redirects when the redirects endpoint fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("redirects.json")) return new Response("nope", { status: 503 });
      return jsonResponse({ topics: [topic({ topic_id: pageFromUrl(requestUrl) })] });
    }));

    const refreshed = await refreshTopics({ TOPICS_KV: { get: vi.fn(), put: vi.fn() } });

    expect(refreshed).toHaveLength(25);
    expect(warn).toHaveBeenCalledWith("unexpected status fetching redirects: 503");
  });

  it("continues without redirects when the redirects endpoint throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("redirects.json")) throw new Error("redirects unavailable");
      return jsonResponse({ topics: [topic({ topic_id: pageFromUrl(requestUrl) })] });
    }));

    const refreshed = await refreshTopics({ TOPICS_KV: { get: vi.fn(), put: vi.fn() } });

    expect(refreshed).toHaveLength(25);
    expect(warn).toHaveBeenCalledWith("error fetching redirects", expect.any(Error));
  });

  it("ignores malformed redirects responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("redirects.json")) return jsonResponse({ redirects: [] });
      return jsonResponse({ topics: [topic({ topic_id: pageFromUrl(requestUrl) })] });
    }));

    const refreshed = await refreshTopics({ TOPICS_KV: { get: vi.fn(), put: vi.fn() } });

    expect(refreshed).toHaveLength(25);
  });

  it("filters sponsored topics, deduplicates repeated topics, and preserves first occurrence", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("redirects.json")) return jsonResponse([]);
      if (pageFromUrl(requestUrl) !== 1) return jsonResponse({ topics: [] });

      return jsonResponse({ topics: [
        topic({ topic_id: 10, title: "First copy", votes: { total_up: 5, total_down: 1 } }),
        topic({ topic_id: 10, title: "Second copy", votes: { total_up: 99, total_down: 0 } }),
        topic({ topic_id: 11, title: "[Sponsored] Paid placement" }),
        topic({
          topic_id: 12,
          title: "Paid placement without sponsored title marker",
          offer: { dealer_name: "Advertiser", url: "https://pubads.g.doubleclick.net/gampad/clk?id=123&iu=/1030735/redflagdeals" },
        }),
      ] });
    }));

    const refreshed = await refreshTopics({ TOPICS_KV: { get: vi.fn(), put: vi.fn() } });

    expect(refreshed).toEqual([expect.objectContaining({ topic_id: 10, title: "First copy", score: 4 })]);
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

describe("topic transforms", () => {
  it("computes scores from either normalized or API vote casing", () => {
    expect(computeScores([
      topic({ topic_id: 1, Votes: { total_up: 7, total_down: 2 }, votes: undefined }),
      topic({ topic_id: 2, votes: { total_up: 1, total_down: 4 } }),
      topic({ topic_id: 3, votes: undefined }),
    ])).toEqual([
      expect.objectContaining({ topic_id: 1, score: 5, Votes: { total_up: 7, total_down: 2 } }),
      expect.objectContaining({ topic_id: 2, score: -3, Votes: { total_up: 1, total_down: 4 } }),
      expect.objectContaining({ topic_id: 3, score: 0 }),
    ]);
  });

  it("deduplicates topics by topic_id while preserving order", () => {
    expect(deduplicateTopics([
      topic({ topic_id: 1, title: "first" }),
      topic({ topic_id: 2, title: "second" }),
      topic({ topic_id: 1, title: "duplicate" }),
    ])).toEqual([
      expect.objectContaining({ topic_id: 1, title: "first" }),
      expect.objectContaining({ topic_id: 2, title: "second" }),
    ]);
  });

  it("filters sponsored title markers and ad click placements", () => {
    expect(filterNonSponsorTopics([
      topic({ topic_id: 1, title: "[Sponsored] Paid placement" }),
      topic({ topic_id: 2, title: "Great deal" }),
      topic({ topic_id: 3, title: "Not [Sponsored] in the middle" }),
      topic({
        topic_id: 4,
        title: "Paid placement without sponsored title marker",
        offer: { dealer_name: "Advertiser", url: "https://pubads.g.doubleclick.net/gampad/clk?id=123&iu=/1030735/redflagdeals" },
      }),
    ])).toEqual([
      expect.objectContaining({ topic_id: 2 }),
      expect.objectContaining({ topic_id: 3 }),
    ]);
  });
});

describe("stripRedirects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decodes matching redirect URLs and leaves non-matches unchanged", () => {
    const topics = [
      topic({
        topic_id: 1,
        Offer: { dealer_name: "Store", url: "https://affiliate.example/click?url=https%3A%2F%2Fstore.example%2Fa%2Bb" },
      }),
      topic({ topic_id: 2, Offer: { dealer_name: "Store", url: "https://store.example/direct" } }),
      topic({ topic_id: 3, Offer: { dealer_name: "Store", url: "" } }),
    ];

    expect(stripRedirects(topics, [{ name: "affiliate", pattern: "affiliate\\.example.*url=(?<baseUrl>.*)" }]))
      .toEqual([
        expect.objectContaining({
          topic_id: 1,
          Offer: expect.objectContaining({ url: "https://store.example/a+b" }),
        }),
        expect.objectContaining({ topic_id: 2, Offer: expect.objectContaining({ url: "https://store.example/direct" }) }),
        expect.objectContaining({ topic_id: 3, Offer: expect.objectContaining({ url: "" }) }),
      ]);
  });

  it("skips invalid redirect patterns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const topics = [topic({ Offer: { dealer_name: "Store", url: "https://tracker.example/?u=https%3A%2F%2Fstore.example" } })];

    expect(stripRedirects(topics, [
      { name: "bad", pattern: "(" },
      { name: "good", pattern: "tracker\\.example.*u=(?<baseUrl>.*)" },
    ])).toEqual([
      expect.objectContaining({ Offer: expect.objectContaining({ url: "https://store.example" }) }),
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid redirect pattern bad"), expect.any(SyntaxError));
  });

  it("keeps the original topic when a redirect URL cannot be decoded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = topic({ Offer: { dealer_name: "Store", url: "https://tracker.example/?u=%E0%A4%A" } });

    expect(stripRedirects([original], [{ name: "bad-url", pattern: "tracker\\.example.*u=(?<baseUrl>.*)" }]))
      .toEqual([original]);
    expect(warn).toHaveBeenCalledWith("failed to decode redirect URL", expect.any(URIError));
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
