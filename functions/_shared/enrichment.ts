/**
 * Shared vocabulary and validation for deal enrichment.
 *
 * Imported by both the /admin/enrich endpoint and the local Ollama enricher so
 * the two cannot drift. Enrichment is deliberately stored in its own KV key:
 * refreshTopics() re-compacts stored topics on every run, so anything attached
 * to a topic object in topics.json is stripped within one cron cycle.
 */

/** Closed set of tags. The model never gets to invent categories. */
export const TAG_VOCABULARY = [
  "computing",
  "electronics",
  "gaming",
  "telecom",
  "grocery",
  "dining",
  "home",
  "apparel",
  "sports",
  "health",
  "pets",
  "travel",
  "financial",
  "automotive",
  "kids",
  "entertainment",
  "other",
] as const;

export type Tag = (typeof TAG_VOCABULARY)[number];

/**
 * One-line gloss per tag, sent to the model with the vocabulary.
 *
 * These exist because bare tag names were read too narrowly on real data:
 * `automotive` fired once in fifty deals while motor oil and a bike rack landed
 * in `other`, and BBQs and espresso machines drifted away from `home`. The
 * examples here are the observed failures, not hypotheticals.
 */
export const TAG_GLOSSES: Record<Tag, string> = {
  computing: "computers, laptops, PC parts, peripherals, storage, monitors",
  electronics: "TVs, audio, cameras, phones, chargers, smart-home devices",
  gaming: "video games, consoles, handhelds, gaming hardware",
  telecom: "mobile, internet and TV plans, SIMs, roaming",
  grocery: "food and drink bought from a supermarket, including alcohol",
  dining: "restaurants, fast food, cafes, food delivery",
  home: "furniture, appliances, kitchen, cleaning, tools, garden, BBQs",
  apparel: "clothing, footwear, accessories, bags, jewellery",
  sports: "sporting goods and equipment, bikes, camping and outdoor gear, fitness equipment",
  health: "pharmacy, personal care, supplements, eyewear, medical devices",
  pets: "pet food, supplies and services — only for animals",
  travel: "flights, hotels, car rental, attractions, parking, points transfers",
  financial: "bank accounts, credit cards, investing, insurance, cashback",
  automotive: "cars, parts, tires, fuel, oil, maintenance, car racks and carriers",
  kids: "toys, baby gear, children's products",
  entertainment: "streaming, books, movies, events, tickets",
  other: "anything that genuinely fits none of the above",
};

/**
 * Instructions sent to the model, published alongside the vocabulary so the
 * enricher carries no copy of its own.
 *
 * The promotion-mechanism rule is measured, not decorative: across 1000 deals,
 * six RYOBI power tools landed in three different categories depending on
 * whether the title said "(Tool-Only)", and gift-card or spend-and-get deals
 * (Cineplex, Arby's, Uber One) fell to `other` regardless of what they bought.
 * The model was categorising the offer structure instead of the product.
 */
export const CLASSIFIER_INSTRUCTIONS = [
  "You classify Canadian online shopping deals into categories.",
  "Choose only from the allowed categories, and choose the single best one.",
  "Add a second category only when the deal genuinely spans two —",
  "most deals need exactly one.",
  "Categorise by the product or service the deal is for, ignoring how the offer",
  "is structured: a gift card, bundle, tool-only listing, cashback promotion or",
  "spend-and-get is categorised by what the buyer ends up with.",
  "Use \"other\" only when nothing else fits.",
].join(" ");

/**
 * Bump to re-tag every stored entry against a changed vocabulary, gloss or
 * prompt — anything that changes how tags are produced.
 *
 * v2 added `dining` and `pets` and glossed every tag.
 * v3 added `sports` after golf balls and a camping tent were tagged `pets` over
 *    1000 real deals, and moved bikes out of `automotive` into it.
 * v4 moved the prompt server-side and told the model to categorise by product
 *    rather than by promotion mechanism.
 */
export const VOCABULARY_VERSION = 4;

/** Longest model identifier stored on an entry. */
const MAX_MODEL_NAME_LENGTH = 64;

export const MAX_TAGS_PER_TOPIC = 2;

export const ENRICHMENT_KEY = "enrichment.json";

export interface EnrichmentEntry {
  tags: Tag[];
  /** Vocabulary version this entry was tagged under. */
  vv: number;
  /** Model that produced these tags, so a model change can be A/B'd. */
  m?: string;
}

export interface EnrichmentDocument {
  vocabulary_version: number;
  /** Published so the enricher can build its schema and prompt without its own copy. */
  vocabulary: Tag[];
  glosses: Record<string, string>;
  instructions: string;
  max_tags: number;
  updated_at: string | null;
  topics: Record<string, EnrichmentEntry>;
}

export interface RejectedEntry {
  topic_id: string;
  reason: string;
}

export interface ValidationResult {
  accepted: Record<string, Tag[]>;
  rejected: RejectedEntry[];
}

const TAG_SET: ReadonlySet<string> = new Set(TAG_VOCABULARY);

function emptyDocument(): EnrichmentDocument {
  return {
    vocabulary_version: VOCABULARY_VERSION,
    vocabulary: [...TAG_VOCABULARY],
    glosses: TAG_GLOSSES,
    instructions: CLASSIFIER_INSTRUCTIONS,
    max_tags: MAX_TAGS_PER_TOPIC,
    updated_at: null,
    topics: {},
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a stored enrichment value, degrading to an empty document on anything unexpected. */
export function parseEnrichment(raw: string | null): EnrichmentDocument {
  if (!raw) return emptyDocument();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyDocument();
  }

  if (!isPlainObject(parsed)) return emptyDocument();

  const topics = isPlainObject(parsed.topics) ? (parsed.topics as Record<string, EnrichmentEntry>) : {};
  return {
    // The deployed constant wins over the stored copy. Trusting the stored one
    // deadlocks re-tagging: entries sit at the old version, the document reports
    // that same version, nothing looks stale, so nothing ever rewrites it.
    vocabulary_version: VOCABULARY_VERSION,
    vocabulary: [...TAG_VOCABULARY],
    glosses: TAG_GLOSSES,
    instructions: CLASSIFIER_INSTRUCTIONS,
    max_tags: MAX_TAGS_PER_TOPIC,
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : null,
    topics,
  };
}

/**
 * Validates a `{ topic_id: tags[] }` batch.
 *
 * Invalid entries are dropped and reported rather than failing the whole batch:
 * one hallucinated tag should not discard the rest of a batch of real work.
 */
export function validateTagBatch(input: unknown): ValidationResult {
  const accepted: Record<string, Tag[]> = {};
  const rejected: RejectedEntry[] = [];

  if (!isPlainObject(input)) return { accepted, rejected };

  for (const [topicId, rawTags] of Object.entries(input)) {
    const reason = rejectionReason(topicId, rawTags);
    if (reason) {
      rejected.push({ topic_id: topicId, reason });
      continue;
    }
    accepted[topicId] = deduplicate(rawTags as string[]) as Tag[];
  }

  return { accepted, rejected };
}

function rejectionReason(topicId: string, rawTags: unknown): string | null {
  if (!/^\d+$/.test(topicId)) return "topic_id is not numeric";
  if (!Array.isArray(rawTags)) return "tags is not an array";

  const tags = deduplicate(rawTags);
  if (tags.length === 0) return "no tags";
  if (tags.length > MAX_TAGS_PER_TOPIC) {
    return `too many tags: ${tags.length} (max ${MAX_TAGS_PER_TOPIC})`;
  }

  for (const tag of tags) {
    if (!TAG_SET.has(tag)) return `unknown tag: ${tag}`;
  }

  return null;
}

/**
 * Merges validated tags over an existing document and prunes entries for topics
 * that have aged out of topics.json, keeping the key bounded.
 *
 * `knownTopicIds` empty is treated as "unknown" rather than "nothing exists" so
 * a failed topics fetch upstream cannot wipe every stored tag.
 */
export function mergeEnrichment(
  existing: EnrichmentDocument,
  accepted: Record<string, Tag[]>,
  knownTopicIds: readonly string[],
  model?: string,
): EnrichmentDocument {
  const topics: Record<string, EnrichmentEntry> = { ...existing.topics };

  for (const [topicId, tags] of Object.entries(accepted)) {
    const entry: EnrichmentEntry = { tags: [...tags], vv: VOCABULARY_VERSION };
    if (model) entry.m = model;
    topics[topicId] = entry;
  }

  if (knownTopicIds.length > 0) {
    const known = new Set(knownTopicIds);
    for (const topicId of Object.keys(topics)) {
      if (!known.has(topicId)) delete topics[topicId];
    }
  }

  return {
    vocabulary_version: VOCABULARY_VERSION,
    vocabulary: [...TAG_VOCABULARY],
    glosses: TAG_GLOSSES,
    instructions: CLASSIFIER_INSTRUCTIONS,
    max_tags: MAX_TAGS_PER_TOPIC,
    updated_at: new Date().toISOString(),
    topics,
  };
}

/** Normalizes a self-reported model identifier, or undefined if unusable. */
export function sanitizeModelName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, MAX_MODEL_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Topics with no entry, or tagged under a superseded vocabulary version. */
export function selectTopicsNeedingTags<T extends { topic_id: number }>(
  topics: readonly T[],
  enrichment: EnrichmentDocument,
): T[] {
  return topics.filter((topic) => {
    const entry = enrichment.topics[String(topic.topic_id)];
    return !entry || entry.vv < VOCABULARY_VERSION;
  });
}

function deduplicate(tags: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const value = String(tag);
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
