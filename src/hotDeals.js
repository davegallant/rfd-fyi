import dayjs from "dayjs";

/**
 * Time-decayed hotness: a deal is hot when its score is high relative to its
 * age. Computed at render time (not stored) because hotness decays while the
 * tab sits open. Cached topics keep their last-fetched votes, so hotness for
 * older cached deals reflects the votes as of their last refresh.
 */
export function isHotDeal(topic, now = dayjs()) {
  const score = Number(topic.score) || 0;
  if (score < 15) return false;

  const postedAt = dayjs(topic.post_time);
  if (!postedAt.isValid()) return false;

  const ageHours = Math.max(now.diff(postedAt, "hour", true), 1);
  const hotness = score / Math.pow(ageHours + 2, 0.6);
  return hotness >= 5;
}
