import { TAG_FILTER_PREFIX } from "./enrichment.js";

/** Sort keys supported by the deals list (matches App sort options). */
export const SORT_KEYS = [
  "title",
  "post_time",
  "thread_start",
  "score",
  "replies",
  "views",
];

// A topic's timestamps are parsed once and reused by subsequent sorts. Weak keys
// release old snapshots; source checks also support callers that mutate topics.
const dateCache = new WeakMap();
function topicDate(topic, field) {
  let cached = dateCache.get(topic);
  if (!cached) {
    cached = {};
    dateCache.set(topic, cached);
  }
  if (!cached[field] || cached[field].source !== topic[field]) {
    cached[field] = { source: topic[field], value: new Date(topic[field]).getTime() };
  }
  return cached[field].value;
}

const SORT_FNS = {
  title: (a, b) => a.title.localeCompare(b.title),
  post_time: (a, b) => topicDate(b, "last_post_time") - topicDate(a, "last_post_time"),
  thread_start: (a, b) => topicDate(b, "post_time") - topicDate(a, "post_time"),
  score: (a, b) => b.score - a.score,
  replies: (a, b) => b.total_replies - a.total_replies,
  views: (a, b) => b.total_views - a.total_views,
};

/** Regex that detects /pattern/flags syntax. */
const REGEX_LITERAL = /^\/(.+)\/([gimsuy]*)$/;

/**
 * Parses a single raw filter term and returns a descriptor.
 *
 * If the trimmed term is wrapped in /slashes/ it is treated as a regex:
 *   - Valid regex  → { regex: RegExp, literal: "", isRegexError: false }
 *   - Invalid regex → { regex: null, literal: raw, isRegexError: true }
 * Otherwise it is a plain substring:
 *   - { regex: null, literal: raw.toLowerCase(), isRegexError: false }
 *
 * An empty string returns { regex: null, literal: "", isRegexError: false }.
 *
 * @param {string} raw
 * @returns {{ regex: RegExp|null, literal: string, isRegexError: boolean }}
 */
export function parseFilterTerm(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { regex: null, literal: "", isRegexError: false };
  }
  const match = trimmed.match(REGEX_LITERAL);
  if (match) {
    const [, pattern, flags] = match;
    try {
      const regex = new RegExp(pattern, flags);
      return { regex, literal: "", isRegexError: false };
    } catch {
      // Invalid regex — fall back to literal match with full raw string
      return { regex: null, literal: trimmed, isRegexError: true };
    }
  }
  return { regex: null, literal: trimmed.toLowerCase(), isRegexError: false };
}

/**
 * Returns topics whose title or dealer name matches every active filter term.
 * Each term is parsed by parseFilterTerm: regex terms use RegExp.test(),
 * plain terms use case-insensitive substring match.
 * @param {object[]} topics
 * @param {string[]} activeFilters
 */
export function filterTopicsByActiveFilters(topics, activeFilters) {
  return filterTopicsByParsedFilters(topics, activeFilters.map(parseFilterTerm));
}

export function filterTopicsByParsedFilters(topics, parsed) {
  if (parsed.length === 0) return topics;
  return topics.filter((row) => {
    const dealText = `${row.title} [${row.Offer?.dealer_name ?? ""}]`;
    const tagText = (row.tags ?? []).map((tag) => `${TAG_FILTER_PREFIX}${tag}`).join(" ");

    const lowerDealText = dealText.toLowerCase();
    const lowerTagText = tagText.toLowerCase();
    return parsed.every(({ regex, literal }) => {
      // Regex terms search everything, so /#gam(ing|bling)/ stays possible.
      if (regex) {
        regex.lastIndex = 0;
        return regex.test(`${dealText} ${tagText}`);
      }
      // A #-prefixed term searches tags only; without it, tags are not searched.
      // Otherwise a plain search for "computing" would match the "#computing"
      // tag as a substring, silently widening every title search.
      if (literal.startsWith(TAG_FILTER_PREFIX)) return lowerTagText.includes(literal);
      return lowerDealText.includes(literal);
    });
  });
}

/**
 * Returns a new array sorted by the given method (defaults to score).
 */
export function sortTopics(topics, sortMethod) {
  const fn = SORT_FNS[sortMethod] || SORT_FNS.score;
  return [...topics].sort(fn);
}

function merchantKey(merchantName) {
  return typeof merchantName === "string" ? merchantName.trim().toLowerCase() : "";
}

/**
 * Returns unique, alphabetized merchants represented in a deal list.
 * Names that differ only by case or surrounding whitespace share one entry.
 */
export function getMerchantOptions(topics) {
  const merchants = new Map();
  for (const topic of topics) {
    const name = topic?.Offer?.dealer_name?.trim();
    const key = merchantKey(name);
    if (!key) continue;
    const existing = merchants.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      merchants.set(key, { key, name, count: 1 });
    }
  }
  return [...merchants.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getFilteredSortedTopics(topics, activeFilters, sortMethod, hiddenMerchants = [], parsed = activeFilters.map(parseFilterTerm)) {
  const hiddenMerchantKeys = new Set(hiddenMerchants.map(merchantKey).filter(Boolean));
  const visibleTopics = hiddenMerchantKeys.size === 0
    ? topics
    : topics.filter((topic) => !hiddenMerchantKeys.has(merchantKey(topic?.Offer?.dealer_name)));
  const filtered = filterTopicsByParsedFilters(visibleTopics, parsed);
  return sortTopics(filtered, sortMethod);
}

const escapeHtml = text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Compile once per filter change; cache rendered text until filters change. */
export function createHighlighter(parsed) {
  const patterns = parsed.flatMap(({ regex, literal }) => {
    if (regex) return [new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`)];
    if (!literal || literal.startsWith(TAG_FILTER_PREFIX)) return [];
    return [new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig")];
  });
  const cache = new Map();
  return (text = "") => {
    text = text || "";
    if (cache.has(text)) return cache.get(text);
    const ranges = [];
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (match[0].length) ranges.push([match.index, match.index + match[0].length]);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
      const previous = merged.at(-1);
      if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
      else merged.push([...range]);
    }
    let end = 0;
    let html = "";
    for (const [start, stop] of merged) {
      html += escapeHtml(text.slice(end, start)) + `<mark>${escapeHtml(text.slice(start, stop))}</mark>`;
      end = stop;
    }
    html += escapeHtml(text.slice(end));
    // Bound memory even if a tab remains open through many feed refreshes.
    if (cache.size >= 3000) cache.clear();
    cache.set(text, html);
    return html;
  };
}
