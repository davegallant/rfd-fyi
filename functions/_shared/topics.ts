const TOPICS_KEY = "topics.json";
const RFD_FORUM_BASE = "https://forums.redflagdeals.com";
const DEFAULT_REDIRECTS_URL = "https://raw.githubusercontent.com/davegallant/rfd-redirect-stripper/main/redirects.json";
const DEALS_FETCH_CONCURRENCY = 5;

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

export async function refreshTopics(env: Env): Promise<Topic[]> {
  let topics = await getDeals(env, 9, 1, 26);

  if (topics.length === 0) {
    return [];
  }

  topics = deduplicateTopics(topics);
  topics = computeScores(topics);
  const redirects = await getRedirects(env);
  topics = stripRedirects(topics, redirects);

  await env.TOPICS_KV.put(TOPICS_KEY, JSON.stringify(topics));
  return topics;
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
    const votes = topic.Votes ?? topic.votes;
    return {
      ...normalizeTopic(topic),
      score: (votes?.total_up ?? 0) - (votes?.total_down ?? 0),
    };
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
  return topics.filter((topic) => !topic.title.startsWith("[Sponsored]"));
}

function normalizeTopic(topic: Topic): Topic {
  const { votes, offer, ...rest } = topic;
  return {
    ...rest,
    Votes: topic.Votes ?? votes,
    Offer: topic.Offer ?? offer,
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
