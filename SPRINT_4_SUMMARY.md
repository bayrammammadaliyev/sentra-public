# Sprint 4 summary: three sections + landing additions

*Finished 9 Oct 2026. Live at https://aihackton-production.up.railway.app.
Known-good tags: `demo-safe-3` (`ec2be63`, Sprint 4), `demo-safe-4`
(`cdaf4c1`, landing additions).*

Reuse only: no new prompts, no changes to `lib/grade.js`, coaching or
practice prompts. Live-tested by the founder on their account (all passed).

## Sidebar (3 sections, one page)
1. **Esse bacarıqlarınızı yoxlayın**: the existing write → result → coaching
   → practice → rewrite flow.
2. **Bacarıqlarınızı inkişaf etdirin** (practice hub):
   - "Ən çox etdiyiniz səhvlər": one card per error category across all
     essays (count, one example, Azerbaijani name), most frequent first.
   - "Məşq edin" opens practice for that category on the most recent essay
     that has it and no set for it yet; none left → disabled, "Bu səhv
     üzrə yeni məşq üçün yeni esse yazın".
   - "Məşq tarixçəsi": every set with date and score (or "cavablanmayıb").
   - No errors yet → empty state with a button to the write page.
3. **Nəticələrim**: the teacher student-stats cards (Bal trendi, Meyarlar
   üzrə ortalama, Ən çox təkrarlanan səhvlər, Tövsiyələr in "siz" form;
   error rows link to the hub) and "Esselərim". An essay opens in the
   existing result view with its stored coaching (no new API call) and the
   before/after card for rewrites. Fewer than 2 essays → empty state.

The sections are views on the same page (switched by the address `#yaz`,
`#inkisaf`, `#neticeler`), so the result, coaching, practice and rewrite code
is reused without copies.

## API
| Route | What |
|---|---|
| `GET /api/me/stats` | average, trend (last 7), score history (last 8), A–D averages, error categories with one example each, and the practice target essay per category. Uses `lib/studentStats.js` and `lib/trend.js` copied **unchanged** from the teacher app. |
| `GET /api/me/essays` | date, topic, score, A–D, rewrite marker; newest first. |
| `GET /api/me/essays/:id` | one stored essay for the result view (grading without the teacher summary, coaching, parent scores). |
| `GET /api/me/practice` | practice sets, newest first. |
| `POST /api/essays/:id/practice` | optional `category` (must be one of that essay's error categories, else 400); unchanged without it. |

All reads use the student's JWT (RLS).

## Landing page additions (`cdaf4c1`)
"İmkanlar" (6 cards with icons) and "Üstünlüklərimiz" (6 numbered cards on a
dark band), text exactly as given, both in the top bar. Order: Hero →
İmkanlar → Necə işləyir → Üstünlüklərimiz → Niyə SENTRA → footer.

## Open items
- The page heading on the write view still says "Esse yaz" while the sidebar
  item says "Esse bacarıqlarınızı yoxlayın".
- Everything listed under "Open items" in SPRINT_3_SUMMARY.md still applies.
