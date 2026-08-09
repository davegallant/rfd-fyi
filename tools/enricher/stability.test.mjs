import { describe, expect, it } from "vitest";
import { majorityOfThree, modalAnswer, summariseStability } from "./stability.mjs";

/** classifyBatch keys results by topic_id, and the probe assigns 1-based ids. */
function run(...tagsInOrder) {
  return Object.fromEntries(tagsInOrder.map((tags, index) => [String(index + 1), tags]));
}

describe("majorityOfThree", () => {
  it("leaves certainty alone", () => {
    expect(majorityOfThree(1)).toBe(1);
    expect(majorityOfThree(0)).toBe(0);
  });

  it("improves an answer the model usually gets right", () => {
    expect(majorityOfThree(0.75)).toBeCloseTo(0.84, 2);
  });

  /**
   * The reason self-consistency was rejected: voting does not rescue a deal the
   * model only reaches 71% of the time, it just shortens the odds.
   */
  it("does not rescue a coin-flip deal", () => {
    expect(majorityOfThree(0.71)).toBeLessThan(0.81);
  });

  it("amplifies a majority-wrong answer rather than fixing it", () => {
    expect(majorityOfThree(0.4)).toBeLessThan(0.4);
  });
});

describe("modalAnswer", () => {
  it("returns the most frequent answer", () => {
    expect(modalAnswer(["home", "computing", "home"])).toBe("home");
  });
});

describe("summariseStability", () => {
  it("scores against the hand label when a case has one", () => {
    const deals = [{ expect: "apparel", title: "Running Shoes" }];
    const result = summariseStability(deals, [run(["apparel"]), run(["sports"]), run(["apparel"])]);
    expect(result.rows[0].p).toBeCloseTo(2 / 3);
    expect(result.unstable).toBe(1);
    expect(result.stable).toBe(0);
  });

  /**
   * A labelled case counts as correct when the expected tag appears at all, the
   * same rule scoreCases uses — a second tag is not a failure of the same kind
   * as the wrong tag.
   */
  it("accepts the expected tag alongside a second one", () => {
    const deals = [{ expect: "apparel", title: "Golf Shoe" }];
    const result = summariseStability(deals, [run(["sports", "apparel"])]);
    expect(result.rows[0].p).toBe(1);
  });

  it("measures agreement with the modal answer when unlabelled", () => {
    const deals = [{ title: "Jackery Power Station" }];
    const result = summariseStability(deals, [run(["electronics"]), run(["home"]), run(["electronics"])]);
    expect(result.rows[0].reference).toBe("electronics");
    expect(result.rows[0].p).toBeCloseTo(2 / 3);
  });

  it("counts a deal the model never gets right separately from an unstable one", () => {
    const deals = [{ expect: "automotive", title: "CAA basic membership" }];
    const result = summariseStability(deals, [run(["financial"]), run(["financial"])]);
    expect(result.alwaysWrong).toBe(1);
    expect(result.unstable).toBe(0);
  });

  it("treats a skipped topic as a non-answer rather than crashing", () => {
    const deals = [{ expect: "gaming", title: "Free Steam Game" }];
    const result = summariseStability(deals, [{}, run(["gaming"])]);
    expect(result.rows[0].p).toBe(0.5);
  });
});
