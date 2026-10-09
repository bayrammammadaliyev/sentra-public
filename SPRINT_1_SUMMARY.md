# Sprint 1 summary: e-meyar student version, foundation

*Finished 9 Oct 2026. Live at https://aihackton-production.up.railway.app*

## Goal
A deployed skeleton where a student can sign up and log in, with the grading
engine copied from the teacher app and verified. No grading UI yet.

**Result: done.** Sign-up, email confirmation, login, automatic session
refresh, logout and password reset all work on the live site.

## What was built

| Area | Files | Notes |
|---|---|---|
| Grading engine | `lib/grade.js`, `lib/anthropic.js`, `lib/anthropicError.js` | Byte-identical copy of `gradeEssay()` from the teacher repo (`routes/grade.js` at `0418ad2`): same prompt, validation, word count, model (`claude-sonnet-5`, thinking off). Only the Express route, Supabase parts and one `require` path were removed. **Never edited here.** |
| Sync check | `scripts/check-grader-sync.js` | Compares `STATIC_SYSTEM`, `countWords`, `validateGradingResult` and 8 other engine parts with the teacher repo (path given with `--teacher`, ref `origin/main`). Fails with the exact differing line. |
| Auth API | `routes/auth.js`, `lib/authErrors.js`, `lib/requireAuth.js`, `lib/rateLimit.js`, `lib/supabase.js` | Adapted from the teacher app. Sign-up without invite code (email confirmation ON, answers "check your email", never a session). Login, logout, me, forgot-password, update-password as in the teacher app. **New:** `POST /api/auth/refresh`. All messages in Azerbaijani. |
| Session in the browser | `public/lib/auth.js` | Keeps both access and refresh token. On a 401 it refreshes once and repeats the request; only if that fails does it log out. One refresh at a time across tabs. |
| Server | `server.js` | Teacher hardening: security headers, HSTS, trust proxy, last-resort error handler, `/api/health` with the live commit, JSON 404 for unknown API paths. No host redirects (no domain yet). |
| Pages | `public/*.html` | Placeholder landing, sign-up, login, forgot, reset, empty home page. Teacher look (same CSS, fonts, logos, day/night mode). |
| Database | `supabase/schema.sql` | `student_essays` with RLS: a student sees, adds and deletes only their own rows; only `coaching` can be updated (column grant); `anon` has no access. Index on `(user_id, created_at desc)`. Already run on the student project. |
| Deploy | `railway.json`, `.env.example` | Same as the teacher app. |

## Golden check (grading engine)
- Student copy, full set, 1 run: 7/9 full matches. #2 C (known) and #5 D 1 (want 0.5).
- #5 re-run 3× on the teacher `routes/grade.js` and 3× on the student `lib/grade.js`: D 0.5 every time (3/3 each). Both copies behave the same; the first #5 D 1 was a one-off model variation.
- The golden set stays at 9 essays. Golden outputs are kept out of git (`scripts/golden-results/`).

## Tested on the live site
- Health check, every page, security headers, `http` → `https`.
- API without login → 401; wrong password, short password, missing name, broken reset link, malformed JSON → the right Azerbaijani messages.
- Sign-up + email confirmation (founder, with Supabase's built-in sender). Password reset end to end with Gmail SMTP (Supabase logs: `/recover` → `/verify` → new password → login).
- Not yet seen in the logs: a sign-up confirmation email sent through Gmail SMTP (same sender as the reset email, so expected to work).
- Session refresh: with a broken access token, two API calls at once both succeeded through one refresh; tokens rotated and survived a reload.
- Logout: tokens cleared and the old refresh token refused by the server.
- A dead saved session → login page, storage cleared.

## Problems found and fixed during the sprint
1. **Malformed refresh token gave 503** (`a8a4640`). Supabase answers it with `400 validation_failed`; every 4xx refusal of a refresh token now means "log in again" (401).
2. **Email links landing on the landing page were ignored** (`7482b8d`). Supabase sends failed (and some) links to the Site URL. The landing page now forwards working links to the reset or login page and explains failed ones. Sign-up also got its own message for Supabase's email-send limit.
3. **Emails stopped** (settings, not code): Supabase's built-in sender allows only a few emails per hour. Replaced by Gmail SMTP with an app password; the email limit is now 30 per hour. A first attempt failed with Gmail `535 BadCredentials` until a new app password was saved.

## Environment (names only)
- **Railway** project `respectful-wonder`, service `ai_hackton`, deploys `main` from GitHub. Variables: `ANTHROPIC_API_KEY` (student key), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL`, `NODE_ENV`.
- **Supabase** project `essay-grader-for-students`: email confirmation ON; Site URL and redirect URLs (`/login.html`, `/reset-password.html`) set to the Railway domain; custom SMTP (Gmail).
- Kept out of git: `.env`, `api.txt` (personal key), `node_modules/`, golden outputs.

## Rules carried forward
- `lib/grade.js` is never edited in this repo. Change grading in the teacher repo, pass its golden run, copy it here, run `node scripts/check-grader-sync.js`.
- Nothing in the teacher repo is changed from this project.

## Open items (for later, not blocking)
1. Supabase allows 30 logins per 5 minutes per IP, and every login comes from our server's IP: a whole class logging in at once could hit it. Same for our own login limit (10 per 15 min per IP).
2. Logout signs the student out on every device (same as the teacher app).
3. Sign-up has no terms / privacy links; minors signing up need the lawyer question answered.
4. Email sender name is "SENTRA", not "e-meyar".
5. Gmail SMTP is fine for a pilot (about 500 emails a day); move to a provider with your own domain before real use.
6. Sprint 2 decisions: student-facing feedback wording (prompt change + golden run, or UI only), grading limits per student, where topics come from.

## Next: Sprint 2
Grading page: the student writes an essay, it is graded with `lib/grade.js`, the result is shown and saved to `student_essays`.
