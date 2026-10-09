# SENTRA

**Live demo:** https://aihackton-production.up.railway.app

SENTRA is a practice app for Azerbaijani 11th-grade students preparing for
Task 26 of the DİM 2027 English exam: an opinion paragraph of at least 100
words. It grades the essay on the official DİM criteria A–D, explains every
lost point, builds short grammar practice from the student's most frequent
mistakes, and lets them rewrite the essay and compare before and after.

> **Azərbaycanca:** SENTRA DİM 2027 ingilis dili imtahanının 26-cı tapşırığına
> hazırlaşan şagirdlər üçündür. Esseniz rəsmi A, B, C, D meyarları üzrə
> qiymətləndirilir, hər itirilmiş balın səbəbi izah olunur, ən çox etdiyiniz
> səhvlər üzrə məşq hazırlanır və essenizi yenidən yazıb əvvəlki nəticə ilə
> müqayisə edə bilərsiniz.

## The learning loop
1. **Write or photograph** the essay (the photo is read into editable text).
2. **Grade:** scores for A, B, C, D and a total on the 16.7-point scale;
   errors are highlighted in the text.
3. **Coaching:** for each criterion, why points were lost and one improved
   version of the student's own sentence (never a ready-made essay).
4. **Practice:** 3 questions on the most frequent error type. A second,
   blind "solver" call rejects ambiguous questions before a student sees them.
5. **Rewrite:** same topic, previous text preloaded, then a before/after card
   per criterion.
6. **Results:** score trend, criterion averages, most frequent errors,
   recommendations, and every past essay with its stored feedback.

## Stack
- **Server:** Node.js + Express 5 (`server.js`, `routes/`, `lib/`).
- **Frontend:** plain HTML/CSS/JS in `public/`, no framework, no build step.
- **AI:** Anthropic Claude: `claude-sonnet-5` for grading and photo reading,
  `claude-sonnet-5-5` for coaching and practice (structured outputs).
- **Data and auth:** Supabase (Postgres + Auth). The server holds only the
  anon key and queries with the student's own JWT, so Row Level Security
  (`supabase/schema.sql`) keeps each student's data separate.
- **Hosting:** Railway (`railway.json`).

## Run locally
1. Node.js 20+, then `npm install`.
2. `cp .env.example .env` and fill in the names listed there: an Anthropic
   API key, a Supabase project URL and anon key, `SITE_URL` for email links,
   and `GRADING_PROMPT` (see "Withheld").
3. Run `supabase/schema.sql` once in the Supabase SQL Editor.
4. `npm start`, then open http://localhost:3000.

## Withheld
The calibrated DİM grading prompt (`STATIC_SYSTEM` in `lib/grade.js`) is the
core asset of our prior product, [e-meyar.az](https://e-meyar.az), and is
withheld from this public snapshot. In this repo it is read from the
`GRADING_PROMPT` environment variable; without it, grading stops with a clear
error. **The live demo uses the full prompt.** Judges can request read access
to the full private repository.

## Prior work
Reused from our own product e-meyar.az (the teacher version):
- the **grading engine** (`lib/grade.js`: request, validation, word count;
  the prompt itself is withheld),
- the **photo reader** (`routes/transcribe.js` and its browser upload code),
- the **auth flow** (`routes/auth.js`, `lib/authErrors.js`,
  `lib/requireAuth.js`, rate limiting),
- the **styles and page look** (`public/public.css`, `public/app.css`, the
  theme and network helpers), the **result view** on the write page, and the
  **statistics helpers** and card layout (`lib/studentStats.js`,
  `lib/trend.js`).

Built during the hackathon:
- student accounts with email confirmation and automatic session refresh,
- the SENTRA write page with a 12-topic bank and custom topics,
- coaching per criterion (`lib/coach.js`) with server-side checks,
- daily grading limits and usage tracking,
- practice from the student's own errors with the blind solver check
  (`lib/practice.js`, `routes/practice.js`),
- rewrite flow with the before/after card,
- the practice hub ("Bacarıqlarınızı inkişaf etdirin") and the results page
  ("Nəticələrim") with `GET /api/me/*`,
- the Supabase schema with Row Level Security for student data,
- the landing page and SENTRA branding,
- scripts: engine sync check, demo-essay check, practice reliability check.

Sprint-by-sprint notes, including test results, are in `SPRINT_*_SUMMARY.md`.

*AI grading can make mistakes; results on the real exam may differ.*
