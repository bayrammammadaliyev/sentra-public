# Sprint 3 summary: the learning loop, photo upload, landing page

*Finished 9 Oct 2026. Live at https://sentra.up.railway.app.
Known-good tags: `demo-safe-1` (`db0eb1d`), `demo-safe-2` (`55483d5`).*

## Demo flow (works end to end, tested live)
weak essay (8.3) → result + coaching → "Səhvlərimdən məşq" (3 questions on
the most frequent error category) → "Yenidən yazın" (same topic locked, text
preloaded) → graded rewrite (16.7) → before/after card "8.3 → 16.7 ↑ (+8.4)".

## What was built

| Part | Commit | Notes |
|---|---|---|
| Rewrites | `4115eb4` | `student_essays.parent_essay_id`; `POST /api/grade` takes `parent_essay_id`, loads the parent with the student's JWT **before** the paid call (404 otherwise), forces the parent's topic, returns `parent` scores for the card. |
| Practice | `4115eb4`, `db0eb1d` | `practice_sets` (RLS: own rows; update only answers/score/reported; no delete). `POST /api/essays/:id/practice` (top category, tie → first in the essay; stored set returned without an API call; `PRACTICE_DAILY_LIMIT`, default 10), `/api/practice/:id/answers` (checked on the server), `/api/practice/:id/report`. Options shuffled on the server; correct answers never sent before answering. |
| Practice reliability | `db0eb1d` | Extra prompt rule (one acceptable answer; no article gaps before school/hospital/…); **solver check**: a second Sonnet 5.5 call answers the questions blind; AMBIGUOUS or a different answer → regenerate (max 2), then 502. Structured outputs for generation and solver. Final test: 5/5 sets passed first time, 6.6–12.1 s per set. |
| Before/after card | `4115eb4` | Pure frontend from the grade's `parent` block: total, A–D, words, errors; up green, down red, equal dimmed. |
| Photo upload | `aef5f92` | `routes/transcribe.js` byte-identical to the teacher's (`0418ad2`); 20 reads/hour; "Şəkildən yüklə" tab with the teacher's browser code + a `[?]` note. Photos and raw text never stored. `check-grader-sync.js` also checks the photo reader. |
| SENTRA name | `aef5f92` | Titles, auth pages, landing, sidebar; text wordmark (the lockup images said e-meyar). |
| Landing page | `55483d5` | Static, text exactly from the brief, before/after example, works on phone and night mode; email-link forwarding kept. |
| Wording | `f40d8d7`, `db0eb1d` | Coach: every "esseniniz-" form → "esseniz-"; vowel harmony rule ("A da"). |
| Demo check | `4115eb4` | `scripts/demo-check.js`: weak 8.3 (A0.5 B1 C0.5 D0.5) and rewrite 16.7, identical in 3 runs; top category article (3–3 tie with subject-verb agreement, decided by first position). |

## Bugs found and fixed during the sprint
1. The brief's insert policy for rewrites referenced `parent_essay_id`
   unqualified inside its subquery; Postgres resolved it to the subquery's
   own column and **every rewrite would have been refused**. Fixed by
   qualifying `student_essays.parent_essay_id`.
2. The practice solver sometimes answered in prose; ~1 in 5 generations was
   broken JSON or had 4 questions → fixed with structured outputs.

## Latency and cost (live)
- Grade 16–23 s, coaching ~10 s (17 s cold), practice ~6–12 s, photo read
  ~3–5 s, refused parent ids < 1 s with no API call.
- Per essay ≈ $0.027 (grade + coaching); practice set ≈ $0.007; photo
  read ≈ $0.01.

## Open items
1. Photo reader (copied unchanged, same in e-meyar): with blur it silently
   **corrects** student errors; with blots it reconstructs hidden words
   instead of `[?]`; a reply "apology + NO_ESSAY_FOUND" lands in the
   textarea. Fix in the teacher repo first, then copy.
2. Practice: some gaps before plural nouns are still ambiguous ("___ phones"
   → "-" or "the"); the solver does not always catch them. Explanations
   sometimes say "hesab olunan" (should be "sayılan") or "xüsusi" (should be
   "konkret").
3. Coach slips not covered by the safety net, e.g. "yekun cümləsi".
4. The practice table can be read by its owner directly (incl. answers);
   needs the anon key, which the browser never gets.
5. Railway's `ANTHROPIC_API_KEY` must be set to the high-credit key by the
   founder (I can't enter keys in web forms). e-meyar's key had low credit.
6. "Isn't yours" parent ids were tested only as "not found" (no second
   account); RLS makes both paths the same.
