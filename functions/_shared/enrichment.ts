/**
 * Shared vocabulary and validation for deal enrichment.
 *
 * Imported by both the /admin/enrich endpoint and the local Ollama enricher so
 * the two cannot drift. Enrichment is deliberately stored in its own KV key:
 * refreshTopics() re-compacts stored topics on every run, so anything attached
 * to a topic object in topics.json is stripped within one cron cycle.
 */

/**
 * Closed set of tags. The model never gets to invent categories.
 *
 * The order is load-bearing, not cosmetic: it is the order the categories are
 * listed in the prompt, and **whichever tag is listed first over-attracts by
 * roughly 140 deals in 1000.** v9 tested this by moving `computing` from first
 * to last-but-one and changing nothing else: `computing` collapsed 140 → 13
 * and `electronics`, which inherited the head slot, rose 116 → 256 (25.8%).
 * Laptops and monitors followed the slot rather than the gloss — they left
 * `computing`, whose gloss names them, for `electronics`, whose gloss does not.
 *
 * So the order cannot be tuned to fix it, because some tag must be first. This
 * order is v8's, kept because it was the best measured; the head-slot bias is
 * aimed at `computing`, which is broad enough to absorb it with the least
 * distortion. The real fix is to stop any one tag owning the slot — see the
 * rotation note in VOCABULARY_VERSION.
 */
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
  "rewards",
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
 *
 * **State only what a category includes.** A gloss must never say what a
 * category excludes. Measured across the v6→v7 deployment, six of the seven
 * negated phrases in the vocabulary pulled in the very deals they excluded:
 * `computing` said "not kitchen appliances, power tools or personal-care
 * devices" and took 10, 17 and 3 of them respectively; `rewards` said "not
 * credit card sign-up bonuses" and took 8, "not airline or hotel points
 * transfers" and took 9. The model matches gloss text lexically and "not"
 * contributes nothing. The one negation that held — `computing` "not phones" —
 * held only because `electronics` names phones more specifically, which is the
 * mechanism to use instead: put the noun in the gloss that should win, and
 * nowhere else.
 */
export const TAG_GLOSSES: Record<Tag, string> = {
  computing: "computers, laptops, tablets, PC parts, storage, monitors, keyboards, mice, docks and networking gear",
  electronics: "TVs, audio, cameras, phones of every form factor including foldables, smartwatches, smart glasses and wearables, chargers, smart-home devices",
  gaming: "video games, consoles, handhelds, gaming hardware, board games, trading cards and tabletop games",
  telecom: "mobile, internet and TV plans, SIMs, roaming",
  grocery: "food and drink bought from a supermarket, including alcohol",
  dining: "restaurants, fast food, cafes, bakeries and dessert shops, food delivery",
  home: "furniture, kitchen and small appliances, coffee and espresso machines, air conditioners and fans, vacuums, cleaning, pest control, power and hand tools, lawn and garden equipment, BBQs and grills, coolers",
  apparel: "clothing, footwear, accessories, bags, jewellery",
  sports: "sporting goods and equipment, bikes, kick scooters, skateboards, camping and outdoor gear, fitness equipment, treadmills, weights and home gyms",
  health: "pharmacy, personal care, hair dryers, shavers and trimmers, supplements, eyewear, medical devices",
  pets: "food, supplies and services for cats, dogs, fish and other animals, aquariums",
  travel: "flights, hotels, car rental, attractions, parking, airline and hotel points transfers",
  financial: "bank accounts, credit cards and their welcome bonuses, investing, insurance",
  rewards: "loyalty and points programs such as Scene+, PC Optimum, Air Miles and Aeroplan, gift cards, and points or cents-per-litre discounts earned at gas stations",
  automotive: "cars, motorcycles, parts, tires, fuel, oil, maintenance, car care and car cleaning products, jacks and garage equipment, car racks and carriers, electric scooters",
  kids: "toys, baby gear, diapers, strollers and car seats, children's products",
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
 *
 * That rule has a limit, which is what `rewards` is for: a Scene+ or PC Optimum
 * promotion has no product to fall back on, so "categorise by the product" left
 * it with nowhere to go. The two rules are ordered deliberately — structure is
 * ignored *unless* the value itself is points, miles or stored value.
 *
 * The flyer rule is likewise measured: 19 store-wide flyers and Costco photo
 * reports correctly reached `other`, but five more leaked into `automotive`,
 * `travel`, `financial` and `grocery` by latching onto one item in the title.
 */
export const CLASSIFIER_INSTRUCTIONS = [
  "You classify Canadian online shopping deals into categories.",
  "Choose only from the allowed categories, and choose the single best one.",
  "Add a second category only when the deal genuinely spans two —",
  "most deals need exactly one.",
  "Categorise by the product or service the deal is for, ignoring how the offer",
  "is structured: a bundle, tool-only listing, cashback promotion or",
  "spend-and-get is categorised by what the buyer ends up with.",
  "When the value of the deal is points, miles or stored value rather than a",
  "product — a loyalty promotion, a discounted gift card, a fuel-points offer —",
  "use \"rewards\".",
  "A post covering a whole store's flyer, weekly sale or photo report spans",
  "every category at once, so use \"other\" for it.",
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
 * v5 added kick scooters/skateboards to `sports` and electric scooters to
 *    `automotive` after an electric scooter, given only its bare title, was
 *    tagged `gaming` — the model had nowhere better to put it.
 * v6 excluded kitchen appliances, power tools and personal-care devices from
 *    `computing` (an espresso machine, a hair styler and half a dozen power
 *    tools were landing there despite `home` and `health` already covering
 *    them) and dropped `cashback` from `financial`'s gloss, which was
 *    overriding the instruction to categorise cashback deals by the
 *    underlying product — it sent VPN subscriptions to `financial` while
 *    identical VPN deals worded without "cashback" correctly landed in
 *    `telecom`.
 * v7 added `rewards` and partitioned three boundaries the glosses had left open,
 *    all measured on the same 1000 live deals:
 *    - 29 loyalty, gift-card and fuel-points promos sat in `other` with no
 *      product to categorise by, and near-identical Shell/Journie offers split
 *      6 `automotive` / 7 `other` depending on whether the title said "c/L" or
 *      "points".
 *    - phones, tablets and smartwatches were named in neither device gloss: one
 *      Galaxy Fold 8 pre-order was `computing` while another and a Fold 7 were
 *      `electronics`. Tablets are named in `computing` because all nine in the
 *      sample already landed there consistently; phones and wearables are named
 *      in `electronics` and excluded from `computing`.
 *    - power tools stayed split 12 `home` / 10 `computing` under v6's negative
 *      exclusion alone — the same Fanttik drill and Knipex pliers wrench landed
 *      in both — so `home` now names them positively. Likewise coffee machines
 *      (4 `home`, 3 `other`, 2 `grocery`, 2 `computing`), tabletop games (6
 *      `kids`, 5 `entertainment`, 2 `other`, 1 `gaming`) and home-gym gear
 *      (7 `home`, 1 `sports`).
 *    It also names eight single misses that had no cluster behind them, each
 *    observed once in the same sample: Pampers diapers and an Evenflo stroller
 *    (`pets` and `home`, should be `kids`), Crumbl and A&W coupons (`other`,
 *    dining), aquarium substrate and live fish (`other`, pets), ant baits
 *    (`health`, home), car wash kit and a floor jack (`home`, automotive), and
 *    Rayban Meta glasses (`gaming`, electronics). One example is thin evidence
 *    for a gloss phrase, so these are the v7 changes most likely to overfit —
 *    watch whether the phrase pulls in deals that were previously correct.
 * v8 removed every exclusion clause after v7 was measured live and was a net
 *    regression: `computing` went 112 → 197 of 1000 (19.7%, the share the
 *    enricher README defines as disqualifying), power tools inverted from
 *    13 `home` / 8 `computing` to 20 `computing` / 3 `home`, and kitchen
 *    appliances, BBQs and home-gym gear all followed. Six of seven negated
 *    phrases leaked into the gloss that negated them, 48 deals in total. Each
 *    concrete noun now appears in exactly one gloss — the ones `computing` used
 *    to exclude live in `home` and `health`, and the two `rewards` carve-outs
 *    are stated positively in `financial` and `travel` instead.
 *    v7 was not a total loss and is not reverted: phones reached `electronics`
 *    17/17 (from 16/1), `other` fell 94 → 36, and `rewards` is sound at its
 *    core — 41 of the deals it absorbed came straight from `other`.
 * v9 changes one variable and nothing else: the order of TAG_VOCABULARY. No
 *    gloss, instruction or tag was touched, so the re-tag is a clean test of
 *    whether list position confers an advantage.
 *    v8 fixed the negation defect and ranked best of the three versions
 *    measured (largest category 15.2%, `other` 3.0%), but left `computing` at
 *    141 against v6's 111, and two boundaries where the category that names an
 *    item explicitly still lost to one that does not: power tools 15
 *    `computing` / 8 `home`, and home-gym gear 4 `gaming` / 0 `sports`. In both
 *    the winner sits earlier in the list. `computing` therefore moves from
 *    first to last-but-one.
 *    It was confirmed, overwhelmingly, and dilution was ruled out.
 * v10 restores v8's order after v9 answered the question and was worse for it.
 *    v9's finding is the useful part and is recorded on TAG_VOCABULARY: the
 *    first slot in the list is worth ~140 deals in 1000 to whichever tag holds
 *    it, independent of what any gloss says. Reordering therefore cannot fix
 *    the bias, only aim it. v9 aimed it at `electronics` (256, 25.8% — past the
 *    share the enricher README calls disqualifying) and broke `computing` as a
 *    category: 27 laptops and 7 monitors left it for `electronics`, and what
 *    remained was a treadmill, a gym rack and some watercolour pens.
 *    v9 did confirm one thing worth keeping: with `computing` demoted, power
 *    tools reached `home` 13/24, their best across every version. The gloss was
 *    right all along; position was overriding it.
 *    Next single-variable experiment: rotate the category list per topic
 *    (`topic_id % length`) so the head slot lands on each tag equally often,
 *    spreading a systematic bias into uniform noise. Deterministic, so
 *    temperature 0 stays reproducible.
 */
export const VOCABULARY_VERSION = 10;

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
    accepted[topicId] = normalize(rawTags as string[]) as Tag[];
  }

  return { accepted, rejected };
}

/**
 * Deduplicates and drops a redundant `other`.
 *
 * `other` means "nothing else fits", so it cannot be true alongside a real tag,
 * yet 11 of 1000 live entries were stored as e.g. `["grocery", "other"]` — the
 * model filling the second schema slot. It is normalized away rather than
 * rejected: rejecting would leave the topic untagged, so the next run would
 * select it, get the same answer at temperature 0, and reject it again forever.
 */
function normalize(rawTags: unknown[]): string[] {
  const tags = deduplicate(rawTags);
  return tags.length > 1 ? tags.filter((tag) => tag !== "other") : tags;
}

function rejectionReason(topicId: string, rawTags: unknown): string | null {
  if (!/^\d+$/.test(topicId)) return "topic_id is not numeric";
  if (!Array.isArray(rawTags)) return "tags is not an array";

  const tags = normalize(rawTags);
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
