import { describe, expect, it } from "vitest";
import { PROVIDERS, resolveProvider, systemPrompt } from "./providers.mjs";

const VOCABULARY = ["computing", "gaming", "grocery", "other"];
const GLOSSES = {
  computing: "computers and laptops",
  gaming: "video games and consoles",
  grocery: "supermarket food",
  other: "anything else",
};
const TOPIC = { topic_id: 1, title: "RTX 5070 $499", Offer: { dealer_name: "Newegg" } };

function build(name, config = {}) {
  return resolveProvider(name).buildRequest({
    topic: TOPIC,
    vocabulary: VOCABULARY,
    glosses: GLOSSES,
    maxTags: 2,
    config: { model: "test-model", ...config },
  });
}

describe("systemPrompt", () => {
  it("lists every tag with its gloss, so tag names are not read too narrowly", () => {
    const prompt = systemPrompt(VOCABULARY, GLOSSES);
    for (const tag of VOCABULARY) {
      expect(prompt).toContain(tag);
      expect(prompt).toContain(GLOSSES[tag]);
    }
  });

  it("falls back to bare tag names when the server publishes no glosses", () => {
    const prompt = systemPrompt(VOCABULARY, undefined);
    for (const tag of VOCABULARY) {
      expect(prompt).toContain(tag);
    }
  });

  it("asks for one tag by default, since a forced second tag is usually noise", () => {
    expect(systemPrompt(VOCABULARY, GLOSSES)).toMatch(/single|one/i);
  });
});

describe("resolveProvider", () => {
  it("resolves each supported provider by name", () => {
    for (const name of Object.keys(PROVIDERS)) {
      expect(resolveProvider(name).name).toBe(name);
    }
  });

  it("rejects an unknown provider with the supported list in the message", () => {
    expect(() => resolveProvider("gemini")).toThrow(/ollama/);
  });
});

describe("every provider", () => {
  for (const name of Object.keys(PROVIDERS)) {
    describe(name, () => {
      it("targets an absolute URL", () => {
        expect(build(name).url).toMatch(/^https?:\/\//);
      });

      it("sends JSON", () => {
        expect(build(name).headers["content-type"]).toBe("application/json");
      });

      it("puts the deal title in the request body", () => {
        expect(JSON.stringify(build(name).body)).toContain("RTX 5070 $499");
      });

      it("puts the dealer in the request body", () => {
        expect(JSON.stringify(build(name).body)).toContain("Newegg");
      });

      it("constrains output to the vocabulary", () => {
        expect(JSON.stringify(build(name).body)).toContain("computing");
      });

      it("passes the glosses through to the model", () => {
        expect(JSON.stringify(build(name).body)).toContain("supermarket food");
      });

      it("names the configured model", () => {
        expect(build(name).body.model).toBe("test-model");
      });

      it("honours a custom base URL", () => {
        expect(build(name, { baseUrl: "http://hephaestus:11434" }).url).toMatch(/^http:\/\/hephaestus:11434/);
      });
    });
  }
});

describe("ollama provider", () => {
  it("posts to the chat endpoint", () => {
    expect(build("ollama").url).toBe("http://localhost:11434/api/chat");
  });

  it("disables streaming", () => {
    expect(build("ollama").body.stream).toBe(false);
  });

  it("caps tags with the schema", () => {
    expect(build("ollama").body.format.properties.tags.maxItems).toBe(2);
  });

  it("defaults to a model large enough to classify Canadian retailers", () => {
    const { body } = resolveProvider("ollama").buildRequest({
      topic: TOPIC, vocabulary: VOCABULARY, glosses: GLOSSES, maxTags: 2, config: {},
    });
    expect(body.model).toBe("qwen2.5:7b-instruct");
  });

  it("reads content from the message field", () => {
    expect(resolveProvider("ollama").extractContent({ message: { content: '{"tags":["gaming"]}' } }))
      .toBe('{"tags":["gaming"]}');
  });

  it("returns null when the response has no message", () => {
    expect(resolveProvider("ollama").extractContent({})).toBeNull();
  });
});
