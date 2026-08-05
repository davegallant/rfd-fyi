/**
 * Model-provider adapters.
 *
 * Each adapter only knows a wire format: how to build a request and where the
 * model's JSON answer lives in the response. The prompt, the JSON schema, tag
 * validation, and retry logic are shared, so adding a provider is ~25 lines and
 * cannot drift from the vocabulary the server will accept.
 */

const SYSTEM_PROMPT = [
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
 * Builds the system prompt from the server-published vocabulary.
 *
 * Glosses matter: with bare tag names, a 7B model read `automotive` so narrowly
 * that motor oil and a bike rack fell through to `other`.
 */
export function systemPrompt(vocabulary, glosses) {
  const list = vocabulary
    .map((tag) => (glosses?.[tag] ? `- ${tag}: ${glosses[tag]}` : `- ${tag}`))
    .join("\n");
  return `${SYSTEM_PROMPT}\n\nAllowed categories:\n${list}`;
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

  buildRequest({ topic, vocabulary, glosses, maxTags, config }) {
    return {
      url: `${stripTrailingSlash(config.baseUrl || this.defaultBaseUrl)}/api/chat`,
      headers: { "content-type": "application/json" },
      body: {
        model: config.model || this.defaultModel,
        stream: false,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: systemPrompt(vocabulary, glosses) },
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

export const PROVIDERS = { ollama };

export function resolveProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`unknown provider "${name}"; supported: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return provider;
}
