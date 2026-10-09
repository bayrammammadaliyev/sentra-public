// POST /api/essays/:id/coaching: one coaching per essay, stored in
// student_essays.coaching. Does not count toward the daily grading limit.
const express = require("express");
const router = express.Router();
const requireAuth = require("../lib/requireAuth");
const userClient = require("../lib/userClient");
const uuidParam = require("../lib/uuidParam");
const logDbError = require("../lib/logDbError");
const { coachLimiter } = require("../lib/rateLimit");
const { coachEssay, CoachingError } = require("../lib/coach");
const { anthropicErrorResponse, logAnthropicError } = require("../lib/anthropicError");

const NOT_FOUND = "Esse tapılmadı.";
const COACH_FAILED = "Tövsiyələr hazırlanmadı, ballarınız yadda saxlanılıb";

router.param("id", uuidParam(NOT_FOUND));

router.post("/essays/:id/coaching", requireAuth, coachLimiter, async (req, res) => {
  const db = userClient(req.accessToken);

  // RLS: only the owner's essay is visible, so "not found" also covers
  // "someone else's essay".
  const { data: row, error } = await db
    .from("student_essays")
    .select("id, topic, essay_text, grading_result, coaching")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) {
    logDbError("Coaching essay lookup error:", error);
    return res.status(503).json({ error: "Esse yüklənmədi. Bir az sonra yenidən cəhd edin." });
  }
  if (!row) return res.status(404).json({ error: NOT_FOUND });

  // Already coached: return it, no new API call.
  if (row.coaching) return res.json({ coaching: row.coaching, stored: true });

  let coaching;
  try {
    const out = await coachEssay({ topic: row.topic, essay: row.essay_text, grading: row.grading_result });
    coaching = out.coaching;
    // Content-free timing line, for the latency report.
    console.log("coaching ok:", JSON.stringify(out.attempts.map((a) => ({
      ms: a.ms, stop: a.stopReason, error: a.error,
      out_tok: a.usage && a.usage.output_tokens,
      in_tok: a.usage && a.usage.input_tokens,
      cache_read: a.usage && a.usage.cache_read_input_tokens,
    }))));
  } catch (err) {
    if (err instanceof CoachingError) {
      console.error("coaching failed:", JSON.stringify((err.attempts || []).map((a) => ({ ms: a.ms, stop: a.stopReason, error: a.error }))));
      return res.status(502).json({ error: COACH_FAILED });
    }
    logAnthropicError("Coaching API error:", err);
    const { status, error: message } = anthropicErrorResponse(err, COACH_FAILED);
    return res.status(status).json({ error: message });
  }

  // Save only the coaching column, and only if no other request saved one
  // meanwhile (two tabs): then that first one is kept and returned.
  const { data: updated, error: upErr } = await db
    .from("student_essays")
    .update({ coaching })
    .eq("id", row.id)
    .is("coaching", null)
    .select("coaching")
    .maybeSingle();
  if (upErr) {
    logDbError("Coaching save error:", upErr);
    return res.json({ coaching, stored: false, saved: false });
  }
  if (!updated) {
    const again = await db.from("student_essays").select("coaching").eq("id", row.id).maybeSingle();
    if (again.data && again.data.coaching) return res.json({ coaching: again.data.coaching, stored: true });
  }
  res.json({ coaching, stored: false, saved: true });
});

module.exports = router;
