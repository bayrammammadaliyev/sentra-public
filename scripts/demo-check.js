#!/usr/bin/env node
// Demo-essay check for the hackathon demo flow (Sprint 3).
//
// Grades the two demo essays with lib/grade.js directly (no live site, no
// daily limit), several runs each, and prints A B C D, the scaled total and
// the error categories with counts. The weak essay's most frequent category
// must be "article" (the practice step is built on it).
//
//   node scripts/demo-check.js
//   node scripts/demo-check.js --runs 3 --env /path/to/.env
//
// Options:
//   --runs <n>   runs per essay (default 3)
//   --env <path> .env file with ANTHROPIC_API_KEY (default: ./.env)
//
// Every run is a paid API call (about $0.012 per grade).
const path = require("path");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
require("dotenv").config({ path: path.resolve(opt("env", path.join(__dirname, "..", ".env"))), quiet: true });

const { gradeEssay } = require("../lib/grade");

const TOPIC = "Should students be allowed to use mobile phones at school?";

// The demo essays, exactly as given in the Sprint 3 brief. Do not edit.
const ESSAYS = {
  weak: "I think students should not use mobile phones at the school. Phones are big problem in class. When student uses phone, he not listen to teacher. For example, my friend play games in lesson and he go home with bad marks. Also phones make students lazy because they always look at the screen. They do not talk with friends in break time. Teacher must take phones in morning and give back after the lessons. In my opinion, phones are bad for the students and school must ban them.",
  rewrite: "In my opinion, students should not be allowed to use mobile phones at school. First of all, phones distract students during lessons. For example, my friend often played games in class, and as a result, he got bad marks. In addition, students who spend every break looking at a screen do not talk to their classmates. On the other hand, some people believe that phones are useful in an emergency, because parents can call their children. However, schools already have a telephone, so students can contact their families if something happens. To sum up, although phones have some benefits, I believe schools should keep them in a locker until the end of the day.",
};

// Same rule as the practice step: most frequent category; a tie goes to the
// category whose first error appears earliest in the essay.
function topCategory(errors, essay) {
  const counts = {};
  const firstPos = {};
  const lower = essay.toLowerCase();
  for (const e of errors) {
    counts[e.category] = (counts[e.category] || 0) + 1;
    const p = lower.indexOf(String(e.original || "").toLowerCase());
    const pos = p < 0 ? Infinity : p;
    if (!(e.category in firstPos) || pos < firstPos[e.category]) firstPos[e.category] = pos;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || firstPos[a] - firstPos[b])[0] || null;
}

async function main() {
  const runs = Number(opt("runs", 3));
  const summary = {};
  for (const [name, essay] of Object.entries(ESSAYS)) {
    summary[name] = [];
    for (let run = 1; run <= runs; run++) {
      try {
        const { result, ms } = await gradeEssay({ prompt: TOPIC, essay });
        const s = Object.fromEntries(result.criteria.map((c) => [c.id, c.score]));
        const cats = {};
        for (const e of result.errors) cats[e.category] = (cats[e.category] || 0) + 1;
        const top = topCategory(result.errors, essay);
        summary[name].push({ s, scaled: result.scaled_total, top });
        console.log(
          `${name.padEnd(7)} run ${run}  A${s.A} B${s.B} C${s.C} D${s.D} = ${result.scaled_total}` +
          `  words ${result.word_count}  errors ${result.errors.length} ${JSON.stringify(cats)}` +
          `  top: ${top}  ${(ms / 1000).toFixed(1)}s`
        );
      } catch (err) {
        console.log(`${name.padEnd(7)} run ${run}  ERROR: ${err.logDetail || err.message}`);
        summary[name].push({ error: true });
      }
    }
  }

  let ok = true;
  for (const [name, rows] of Object.entries(summary)) {
    const keys = new Set(rows.map((r) => (r.error ? "error" : JSON.stringify(r.s))));
    if (keys.size !== 1) {
      ok = false;
      console.log(`\nSTOP: ${name} scores vary between runs.`);
    }
  }
  if (summary.weak.some((r) => r.top !== "article")) {
    ok = false;
    console.log(`\nSTOP: the weak essay's most frequent category is not always "article".`);
  }
  console.log(ok ? "\nDemo essays OK: stable scores, weak essay's top category is article." : "");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
