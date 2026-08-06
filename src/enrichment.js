/**
 * Joins locally-generated deal tags onto topics.
 *
 * Tags are served from /enrichment.json rather than being embedded in
 * /topics.json: the refresh Worker rewrites topics.json wholesale every few
 * minutes and strips unknown fields, so anything attached there would not
 * survive.
 */

/** Prefix keeps a tag filter from colliding with a plain title search. */
export const TAG_FILTER_PREFIX = "#";

export function tagFilterTerm(tag) {
  return `${TAG_FILTER_PREFIX}${tag}`;
}

/** Returns copies of topics with a `tags` array, empty when nothing is known. */
export function attachTags(topics, enrichment) {
  const byTopicId = enrichment?.topics ?? {};

  return topics.map((topic) => {
    const entry = byTopicId[String(topic.topic_id)];
    const tags = Array.isArray(entry?.tags) ? entry.tags : [];
    return { ...topic, tags };
  });
}
