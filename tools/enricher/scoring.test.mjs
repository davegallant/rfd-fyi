import { describe, expect, it } from "vitest";
import { compareScores, scoreCases, summarise } from "./scoring.mjs";

const cases = [
  { class: "power tools", expect: "home", title: "Dewalt 20V Max Oscillating Tool" },
  { class: "power tools", expect: "home", title: "Knipex Pliers Wrench" },
  { class: "phones", expect: "electronics", title: "iPhone 17 Pro Max" },
];

describe("scoreCases", () => {
  it("counts a case correct when the expected tag is present", () => {
    const score = scoreCases(cases, [["home"], ["home"], ["electronics"]]);
    expect(score.correct).toBe(3);
    expect(score.accuracy).toBe(1);
  });

  /**
   * A second tag is not the same failure as the wrong tag. A camping stove
   * tagged `["home", "sports"]` has found its category; treating that as a miss
   * would overstate the error rate and hide the misclassifications that matter.
   */
  it("accepts the expected tag in second position", () => {
    const score = scoreCases([cases[0]], [["sports", "home"]]);
    expect(score.correct).toBe(1);
  });

  it("records what a miss was tagged instead", () => {
    const score = scoreCases([cases[0]], [["computing"]]);
    expect(score.classes[0].misses).toEqual([
      { title: "Dewalt 20V Max Oscillating Tool", got: "computing" },
    ]);
  });

  // The model returning nothing usable is a miss, not a crash.
  it("treats an unclassified case as a miss rather than throwing", () => {
    const score = scoreCases([cases[0]], [null]);
    expect(score.correct).toBe(0);
    expect(score.classes[0].misses[0].got).toBe("(none)");
  });

  it("groups by class and keeps each class's expected tag", () => {
    const score = scoreCases(cases, [["home"], ["computing"], ["electronics"]]);
    expect(score.classes.map((entry) => [entry.name, entry.correct, entry.total])).toEqual([
      ["power tools", 1, 2],
      ["phones", 1, 1],
    ]);
    expect(score.classes[0].expect).toBe("home");
  });

  it("reports zero accuracy for an empty case list without dividing by zero", () => {
    expect(scoreCases([], []).accuracy).toBe(0);
  });
});

describe("summarise", () => {
  const entries = [["home"], ["home"], ["computing"], ["grocery", "other"], ["other"]];

  it("ranks categories by how often they are the primary tag", () => {
    expect(summarise(entries).largest).toEqual({ tag: "home", share: 0.4 });
  });

  it("reports the other rate from primary tags only", () => {
    expect(summarise(entries).otherRate).toBe(0.2);
  });

  /**
   * `other` beside a real tag is incoherent — it means "nothing else fits". The
   * server normalizes it away, so a non-zero count here means the model is
   * still emitting it and the normalization is doing work.
   */
  it("counts other used as a companion tag separately", () => {
    expect(summarise(entries).otherAsCompanion).toBe(1);
  });

  it("reports the multi-tag rate, which flags a model filling the schema", () => {
    expect(summarise(entries).multiTagRate).toBe(0.2);
  });

  it("ignores entries the model failed to classify", () => {
    expect(summarise([["home"], null, undefined]).count).toBe(1);
  });

  it("returns no largest category for an empty run", () => {
    expect(summarise([]).largest).toBeNull();
  });
});

describe("compareScores", () => {
  const before = scoreCases(cases, [["home"], ["computing"], ["electronics"]]);
  const after = scoreCases(cases, [["home"], ["home"], ["computing"]]);

  it("reports the per-class movement rather than one number", () => {
    expect(compareScores(before, after).classes).toEqual([
      { name: "power tools", total: 2, before: 1, after: 2, delta: 1 },
      { name: "phones", total: 1, before: 1, after: 0, delta: -1 },
    ]);
  });

  it("totals the movement across classes", () => {
    expect(compareScores(before, after).delta).toBe(0);
  });

  // Case sets change as deals age out; a class only present on one side would
  // otherwise read as a swing of its whole size.
  it("skips classes that are not in both runs", () => {
    const extra = scoreCases(
      [...cases, { class: "toys", expect: "kids", title: "LEGO Minecraft" }],
      [["home"], ["home"], ["computing"], ["kids"]],
    );
    expect(compareScores(before, extra).classes.map((entry) => entry.name))
      .toEqual(["power tools", "phones"]);
  });
});
