// POST /api/grade and GET /api/usage/today for students.
// Grading itself is lib/grade.js (an exact copy of the teacher engine, never
// edited here); this file only checks input, the daily limit, and saves.
const express = require("express");
const router = express.Router();
const requireAuth = require("../lib/requireAuth");
const userClient = require("../lib/userClient");
const logDbError = require("../lib/logDbError");
const { gradeLimiter } = require("../lib/rateLimit");
const { startOfBakuDay } = require("../lib/bakuDay");
const { gradeEssay, GradingError } = require("../lib/grade");
const { anthropicErrorResponse, logAnthropicError } = require("../lib/anthropicError");
const { MAX_TOPIC_CHARS, MAX_ESSAY_CHARS } = require("../lib/topics");
const { pickCategory, CATEGORY_DISPLAY } = require("../lib/practice");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARENT_NOT_FOUND = "Yenidən yazmaq istədiyiniz esse tapılmadı.";

// What the before/after card needs from the essay being rewritten.
function parentSummary(g) {
  const scores = {};
  for (const c of (g && g.criteria) || []) scores[c.id] = c.score;
  return {
    scaled_total: g && g.scaled_total,
    criteria: scores,
    word_count: g && g.word_count,
    error_count: Array.isArray(g && g.errors) ? g.errors.length : 0,
  };
}

// Grades per student per Baku calendar day. Env so it can be lowered for a
// test without a deploy of new code.
function dailyLimit() {
  const n = Number.parseInt(process.env.DAILY_GRADE_LIMIT, 10);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

const LIMIT_REACHED =
  "Bugünkü yoxlama limitiniz bitib. Sabah (Bakı vaxtı ilə 00:00-dan sonra) yenidən cəhd edin.";
const USAGE_FAILED = "Gündəlik limiti yoxlamaq alınmadı. Bir az sonra yenidən cəhd edin.";

// Successful grades today, counted from grading_usage (RLS: own rows only).
// student_essays can't be used: students may delete essays.
async function usedToday(db) {
  const { count, error } = await db
    .from("grading_usage")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfBakuDay().toISOString());
  if (error) throw error;
  return count || 0;
}

router.get("/usage/today", requireAuth, async (req, res) => {
  const limit = dailyLimit();
  try {
    const used = await usedToday(userClient(req.accessToken));
    res.json({ used, limit, remaining: Math.max(0, limit - used) });
  } catch (err) {
    logDbError("Usage count error:", err);
    res.status(503).json({ error: USAGE_FAILED });
  }
});

router.post("/grade", requireAuth, gradeLimiter, async (req, res) => {
  const { essay, parent_essay_id: parentId } = req.body || {};
  let { topic } = req.body || {};
  const db = userClient(req.accessToken);

  // A rewrite: load the essay being rewritten with the student's JWT (RLS =
  // ownership) BEFORE anything is paid for. Its topic is used, whatever the
  // page sent.
  let parent = null;
  if (parentId !== undefined && parentId !== null) {
    if (typeof parentId !== "string" || !UUID_RE.test(parentId)) {
      return res.status(404).json({ error: PARENT_NOT_FOUND });
    }
    const { data, error } = await db
      .from("student_essays")
      .select("id, topic, grading_result")
      .eq("id", parentId)
      .maybeSingle();
    if (error) {
      logDbError("Parent essay lookup error:", error);
      return res.status(503).json({ error: "Esse yüklənmədi. Bir az sonra yenidən cəhd edin." });
    }
    if (!data) return res.status(404).json({ error: PARENT_NOT_FOUND });
    parent = data;
    topic = data.topic;
  }

  // Same checks and order as the teacher route: type first (the size guards
  // rely on string .length), and a blank essay must not cost an API call.
  if (typeof topic !== "string" || !topic.trim()) {
    return res.status(400).json({ error: "Mövzu seçin və ya öz mövzunuzu yazın." });
  }
  if (typeof essay !== "string" || !essay.trim()) {
    return res.status(400).json({ error: "Yazınızı daxil edin." });
  }
  if (topic.length > MAX_TOPIC_CHARS) {
    return res.status(400).json({ error: `Mövzu çox uzundur (maksimum ${MAX_TOPIC_CHARS} simvol).` });
  }
  if (essay.length > MAX_ESSAY_CHARS) {
    return res.status(400).json({
      error: `Mətn çox uzundur (maksimum ${MAX_ESSAY_CHARS} simvol). Zəhmət olmasa qısaldın.`,
    });
  }

  const limit = dailyLimit();

  // Daily limit BEFORE the paid API call.
  let used;
  try {
    used = await usedToday(db);
  } catch (err) {
    logDbError("Usage count error:", err);
    return res.status(503).json({ error: USAGE_FAILED });
  }
  if (used >= limit) {
    return res.status(429).json({ error: LIMIT_REACHED, code: "daily_limit", used, limit, remaining: 0 });
  }

  let result;
  try {
    ({ result } = await gradeEssay({ prompt: topic, essay }));
  } catch (err) {
    if (err instanceof GradingError) {
      console.error(err.logDetail);
      return res.status(500).json({ error: err.userMessage });
    }
    logAnthropicError("Grading error:", err);
    const { status, error } = anthropicErrorResponse(
      err,
      "Qiymətləndirmə zamanı xəta baş verdi. Yenidən cəhd edin."
    );
    return res.status(status).json({ error });
  }

  // The grade succeeded: count it first (the limit must hold even if saving
  // the essay fails), then save the essay. Neither failure hides the grade.
  const usage = await db.from("grading_usage").insert({});
  if (usage.error) logDbError("Usage insert error:", usage.error);
  const remaining = Math.max(0, limit - used - (usage.error ? 0 : 1));

  const { data: saved, error: saveErr } = await db
    .from("student_essays")
    .insert({
      topic,
      essay_text: essay,
      grading_result: result,
      final_score: result.scaled_total,
      ...(parent ? { parent_essay_id: parent.id } : {}),
    })
    .select("id")
    .single();

  // "summary" is written for a teacher: kept in grading_result (saved above
  // in full), never sent to the student's browser.
  const { summary, ...forStudent } = result;
  if (parent) forStudent.parent = { essay_id: parent.id, ...parentSummary(parent.grading_result) };
  // The practice button's category (same rule as POST .../practice).
  const picked = pickCategory(result, essay);
  forStudent.practice = picked
    ? { category: picked.category, category_name: CATEGORY_DISPLAY[picked.category] || picked.category }
    : null;
  if (saveErr) {
    logDbError("Essay save error:", saveErr);
    return res.json({ ...forStudent, saved: false, essay_id: null, remaining_today: remaining, limit });
  }
  res.json({ ...forStudent, saved: true, essay_id: saved.id, remaining_today: remaining, limit });
});

module.exports = router;
