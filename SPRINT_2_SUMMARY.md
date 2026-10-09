# Sprint 2 summary: write page, grading, coaching, saving, daily limit

*Finished 9 Oct 2026. Live at https://aihackton-production.up.railway.app (commit `ace4812`).*

## Goal
A student picks a topic, writes an essay, gets it graded with the teacher
app's engine, sees the result, and gets coaching from a separate call. Every
grade is saved and counted against a daily limit.

**Result: done and tested on the live site.** History page, progress stats
and photo upload are Sprint 3.

## Decisions (given in the brief, not open)
- Student feedback comes from a **separate coaching call**; the grading
  prompt is not changed. `lib/grade.js` is still an exact copy of the teacher
  engine (`node scripts/check-grader-sync.js` passes).
- The coaching prompt is **not golden-locked**: it lives in `lib/coach.js`
  and may be iterated.

## What was built

| Area | Files | Notes |
|---|---|---|
| Topic bank | `lib/topics.js` | 12 topics + "Öz mövzunuz" (custom, max 1000 chars). Served to the page by `/lib/shared.js`, together with the grader's own `countWords()`, so the page counter and the server can never disagree. |
| Grading | `routes/grade.js` | `POST /api/grade`: login → 25 grades per hour per student → topic and essay checks (≤1000 / ≤5000 chars) → daily limit → `gradeEssay()` → `grading_usage` row → `student_essays` row (`final_score` = `scaled_total`). The grade is returned even if saving fails (`saved: false`). `summary` (written for teachers) is kept in `grading_result` but never sent to the browser. |
| Daily limit | `routes/grade.js`, `lib/bakuDay.js` | Counts `grading_usage` rows since 00:00 Asia/Baku. Deleting an essay does not give a grade back. `DAILY_GRADE_LIMIT` env (default 10; production 25). `GET /api/usage/today` → `{used, limit, remaining}`. |
| Coaching | `lib/coach.js`, `routes/coaching.js` | `POST /api/essays/:id/coaching`. One coaching per essay, stored in `student_essays.coaching`; asking again returns the stored one with no API call. Does not count toward the daily limit (own limit: 30 per hour). |
| Database | `supabase/schema.sql` | `grading_usage` (insert and select own rows only; no update or delete). Applied on `essay-grader-for-students`. |
| Page | `public/home.html` | Logged-in home = write page: topic cards, "Bugün qalan yoxlama: X/25", live word counter (<70 red, 70–99 amber, 100+ green), wait card, the teacher result view (highlights, score, A–D bars, error list, zero banner; no summary), coaching cards, caveat line, unsent draft kept in this browser. |

## Coaching details
- **Model:** `claude-sonnet-5-5`, `thinking: {type: "between_tools"}` (its
  "no thinking" mode; `disabled` is rejected), effort **medium**. In the
  teacher golden runs medium and high had the same mean latency (10.0 s);
  medium used fewer tokens.
- **Input:** topic, essay, the grading JSON without `summary`, and a
  **WORD FACTS** block computed by the server (word count, words needed to
  reach 70 and 100). The model never counts words.
- **Server corrections** after parsing:
  - `lost_points` always taken from the grade;
  - a fix whose `original` is not in the essay (case- and
    space-insensitive), or whose `improved` is over 300 chars, is dropped;
  - the repeated-word count is recounted in code (whole words); 0 → removed;
  - a total-zero result must have `zero_explanation`, per-criterion cards
    are cleared;
  - wording safety net in the Azerbaijani fields: `esseni` → `essenizi`,
    `essenin`/`esseninizin` → `essenizin`, `xal` → `bal`, `fel`/`fe'l` →
    `feil` (explicit endings only).
- **Failure:** unusable output → one retry → 502 "Tövsiyələr hazırlanmadı,
  ballarınız yadda saxlanılıb" with a retry button; the scores stay.

## Tested
**Locally** (fake Supabase and a fake Claude API, nothing paid): counter
colours at exactly 69/70/99/100; validation rules a–e; second coaching from
storage with no API call; retry then 502; **limit test with
`DAILY_GRADE_LIMIT=2`: the 3rd grade was refused, also after deleting an
essay, with no API call.**

**Live**, on the founder's account:

| Essay | Words | Result | Grade | Coaching |
|---|---|---|---|---|
| Mobile phones | 133 | 15.0 (A1 B2 C0.5 D1) | 19.2 s | 8.0 s |
| Homework (one-sided) | 81 | 8.3 (A0.5 B1 C0.5 D0.5) | 17.1 s | 11.7 s |
| Public transport | 48 | 0.0 `under_70_words` | 9.4 s | 5.7 s |
| Same, after the patch | 48 | 0.0; coaching says 22 words to 70 and 52 to 100 | 10.8 s | 5.8 s |
| Off-topic (food under the music topic) | 119 | 0.0 `off_topic`; zero explanation + one sentence on language | 12.3 s | 6.9 s |
| Custom topic: part-time jobs | 126 | 16.7 (full marks) | 16.7 s | 6.6 s |
| Wording re-tests (phones, 48 words) | 133 / 48 | as above; no esseni/xal/fel in the 48-word coaching | 18.5 / 10.1 s | 7.5 s |

- Every `fix.original` appeared exactly in its essay; every improvement was
  one sentence (101–106 chars). No "sən" forms anywhere.
- Coaching followed the grade and used only the grader's errors.
- Asking for coaching twice: stored copy in about 1 s, no API call.

## Latency and cost
- **Grading** (Sonnet 5): 17–19 s for a normal essay, ~10 s for a zero case.
- **Coaching** (Sonnet 5.5): model time 4–10 s, whole request 6–12 s. The
  system prompt is cached (1,379 tokens read from cache after the first call).
- **Cost per essay:** about **$0.027** (grade ≈ $0.012 + coaching ≈ $0.015);
  a zero case ≈ $0.017. Live tests this sprint ≈ $0.18 in total.

## Limits now in production
| Limit | Value | Where |
|---|---|---|
| Grades per student per day (Baku day) | **25** | Railway `DAILY_GRADE_LIMIT` |
| Grades per student per hour | **25** | `lib/rateLimit.js` (`GRADE_MAX`) |
| Coaching requests per student per hour | 30 | `lib/rateLimit.js` (`COACH_MAX`) |

## Changes after the first live test (same sprint)
1. Word gaps from code (WORD FACTS + rule 6), new A example, "esseniz" and
   natural-Azerbaijani instruction (`3e5a270`).
2. `summary` removed from the response to the browser (`3e5a270`).
3. Limits raised to 25 per day and per hour (`ea8d8e0`, `287ac27`).
4. Wording: prompt rule + code safety net for esseni/xal/fel (`c7ab76d`, `ace4812`).

## Open items (not blocking)
1. Two grades sent at the very same moment at 24/25 could both pass the
   daily check (the hourly limit keeps this small).
2. No server-side model fallback for coaching on a refusal; a refusal counts
   as a failure (retry, then the 502 message).
3. The coach can still make other small Azerbaijani slips that the safety
   net does not cover (seen once: "artikllərı" instead of "artiklləri").
4. For full-score criteria the coach sometimes writes two sentences instead
   of one.
5. Test data on the founder's account: 8 essays and 8 usage rows from 9 Oct.

## Sprint 3 decisions needed (history, progress stats, photo upload)
- May students delete essays on the history page? (The database allows it;
  it does not give a grade back.)
- Photo reading: reuse the teacher app's photo prompt unchanged ("for a
  teacher"), or adjust it (the teacher repo requires approval for that)?
- Does a photo read (a separate paid call) count toward the 25 per day, or
  get its own limit?
