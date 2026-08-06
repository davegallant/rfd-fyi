/**
 * Scoring for the offline evaluator.
 *
 * These are pure functions over already-classified data so they can be unit
 * tested without a model, which matters here: every gloss change so far has
 * been unverifiable until a deploy and a re-tag, and the arithmetic that judges
 * the result should not be part of what is untested.
 *
 * Two views, because they disagree and both matter. `scoreCases` asks "did the
 * deal land where its gloss says", measured on hand-labelled cases. `summarise`
 * asks "what shape is the distribution", which is what the enricher README's
 * criteria are about. v6 scored better than v8 on the first and worse on the
 * second; a single number would have hidden that.
 */

/** Tags a deal was given, or null when the model produced nothing usable. */
function has(tags, tag) {
  return Array.isArray(tags) && tags.includes(tag);
}

/**
 * Scores classifications against hand-labelled expectations.
 *
 * A case counts as correct when the expected tag appears at all, not only as
 * the primary tag: `["home", "sports"]` for a camping stove is not a failure of
 * the same kind as `["computing"]`, and conflating them would overstate errors.
 */
export function scoreCases(cases, tagsList) {
  const byClass = new Map();

  cases.forEach((testCase, index) => {
    const tags = tagsList[index] ?? null;
    const entry = byClass.get(testCase.class) ?? {
      name: testCase.class,
      expect: testCase.expect,
      total: 0,
      correct: 0,
      misses: [],
    };

    entry.total += 1;
    if (has(tags, testCase.expect)) {
      entry.correct += 1;
    } else {
      entry.misses.push({ title: testCase.title, got: tags ? tags.join("+") : "(none)" });
    }

    byClass.set(testCase.class, entry);
  });

  const classes = [...byClass.values()];
  const total = classes.reduce((sum, entry) => sum + entry.total, 0);
  const correct = classes.reduce((sum, entry) => sum + entry.correct, 0);

  return { classes, total, correct, accuracy: total > 0 ? correct / total : 0 };
}

/**
 * Distribution shape, mirroring what "Judging tag quality" in the README asks
 * for: a category that dominates, a saturated tag limit, or a high `other` rate.
 *
 * `otherAsCompanion` is counted separately because `other` means "nothing else
 * fits" and cannot be true beside a real tag. The server normalizes it away, so
 * a non-zero count here means the model is still producing it.
 */
export function summarise(entriesList) {
  const entries = entriesList.filter(Array.isArray);
  const histogram = {};
  let otherAsCompanion = 0;
  let multiTag = 0;

  for (const tags of entries) {
    histogram[tags[0]] = (histogram[tags[0]] ?? 0) + 1;
    if (tags.length > 1) {
      multiTag += 1;
      if (tags.includes("other")) otherAsCompanion += 1;
    }
  }

  const count = entries.length;
  const ranked = Object.entries(histogram).sort((a, b) => b[1] - a[1]);
  const rate = (n) => (count > 0 ? n / count : 0);

  return {
    count,
    histogram,
    ranked,
    largest: ranked.length > 0 ? { tag: ranked[0][0], share: rate(ranked[0][1]) } : null,
    otherRate: rate(histogram.other ?? 0),
    otherAsCompanion,
    multiTagRate: rate(multiTag),
  };
}

/**
 * Per-class delta between two scored runs, so a change is reported as what it
 * moved rather than as a single percentage. Classes missing from either side
 * are skipped rather than counted as zero.
 */
export function compareScores(before, after) {
  const beforeByName = new Map(before.classes.map((entry) => [entry.name, entry]));

  const classes = after.classes
    .filter((entry) => beforeByName.has(entry.name))
    .map((entry) => {
      const previous = beforeByName.get(entry.name);
      return {
        name: entry.name,
        total: entry.total,
        before: previous.correct,
        after: entry.correct,
        delta: entry.correct - previous.correct,
      };
    });

  return {
    classes,
    before: before.correct,
    after: after.correct,
    delta: after.correct - before.correct,
  };
}
