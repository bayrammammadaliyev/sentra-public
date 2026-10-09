// The student's own data (Sprint 4). Everything is read with the student's
// JWT, so Row Level Security limits it to their own rows.
//   GET /api/me/stats          average, trend, score history, A-D averages,
//                              error categories (+ practice targets)
//   GET /api/me/essays         list, newest first
//   GET /api/me/essays/:id     one stored essay, for the result view
//   GET /api/me/practice       practice sets, newest first
const express = require("express");
const router = express.Router();
const requireAuth = require("../lib/requireAuth");
const userClient = require("../lib/userClient");
const uuidParam = require("../lib/uuidParam");
const logDbError = require("../lib/logDbError");
const { computeTrend } = require("../lib/trend");
const { criteriaAverages, errorBreakdown } = require("../lib/studentStats");
const { CATEGORY_DISPLAY, pickCategory } = require("../lib/practice");

const DB_FAILED = "Məlumatları yükləmək alınmadı. Bir az sonra yenidən cəhd edin.";

router.param("essayId", uuidParam("Esse tapılmadı."));

function round1(n) {
  return Math.round(n * 10) / 10;
}

function scoresOf(g) {
  const out = {};
  for (const c of (g && g.criteria) || []) out[c.id] = c.score;
  return out;
}

// Grading result as the student sees it: without the teacher "summary".
function forStudent(g) {
  if (!g || typeof g !== "object") return g;
  const { summary, ...rest } = g;
  return rest;
}

router.get("/me/stats", requireAuth, async (req, res) => {
  const db = userClient(req.accessToken);
  const [essaysQ, setsQ] = await Promise.all([
    db.from("student_essays").select("id, final_score, created_at, grading_result").order("created_at", { ascending: true }),
    db.from("practice_sets").select("essay_id, category"),
  ]);
  if (essaysQ.error || setsQ.error) {
    logDbError("Stats error:", essaysQ.error || setsQ.error);
    return res.status(503).json({ error: DB_FAILED });
  }
  const list = essaysQ.data || [];
  const total = list.length;
  const all_time_average = total
    ? round1(list.reduce((a, e) => a + (typeof e.final_score === "number" ? Number(e.final_score) : 0), 0) / total)
    : null;
  // final_score is numeric in Postgres and may arrive as a string.
  const numeric = list.map((e) => ({ ...e, final_score: Number(e.final_score) }));
  const { direction: trend_direction, delta: trend_delta } = computeTrend(numeric);

  // For "Məşq edin": per category, the most recent essay that has an error
  // of that category and no practice set for it yet (null = none left).
  const done = new Set((setsQ.data || []).map((s) => `${s.essay_id}\u0000${s.category}`));
  const practice_targets = {};
  for (const e of list.slice().reverse()) {
    for (const err of (e.grading_result && e.grading_result.errors) || []) {
      const cat = err && err.category;
      if (!cat) continue;
      if (!(cat in practice_targets)) practice_targets[cat] = null;
      if (practice_targets[cat] === null && !done.has(`${e.id}\u0000${cat}`)) practice_targets[cat] = e.id;
    }
  }

  res.json({
    total_essays: total,
    all_time_average,
    trend_direction,
    trend_delta,
    recent_count: Math.min(total, 7),
    score_history: numeric.slice(-8).map((e) => ({ created_at: e.created_at, final_score: e.final_score })),
    criteria_averages: criteriaAverages(list),
    category_breakdown: errorBreakdown(list).map((c) => ({
      ...c,
      category_name: CATEGORY_DISPLAY[c.category] || c.category,
      practice_essay_id: practice_targets[c.category] || null,
    })),
  });
});

router.get("/me/essays", requireAuth, async (req, res) => {
  const db = userClient(req.accessToken);
  const { data, error } = await db
    .from("student_essays")
    .select("id, topic, final_score, created_at, grading_result, parent_essay_id")
    .order("created_at", { ascending: false });
  if (error) {
    logDbError("Essay list error:", error);
    return res.status(503).json({ error: DB_FAILED });
  }
  res.json({
    essays: (data || []).map((e) => ({
      id: e.id,
      created_at: e.created_at,
      topic: e.topic,
      scaled_total: Number(e.final_score),
      criteria: scoresOf(e.grading_result),
      total_zero_reason: e.grading_result && e.grading_result.total_zero_reason,
      is_rewrite: !!e.parent_essay_id,
    })),
  });
});

router.get("/me/essays/:essayId", requireAuth, async (req, res) => {
  const db = userClient(req.accessToken);
  const { data: e, error } = await db
    .from("student_essays")
    .select("id, topic, essay_text, grading_result, coaching, final_score, created_at, parent_essay_id")
    .eq("id", req.params.essayId)
    .maybeSingle();
  if (error) {
    logDbError("Essay load error:", error);
    return res.status(503).json({ error: DB_FAILED });
  }
  if (!e) return res.status(404).json({ error: "Esse tapılmadı." });

  let parent = null;
  if (e.parent_essay_id) {
    const p = await db.from("student_essays").select("id, grading_result").eq("id", e.parent_essay_id).maybeSingle();
    if (p.data) {
      const g = p.data.grading_result || {};
      parent = {
        essay_id: p.data.id,
        scaled_total: g.scaled_total,
        criteria: scoresOf(g),
        word_count: g.word_count,
        error_count: Array.isArray(g.errors) ? g.errors.length : 0,
      };
    }
  }
  const picked = pickCategory(e.grading_result, e.essay_text);
  res.json({
    id: e.id,
    created_at: e.created_at,
    topic: e.topic,
    essay_text: e.essay_text,
    result: {
      ...forStudent(e.grading_result),
      saved: true,
      essay_id: e.id,
      parent,
      practice: picked ? { category: picked.category, category_name: CATEGORY_DISPLAY[picked.category] || picked.category } : null,
    },
    coaching: e.coaching || null,
  });
});

router.get("/me/practice", requireAuth, async (req, res) => {
  const db = userClient(req.accessToken);
  const { data, error } = await db
    .from("practice_sets")
    .select("id, essay_id, category, score, answers, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    logDbError("Practice list error:", error);
    return res.status(503).json({ error: DB_FAILED });
  }
  res.json({
    practice: (data || []).map((s) => ({
      id: s.id,
      essay_id: s.essay_id,
      category: s.category,
      category_name: CATEGORY_DISPLAY[s.category] || s.category,
      created_at: s.created_at,
      answered: Array.isArray(s.answers),
      score: Array.isArray(s.answers) ? s.score : null,
    })),
  });
});

module.exports = router;
