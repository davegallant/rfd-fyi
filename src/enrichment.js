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

/**
 * Tags stored but never rendered.
 *
 * `other` is a quarantine rather than a category: it holds deals that are not
 * products at all — megathreads, weekly flyer dumps — and keeps them out of the
 * 16 real categories. Deleting it from the vocabulary would not make those
 * classifiable, it would just scatter them into categories people filter by. So
 * it stays in the data and out of the UI. `#other` still filters, which is the
 * way to audit what has collected there.
 */
export const HIDDEN_TAGS = new Set(["other"]);

/** Tags worth showing a reader — everything except the catch-all. */
export function visibleTags(tags) {
  return (tags ?? []).filter((tag) => !HIDDEN_TAGS.has(tag));
}

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
