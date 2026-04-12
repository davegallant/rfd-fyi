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
    const searchText = `${row.title} [${row.Offer.dealer_name}]`;
    return parsed.every(({ regex, literal }) => {
      if (regex) return regex.test(searchText);
      return searchText.toLowerCase().includes(literal);
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

export function getFilteredSortedTopics(topics, activeFilters, sortMethod) {
  const filtered = filterTopicsByActiveFilters(topics, activeFilters);
  return sortTopics(filtered, sortMethod);
}
