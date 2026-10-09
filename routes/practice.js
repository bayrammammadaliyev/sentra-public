// Practice on the student's most frequent error category.
//   POST /api/essays/:id/practice      create (or return) the set
//   POST /api/practice/:id/answers     check answers on the server
//   POST /api/practice/:id/report      flag a question as wrong
const express = require("express");
const router = express.Router();
const requireAuth = require("../lib/requireAuth");
const userClient = require("../lib/userClient");
const uuidParam = require("../lib/uuidParam");
const logDbError = require("../lib/logDbError");
const { practiceLimiter } = require("../lib/rateLimit");
const { startOfBakuDay } = require("../lib/bakuDay");
const {
  CATEGORY_DISPLAY,
  PracticeError,
  pickCategory,
  makePractice,
  publicQuestions,
  checkAnswers,
} = require("../lib/practice");
const { anthropicErrorResponse, logAnthropicError } = require("../lib/anthropicError");

const ESSAY_NOT_FOUND = "Esse tapılmadı.";
const SET_NOT_FOUND = "Məşq tapılmadı.";
const NO_ERRORS = "Bu essedə məşq üçün səhv tapılmadı";
const PRACTICE_FAILED = "Məşq hazırlanmadı, yenidən cəhd edin";
const LIMIT_REACHED = "Bugünkü məşq limitiniz bitib. Sabah (Bakı vaxtı ilə 00:00-dan sonra) yenidən cəhd edin.";
const DB_FAILED = "Məlumatları yükləmək alınmadı. Bir az sonra yenidən cəhd edin.";

function practiceDailyLimit() {
  const n = Number.parseInt(process.env.PRACTICE_DAILY_LIMIT, 10);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

router.param("id", uuidParam(ESSAY_NOT_FOUND));

// The answer to the page: never the correct options before answering.
function setOut(row, errors) {
  const out = {
    id: row.id,
    category: row.category,
    category_name: CATEGORY_DISPLAY[row.category] || row.category,
    errors,
    questions: publicQuestions(row.questions),
    reported: Array.isArray(row.reported) ? row.reported : [],
  };
  if (Array.isArray(row.answers)) Object.assign(out, checkAnswers(row.questions, row.answers));
  return out;
}

router.post("/essays/:id/practice", requireAuth, practiceLimiter, async (req, res) => {
  const db = userClient(req.accessToken);

  const { data: essay, error } = await db
    .from("student_essays")
    .select("id, topic, essay_text, grading_result")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) {
    logDbError("Practice essay lookup error:", error);
    return res.status(503).json({ error: DB_FAILED });
  }
  if (!essay) return res.status(404).json({ error: ESSAY_NOT_FOUND });

  // Optional "category" (practice hub): must be one of this essay's error
  // categories. Without it: the most frequent one, as before.
  const requested = req.body && req.body.category;
  let picked;
  if (requested !== undefined && requested !== null) {
    const errs = ((essay.grading_result && essay.grading_result.errors) || []).filter((e) => e && e.category === requested);
    if (typeof requested !== "string" || !errs.length) {
      return res.status(400).json({ error: "Bu essedə belə səhv növü yoxdur." });
    }
    picked = {
      category: requested,
      errors: errs.map((e) => ({ original: String(e.original || ""), corrected: String(e.corrected || "") })),
    };
  } else {
    picked = pickCategory(essay.grading_result, essay.essay_text);
  }
  if (!picked) return res.status(400).json({ error: NO_ERRORS });

  // Already made for this essay and category: return it, no API call.
  const existing = await db
    .from("practice_sets")
    .select("id, category, questions, answers, score, reported")
    .eq("essay_id", essay.id)
    .eq("category", picked.category)
    .maybeSingle();
  if (existing.error) {
    logDbError("Practice lookup error:", existing.error);
    return res.status(503).json({ error: DB_FAILED });
  }
  if (existing.data) return res.json({ ...setOut(existing.data, picked.errors), stored: true });

  // Daily cap, counted from practice_sets (no delete policy: can't be reset).
  const limit = practiceDailyLimit();
  const { count, error: countErr } = await db
    .from("practice_sets")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfBakuDay().toISOString());
  if (countErr) {
    logDbError("Practice count error:", countErr);
    return res.status(503).json({ error: DB_FAILED });
  }
  if ((count || 0) >= limit) {
    return res.status(429).json({ error: LIMIT_REACHED, code: "practice_daily_limit" });
  }

  let questions;
  try {
    const out = await makePractice({ category: picked.category, errors: picked.errors, topic: essay.topic });
    questions = out.questions;
    console.log("practice ok:", JSON.stringify(out.attempts.map((a) => ({
      ms: a.ms, stop: a.stopReason, error: a.error,
      out_tok: a.usage && a.usage.output_tokens,
      in_tok: a.usage && a.usage.input_tokens,
      cache_read: a.usage && a.usage.cache_read_input_tokens,
    }))));
  } catch (err) {
    if (err instanceof PracticeError) {
      console.error("practice failed:", JSON.stringify((err.attempts || []).map((a) => ({ ms: a.ms, stop: a.stopReason, error: a.error }))));
      return res.status(502).json({ error: PRACTICE_FAILED });
    }
    logAnthropicError("Practice API error:", err);
    const { status, error: message } = anthropicErrorResponse(err, PRACTICE_FAILED);
    return res.status(status).json({ error: message });
  }

  const { data: saved, error: saveErr } = await db
    .from("practice_sets")
    .insert({ essay_id: essay.id, category: picked.category, questions })
    .select("id, category, questions, answers, score, reported")
    .single();
  if (saveErr) {
    // Unique (essay_id, category): another tab saved one first; use that.
    if (saveErr.code === "23505") {
      const again = await db
        .from("practice_sets")
        .select("id, category, questions, answers, score, reported")
        .eq("essay_id", essay.id)
        .eq("category", picked.category)
        .maybeSingle();
      if (again.data) return res.json({ ...setOut(again.data, picked.errors), stored: true });
    }
    logDbError("Practice save error:", saveErr);
    return res.status(503).json({ error: PRACTICE_FAILED });
  }
  res.json({ ...setOut(saved, picked.errors), stored: false });
});

async function loadSet(db, id) {
  return db
    .from("practice_sets")
    .select("id, category, questions, answers, score, reported")
    .eq("id", id)
    .maybeSingle();
}

router.post("/practice/:id/answers", requireAuth, async (req, res) => {
  const db = userClient(req.accessToken);
  const { data: set, error } = await loadSet(db, req.params.id);
  if (error) {
    logDbError("Practice set lookup error:", error);
    return res.status(503).json({ error: DB_FAILED });
  }
  if (!set) return res.status(404).json({ error: SET_NOT_FOUND });

  // Answered before: the first answers stay; show them again.
  if (Array.isArray(set.answers)) return res.json({ ...checkAnswers(set.questions, set.answers), stored: true });

  const answers = req.body && req.body.answers;
  if (
    !Array.isArray(answers) || answers.length !== set.questions.length ||
    !answers.every((a, i) => typeof a === "string" && set.questions[i].options.includes(a))
  ) {
    return res.status(400).json({ error: "Hər suala bir cavab seçin." });
  }

  const checked = checkAnswers(set.questions, answers);
  const { error: upErr } = await db
    .from("practice_sets")
    .update({ answers, score: checked.score })
    .eq("id", set.id);
  if (upErr) logDbError("Practice answers save error:", upErr);
  res.json({ ...checked, stored: false, saved: !upErr });
});

router.post("/practice/:id/report", requireAuth, async (req, res) => {
  const db = userClient(req.accessToken);
  const { data: set, error } = await loadSet(db, req.params.id);
  if (error) {
    logDbError("Practice set lookup error:", error);
    return res.status(503).json({ error: DB_FAILED });
  }
  if (!set) return res.status(404).json({ error: SET_NOT_FOUND });

  const index = req.body && req.body.index;
  if (!Number.isInteger(index) || index < 0 || index >= set.questions.length) {
    return res.status(400).json({ error: "Sual tapılmadı." });
  }
  const reported = Array.isArray(set.reported) ? set.reported.slice() : [];
  if (!reported.includes(index)) reported.push(index);
  const { error: upErr } = await db.from("practice_sets").update({ reported }).eq("id", set.id);
  if (upErr) {
    logDbError("Practice report save error:", upErr);
    return res.status(503).json({ error: DB_FAILED });
  }
  res.json({ reported });
});

module.exports = router;
