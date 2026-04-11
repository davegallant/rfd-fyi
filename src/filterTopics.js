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

/**
 * Returns topics whose title or dealer name matches every active filter term (case-insensitive).
 * @param {object[]} topics
 * @param {string[]} activeFilters
 */
export function filterTopicsByActiveFilters(topics, activeFilters) {
  const filterTerms = activeFilters.map((f) => f.toLowerCase());
  return topics.filter((row) => {
    if (filterTerms.length === 0) return true;
    const searchText = `${row.title} [${row.Offer.dealer_name}]`.toLowerCase();
    return filterTerms.every((term) => searchText.includes(term));
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
