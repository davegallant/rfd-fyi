const TOPICS_KEY = "topics.json";
const REFRESH_STATUS_KEY = "refresh-status.json";
const RFD_FORUM_BASE = "https://forums.redflagdeals.com";
const DEFAULT_REDIRECTS_URL = "https://raw.githubusercontent.com/davegallant/rfd-redirect-stripper/main/redirects.json";
const DEALS_FETCH_CONCURRENCY = 5;
const REFRESHED_HOT_DEALS_PAGE_COUNT = 5;
const MAX_STORED_TOPIC_COUNT = 1000;

export interface Env {
  TOPICS_KV: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  RFD_BASE_URL?: string;
  REDIRECTS_URL?: string;
}

interface TopicsResponse {
  topics?: Topic[];
}

export interface RefreshStatus {
  ok: boolean;
  refreshed: number;
  stored: number;
  completed_at: string;
}

export interface Topic {
  topic_id: number;
  forum_id: number;
  title: string;
  total_views: number;
  total_replies: number;
  web_path: string;
  post_time: string;
  last_post_time: string;
  Votes?: Votes;
  Offer?: Offer;
  votes?: Votes;
  offer?: Offer;
  score?: number;
}

interface Votes {
  total_up: number;
  total_down: number;
}

interface Offer {
  dealer_name?: string;
  url?: string;
}

interface Redirect {
  name: string;
  pattern: string;
}

interface CompiledRedirect extends Redirect {
  regex: RegExp;
}

export async function readTopicsJson(env: Env): Promise<string> {
  return (await env.TOPICS_KV.get(TOPICS_KEY)) ?? "[]";
}

export async function readTopics(env: Env): Promise<Topic[]> {
  const data = await readTopicsJson(env);
  try {
    const topics = JSON.parse(data);
    return Array.isArray(topics) ? topics : [];
  } catch {
    return [];
  }
}

export async function readRefreshStatusJson(env: Env): Promise<string> {
  return (await env.TOPICS_KV.get(REFRESH_STATUS_KEY)) ?? JSON.stringify({
    ok: false,
    refreshed: 0,
    stored: 0,
    completed_at: null,
  });
}

export async function refreshTopics(env: Env): Promise<Topic[]> {
  let refreshedTopics = await getDeals(env, 9, 1, REFRESHED_HOT_DEALS_PAGE_COUNT + 1);

  if (refreshedTopics.length === 0) {
    return [];
  }

  refreshedTopics = deduplicateTopics(refreshedTopics);
  refreshedTopics = computeScores(refreshedTopics);
  const redirects = await getRedirects(env);
  refreshedTopics = stripRedirects(refreshedTopics, redirects);

  const existingTopics = (await readTopics(env)).map((topic) => compactTopic(normalizeTopic(topic)));
  const topics = deduplicateTopics([...refreshedTopics, ...existingTopics]).slice(0, MAX_STORED_TOPIC_COUNT);

  await env.TOPICS_KV.put(TOPICS_KEY, JSON.stringify(topics));
  await writeRefreshStatus(env, {
    ok: true,
    refreshed: refreshedTopics.length,
    stored: topics.length,
    completed_at: new Date().toISOString(),
  });
  return topics;
}

async function writeRefreshStatus(env: Env, status: RefreshStatus): Promise<void> {
  await env.TOPICS_KV.put(REFRESH_STATUS_KEY, JSON.stringify(status));
}

async function getDeals(env: Env, id: number, firstPage: number, lastPage: number): Promise<Topic[]> {
  const topics: Topic[] = [];
  const base = (env.RFD_BASE_URL || RFD_FORUM_BASE).replace(/\/$/, "");
  const pages = Array.from({ length: lastPage - firstPage }, (_, index) => firstPage + index);

  for (let index = 0; index < pages.length; index += DEALS_FETCH_CONCURRENCY) {
    const batch = pages.slice(index, index + DEALS_FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map((page) => fetchDealsPage(base, id, page)));
    topics.push(...results.flat());
  }

  return topics;
}

async function fetchDealsPage(base: string, id: number, page: number): Promise<Topic[]> {
  const requestUrl = `${base}/api/topics?forum_id=${id}&per_page=40&page=${page}`;

  try {
    const response = await fetch(requestUrl, {
      headers: {
        "accept": "application/json",
        "user-agent": "rfd-fyi/1.0 (+https://github.com/davegallant/rfd-fyi)",
      },
    });
    if (!response.ok) {
      console.warn(`unexpected status fetching deals: ${response.status}`);
      return [];
    }

    const body = await response.json<TopicsResponse>();
    return filterNonSponsorTopics(body.topics ?? []).map(normalizeTopic);
  } catch (error) {
    console.warn("error fetching deals", error);
    return [];
  }
}

async function getRedirects(env: Env): Promise<Redirect[]> {
  try {
    const response = await fetch(env.REDIRECTS_URL || DEFAULT_REDIRECTS_URL, {
      headers: { "accept": "application/json" },
    });
    if (!response.ok) {
      console.warn(`unexpected status fetching redirects: ${response.status}`);
      return [];
    }

    const redirects = await response.json<Redirect[]>();
    return Array.isArray(redirects) ? redirects : [];
  } catch (error) {
    console.warn("error fetching redirects", error);
    return [];
  }
}

export function computeScores(topics: Topic[]): Topic[] {
  return topics.map((topic) => {
    const normalized = normalizeTopic(topic);
    const votes = normalized.Votes;
    return compactTopic({
      ...normalized,
      score: (votes?.total_up ?? 0) - (votes?.total_down ?? 0),
    });
  });
}

export function deduplicateTopics(topics: Topic[]): Topic[] {
  const seen = new Set<number>();
  const deduplicated: Topic[] = [];

  for (const topic of topics) {
    if (seen.has(topic.topic_id)) continue;
    seen.add(topic.topic_id);
    deduplicated.push(topic);
  }

  return deduplicated;
}

export function filterNonSponsorTopics(topics: Topic[]): Topic[] {
  return topics.filter((topic) => !isSponsoredTopic(topic));
}

function isSponsoredTopic(topic: Topic): boolean {
  const offerUrl = topic.Offer?.url ?? topic.offer?.url ?? "";
  return topic.title.startsWith("[Sponsored]") || offerUrl.includes("pubads.g.doubleclick.net/gampad/clk");
}

function normalizeTopic(topic: Topic): Topic {
  const { votes, offer, ...rest } = topic;
  return {
    ...rest,
    Votes: topic.Votes ?? votes,
    Offer: topic.Offer ?? offer,
  };
}

function compactTopic(topic: Topic): Topic {
  return {
    topic_id: topic.topic_id,
    forum_id: topic.forum_id,
    title: topic.title,
    total_views: topic.total_views,
    total_replies: topic.total_replies,
    web_path: topic.web_path,
    post_time: topic.post_time,
    last_post_time: topic.last_post_time,
    Votes: topic.Votes
      ? {
          total_up: topic.Votes.total_up,
          total_down: topic.Votes.total_down,
        }
      : undefined,
    Offer: topic.Offer
      ? {
          dealer_name: topic.Offer.dealer_name,
          url: topic.Offer.url,
        }
      : undefined,
    score: topic.score,
  };
}

export function stripRedirects(topics: Topic[], redirects: Redirect[]): Topic[] {
  const compiledRedirects = compileRedirects(redirects);

  return topics.map((topic) => {
    const offerUrl = topic.Offer?.url;
    if (!offerUrl) return topic;

    for (const redirect of compiledRedirects) {
      const match = offerUrl.match(redirect.regex);
      const baseUrl = match?.groups?.baseUrl;
      if (!baseUrl) continue;

      try {
        return {
          ...topic,
          Offer: {
            ...topic.Offer,
            url: decodeURIComponent(baseUrl.replace(/\+/g, " ")),
          },
        };
      } catch (error) {
        console.warn("failed to decode redirect URL", error);
        return topic;
      }
    }

    return topic;
  });
}

function compileRedirects(redirects: Redirect[]): CompiledRedirect[] {
  const compiledRedirects: CompiledRedirect[] = [];

  for (const redirect of redirects) {
    try {
      compiledRedirects.push({ ...redirect, regex: new RegExp(redirect.pattern) });
    } catch (error) {
      console.warn(`invalid redirect pattern ${redirect.name}`, error);
    }
  }

  return compiledRedirects;
}
