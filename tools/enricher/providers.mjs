/**
 * Model-provider adapters.
 *
 * Each adapter only knows a wire format: how to build a request and where the
 * model's JSON answer lives in the response. The prompt, the JSON schema, tag
 * validation, and retry logic are shared, so adding a provider is ~25 lines and
 * cannot drift from the vocabulary the server will accept.
 */

/**
 * Used only when the server publishes no instructions (an older deployment).
 * The authoritative copy lives in functions/_shared/enrichment.ts, so a wording
 * change is covered by VOCABULARY_VERSION like any other tagging change.
 */
const FALLBACK_INSTRUCTIONS = [
  "You classify Canadian online shopping deals into categories.",
  "Choose only from the allowed categories, and choose the single best one.",
  "Add a second category only when the deal genuinely spans two —",
  "most deals need exactly one.",
  "Use \"other\" only when nothing else fits.",
].join(" ");

function stripTrailingSlash(url) {
  return url.replace(/\/$/, "");
}

export function describeDeal(topic) {
  const dealer = topic.Offer?.dealer_name;
  return dealer ? `${topic.title} (dealer: ${dealer})` : topic.title;
}

/**
 * Builds the system prompt entirely from what the server publishes.
 *
 * Glosses matter: with bare tag names, a 7B model read `automotive` so narrowly
 * that motor oil and a bike rack fell through to `other`.
 */
export function systemPrompt(vocabulary, glosses, instructions) {
  const list = vocabulary
    .map((tag) => (glosses?.[tag] ? `- ${tag}: ${glosses[tag]}` : `- ${tag}`))
    .join("\n");
  return `${instructions || FALLBACK_INSTRUCTIONS}\n\nAllowed categories:\n${list}`;
}

/** JSON schema constraining the model to the published vocabulary. */
export function tagSchema(vocabulary, maxTags) {
  return {
    type: "object",
    properties: {
      tags: {
        type: "array",
        items: { type: "string", enum: vocabulary },
        minItems: 1,
        maxItems: maxTags,
      },
    },
    required: ["tags"],
    additionalProperties: false,
  };
}

const ollama = {
  name: "ollama",
  defaultBaseUrl: "http://localhost:11434",
  defaultModel: "qwen2.5:7b-instruct",
  // One GPU: queueing requests buys nothing.
  defaultConcurrency: 1,

  buildRequest({ topic, vocabulary, glosses, instructions, maxTags, config }) {
    return {
      url: `${stripTrailingSlash(config.baseUrl || this.defaultBaseUrl)}/api/chat`,
      headers: { "content-type": "application/json" },
      body: {
        model: config.model || this.defaultModel,
        stream: false,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: systemPrompt(vocabulary, glosses, instructions) },
          { role: "user", content: `Deal: ${describeDeal(topic)}` },
        ],
        format: tagSchema(vocabulary, maxTags),
      },
    };
  },

  extractContent(response) {
    return response?.message?.content ?? null;
  },
};

/**
 * Asks for the JSON envelope in prose, because the proxy will not enforce it.
 *
 * This is the OpenAI-shaped equivalent of the `format` field the ollama adapter
 * sends — an output-shape instruction, not a classification one. It must stay
 * that way: it says nothing about *which* tag to pick, so it cannot drift from
 * `CLASSIFIER_INSTRUCTIONS` or invalidate a `VOCABULARY_VERSION`. It also stays
 * out of `systemPrompt()`, since Ollama's `format` genuinely constrains output
 * and adding prose there would perturb a baseline for no gain.
 */
function jsonEnvelopeDirective(maxTags) {
  return `\n\nReply with JSON only, no prose: {"tags":["category"]}`
    + ` — at most ${maxTags} ${maxTags === 1 ? "entry" : "entries"}.`;
}

/**
 * LiteLLM proxy.
 *
 * The wire format is plain OpenAI chat-completions, so any compatible endpoint
 * works by pointing ENRICH_BASE_URL at it — LiteLLM is just what sits in front
 * of the model here. The base URL includes `/v1`, matching what an OpenAI
 * client would be given.
 *
 * **No `response_format` is sent, and that was measured rather than assumed.**
 * Across the 23 models on the proxy it never once changed the answer: the
 * DeepSeek family rejects it outright with a 400, MiniMax and MiMo accept it
 * and ignore it (`minimax-m3` answered the bare string `tools` under a strict
 * schema, with `finish_reason: stop`), and the models that do return clean JSON
 * return it with or without the field. It is a 400 risk that buys nothing, so
 * the prose directive above carries the shape and `parseTags` does the actual
 * enforcement — it validates against the vocabulary, drops invented tags, and
 * caps at `maxTags` for every provider alike.
 */
const litellm = {
  name: "litellm",
  defaultBaseUrl: "http://hephaestus:4000/v1",
  defaultModel: "minimax-m3",
  // Not a single GPU: a proxy fronting many models wants several in flight.
  defaultConcurrency: 4,

  buildRequest({ topic, vocabulary, glosses, instructions, maxTags, config }) {
    const headers = { "content-type": "application/json" };
    // A proxy on a trusted LAN may have no key at all; only send one if set.
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

    return {
      url: `${stripTrailingSlash(config.baseUrl || this.defaultBaseUrl)}/chat/completions`,
      headers,
      body: {
        model: config.model || this.defaultModel,
        /**
         * The answer is ~10 tokens. The rest is headroom for reasoning models,
         * and it is not optional: `minimax-m3` emits `reasoning_content` whose
         * length varies wildly for identical input at `temperature: 0` — the
         * same deal cost 42, 87 and then 256 tokens on three consecutive runs.
         * When it exhausts the budget the request still returns 200 with
         * `finish_reason: "length"` and an empty `content`, so the topic is
         * skipped rather than failing loudly, and at temperature 0 it would be
         * skipped again on every future run.
         *
         * Measured over 80 live deals: a 256 ceiling truncated 9 of them, 1024
         * truncated none. Median usage is 45 tokens and the observed maximum
         * was 544, so this is ~2x headroom over the worst case and costs
         * nothing on the median deal.
         */
        max_tokens: 1024,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: systemPrompt(vocabulary, glosses, instructions)
              + jsonEnvelopeDirective(maxTags),
          },
          { role: "user", content: `Deal: ${describeDeal(topic)}` },
        ],
      },
    };
  },

  /**
   * Reads the answer from whichever slot the model used.
   *
   * Usually `content`. A proxy that emulates structured output with tool
   * calling leaves `content` null and puts the JSON in the call arguments,
   * so both are checked before giving up.
   */
  extractContent(response) {
    const message = response?.choices?.[0]?.message;
    if (!message) return null;
    if (typeof message.content === "string" && message.content.trim() !== "") {
      return message.content;
    }
    return message.tool_calls?.[0]?.function?.arguments ?? null;
  },
};

export const PROVIDERS = { ollama, litellm };

export function resolveProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`unknown provider "${name}"; supported: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return provider;
}
