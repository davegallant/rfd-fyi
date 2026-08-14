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

const SORT_FNS = {
  title: (a, b) => a.title.localeCompare(b.title),
  post_time: (a, b) => new Date(b.last_post_time) - new Date(a.last_post_time),
  thread_start: (a, b) => new Date(b.post_time) - new Date(a.post_time),
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
  if (activeFilters.length === 0) return topics;
  const parsed = activeFilters.map(parseFilterTerm);
  return topics.filter((row) => {
    const dealText = `${row.title} [${row.Offer.dealer_name}]`;
    const tagText = (row.tags ?? []).map((tag) => `${TAG_FILTER_PREFIX}${tag}`).join(" ");

    return parsed.every(({ regex, literal }) => {
      // Regex terms search everything, so /#gam(ing|bling)/ stays possible.
      if (regex) return regex.test(`${dealText} ${tagText}`);
      // A #-prefixed term searches tags only; without it, tags are not searched.
      // Otherwise a plain search for "computing" would match the "#computing"
      // tag as a substring, silently widening every title search.
      if (literal.startsWith(TAG_FILTER_PREFIX)) return tagText.toLowerCase().includes(literal);
      return dealText.toLowerCase().includes(literal);
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

export function getFilteredSortedTopics(topics, activeFilters, sortMethod, hiddenMerchants = []) {
  const hiddenMerchantKeys = new Set(hiddenMerchants.map(merchantKey).filter(Boolean));
  const visibleTopics = hiddenMerchantKeys.size === 0
    ? topics
    : topics.filter((topic) => !hiddenMerchantKeys.has(merchantKey(topic?.Offer?.dealer_name)));
  const filtered = filterTopicsByActiveFilters(visibleTopics, activeFilters);
  return sortTopics(filtered, sortMethod);
}
