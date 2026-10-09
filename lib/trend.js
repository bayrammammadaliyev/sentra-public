// Score trend over a student's most recent essays (oldest first).
// Used by the student stats page and the class page, so both always agree.
// Rule: needs 3+ essays; compares the average of the older half of the
// last 7 essays with the newer half; more than +0.5 is "up", less than
// -0.5 is "down", otherwise "stable". delta is rounded to 1 decimal.
function round1(n) {
  return Math.round(n * 10) / 10;
}

function scoreOf(e) {
  return typeof e.final_score === "number" ? e.final_score : 0;
}

function computeTrend(essaysOldestFirst) {
  const recent = (essaysOldestFirst || []).slice(-7);
  if (recent.length < 3) return { direction: null, delta: null };
  const split = Math.ceil(recent.length / 2);
  const first = recent.slice(0, split);
  const second = recent.slice(split);
  if (first.length === 0 || second.length === 0) return { direction: null, delta: null };
  const avg = (arr) => arr.reduce((a, x) => a + scoreOf(x), 0) / arr.length;
  const diff = avg(second) - avg(first);
  const direction = diff > 0.5 ? "up" : diff < -0.5 ? "down" : "stable";
  return { direction, delta: round1(diff) };
}

module.exports = { computeTrend };
