// Numbers for the student statistics page, computed from the stored grading
// results (essays oldest first). Pure functions, no database access.
const CRITERIA = [
  { id: "A", max: 1 },
  { id: "B", max: 2 },
  { id: "C", max: 1 },
  { id: "D", max: 1 },
];

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Average score per criterion (A-D) over the essays that have one.
function criteriaAverages(essays) {
  return CRITERIA.map((def, i) => {
    const scores = [];
    for (const e of essays || []) {
      const list = e.grading_result && e.grading_result.criteria;
      if (!Array.isArray(list)) continue;
      const c = list.find((x) => x && x.id === def.id) || list[i];
      if (c && typeof c.score === "number" && isFinite(c.score)) scores.push(c.score);
    }
    return {
      id: def.id,
      max: def.max,
      average: scores.length
        ? round2(scores.reduce((a, s) => a + s, 0) / scores.length)
        : null,
      count: scores.length,
    };
  });
}

// Error counts per category, most frequent first (ties keep first-seen
// order). Each category also gets one example: the original -> corrected
// pair seen most often, and on a tie the most recent one.
function errorBreakdown(essays) {
  const cats = new Map();
  let seq = 0;
  for (const e of essays || []) {
    const errs = e.grading_result && e.grading_result.errors;
    if (!Array.isArray(errs)) continue;
    for (const err of errs) {
      if (!err || !err.category) continue;
      let cat = cats.get(err.category);
      if (!cat) {
        cat = { count: 0, pairs: new Map() };
        cats.set(err.category, cat);
      }
      cat.count++;
      const o = typeof err.original === "string" ? err.original.trim() : "";
      const c = typeof err.corrected === "string" ? err.corrected.trim() : "";
      if (!o) continue;
      const key = o.toLowerCase() + "\u0000" + c.toLowerCase();
      const pair = cat.pairs.get(key) || { n: 0 };
      pair.n++;
      pair.last = ++seq;
      pair.original = o;
      pair.corrected = c;
      cat.pairs.set(key, pair);
    }
  }
  return [...cats.entries()]
    .map(([category, cat]) => {
      let best = null;
      for (const p of cat.pairs.values()) {
        if (!best || p.n > best.n || (p.n === best.n && p.last > best.last)) best = p;
      }
      return {
        category,
        count: cat.count,
        example: best ? { original: best.original, corrected: best.corrected } : null,
      };
    })
    .sort((a, b) => b.count - a.count);
}

module.exports = { criteriaAverages, errorBreakdown };
