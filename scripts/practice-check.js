#!/usr/bin/env node
// Practice reliability check (Sprint 3 patch): builds practice sets for the
// weak demo essay with lib/practice.js directly (no live site, no database),
// and reports per set: generation attempts, solver-check results, latency
// and the questions with their intended answers.
//
//   ANTHROPIC_API_KEY=... node scripts/practice-check.js --sets 5
//
// Every set is 2+ paid calls (generation + solver check, more on retries).
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const { makePractice, PracticeError } = require("../lib/practice");

const TOPIC = "Should students be allowed to use mobile phones at school?";
// The weak demo essay's article errors, as the live grade returned them
// (9 Oct 2026; the same 3 article errors in all 3 demo-check runs).
const ERRORS = [
  { original: "not use mobile phones at the school", corrected: "not use mobile phones at school" },
  { original: "Phones are big problem", corrected: "Phones are a big problem" },
  { original: "Teacher must take phones in morning", corrected: "Teachers must take phones in the morning" },
];

async function main() {
  const sets = Number(opt("sets", 5));
  let firstFailed = 0;
  let failedSets = 0;
  const solverOrValidation = [];
  for (let n = 1; n <= sets; n++) {
    const started = Date.now();
    try {
      const { questions, attempts } = await makePractice({ category: "article", errors: ERRORS, topic: TOPIC });
      const solver = attempts.filter((a) => a.solver);
      // attempts: [gen1, solver1?, gen2, solver2?] - the first generation
      // failed if it was unusable (validation) or its solver check failed.
      const first = attempts[0];
      const firstSolver = attempts[1] && attempts[1].solver ? attempts[1] : null;
      const firstReason = first.error && first.error !== "solver check failed" ? `validation: ${first.error}`
        : firstSolver && !firstSolver.pass ? `solver: ambiguous ${firstSolver.ambiguous}, mismatch ${firstSolver.mismatches}` : null;
      if (firstReason) { firstFailed++; solverOrValidation.push(firstReason); }
      console.log(`\nSet ${n}: ${((Date.now() - started) / 1000).toFixed(1)}s, ` +
        `generations ${attempts.filter((a) => !a.solver).length}, solver ` +
        solver.map((s) => (s.pass ? "pass" : `FAIL (ambiguous ${s.ambiguous}, mismatch ${s.mismatches})`)).join(" → "));
      for (const a of solver.filter((x) => !x.pass)) console.log(`     solver reply: ${a.unusable ? "UNUSABLE " + JSON.stringify(a.raw) : JSON.stringify(a.answers)}`);
      questions.forEach((q, i) => {
        console.log(`  ${i + 1}. ${q.sentence}\n     options ${q.options.map((o) => JSON.stringify(o)).join(" ")}  correct ${JSON.stringify(q.correct)}`);
        console.log(`     ${q.explanation}`);
      });
    } catch (err) {
      failedSets++;
      firstFailed++;
      if (!(err instanceof PracticeError)) throw err;
      console.log(`\nSet ${n}: FAILED after ${((Date.now() - started) / 1000).toFixed(1)}s: ${err.message}`);
      for (const a of err.attempts || []) console.log("   ", JSON.stringify({ solver: !!a.solver, pass: a.pass, ambiguous: a.ambiguous, mismatches: a.mismatches, error: a.error, ms: a.ms, raw: a.raw, answers: a.answers }));
    }
  }
  console.log(`\nFirst attempts that failed: ${firstFailed}/${sets} ${JSON.stringify(solverOrValidation)}; sets that failed completely (would be 502): ${failedSets}/${sets}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
