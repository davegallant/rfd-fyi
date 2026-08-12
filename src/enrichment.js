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
 * real categories. Deleting it from the vocabulary would not make those
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

/**
 * Completion candidates for a filter term being typed.
 *
 * The filter input holds a single term (applyFilter pushes it whole), so
 * completion only fires when the entire input starts with the tag prefix.
 * Prefix matches rank ahead of mere substring matches, each group
 * alphabetical; returned terms carry the `#` prefix so they can be inserted
 * and rendered as-is.
 *
 * `other` is deliberately not hidden here: completion is a filtering
 * affordance, not rendering, and `#other` is the documented audit path for
 * the quarantine bucket (see HIDDEN_TAGS).
 *
 * An exact match yields nothing: the term is complete, and a lingering
 * dropdown would swallow the Enter meant to apply the filter. (If the
 * vocabulary ever gains a tag that is a strict prefix of another, typing the
 * shorter one exactly will suppress completion of the longer — no two
 * current tags have that relationship.)
 */
export function tagSuggestions(input, tags) {
  const raw = input ?? "";
  if (!raw.startsWith(TAG_FILTER_PREFIX)) return [];
  const fragment = raw.slice(TAG_FILTER_PREFIX.length).toLowerCase();
  const candidates = [...new Set(tags ?? [])].filter((tag) => typeof tag === "string" && tag.length > 0);
  if (candidates.some((tag) => tag.toLowerCase() === fragment)) return [];
  const rank = (tag) => (tag.toLowerCase().startsWith(fragment) ? 0 : 1);
  return candidates
    .filter((tag) => tag.toLowerCase().includes(fragment))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(tagFilterTerm);
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
