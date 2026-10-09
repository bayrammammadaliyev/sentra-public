#!/usr/bin/env node
// Checks that lib/grade.js is still an exact copy of the teacher app's grading
// engine (essay-grader, routes/grade.js), and that routes/transcribe.js (the
// photo reader, Sprint 3b) still matches the teacher's: the prompt, the API
// request, the file checks and the confidence logic. Fails loudly on ANY
// difference.
//
//   node scripts/check-grader-sync.js
//   node scripts/check-grader-sync.js --teacher /path/to/essay-grader --ref origin/main
//   node scripts/check-grader-sync.js --file /path/to/grade.js
//
// Options:
//   --teacher <path>  teacher repo (or set $TEACHER_REPO; required)
//   --ref <ref>       git ref to read routes/grade.js from (default: origin/main;
//                     run `git fetch` in the teacher repo first)
//   --file <path>     compare lib/grade.js against this file instead of a git ref
//   --transcribe-file <path>  same for routes/transcribe.js
//
// Read-only: it never writes to the teacher repo.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const root = path.join(__dirname, "..");
const teacherArg = opt("teacher", process.env.TEACHER_REPO);
const ref = opt("ref", "origin/main");
const file = opt("file", null);

function fail(msg) {
  console.error(`\nGRADER SYNC FAILED: ${msg}\n`);
  process.exit(1);
}

if (!teacherArg && !opt("file", null)) {
  fail("no teacher repo given: pass --teacher <path> or set TEACHER_REPO (or use --file).");
}
const teacherRepo = teacherArg ? path.resolve(teacherArg) : null;

let teacherSrc;
let source;
if (file) {
  source = path.resolve(file);
  teacherSrc = fs.readFileSync(source, "utf8");
} else {
  source = `${teacherRepo} @ ${ref}:routes/grade.js`;
  try {
    teacherSrc = execFileSync("git", ["-C", teacherRepo, "show", `${ref}:routes/grade.js`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    fail(`cannot read ${source}: ${String(err.stderr || err.message).trim()}`);
  }
}
const studentSrc = fs.readFileSync(path.join(root, "lib", "grade.js"), "utf8");

// Splits a file into its top-level declarations, keyed by name. A declaration
// runs from its first line to the line before the next top-level statement;
// trailing blank lines and the next declaration's leading // comments are
// dropped. Good enough for this file's plain style.
function topLevelDecls(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const startRe = /^(?:const|let|var|class|function|async function)\s+([A-Za-z_$][\w$]*)/;
  const anyTopRe = /^(?:const|let|var|class|function|async function|router\.|module\.exports)/;
  const decls = {};
  for (let i = 0; i < lines.length; i++) {
    const m = startRe.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !anyTopRe.test(lines[j])) j++;
    let end = j;
    while (end > i + 1 && (/^\s*$/.test(lines[end - 1]) || /^\/\//.test(lines[end - 1]))) end--;
    decls[m[1]] = lines.slice(i, end).join("\n");
  }
  return decls;
}

const teacher = topLevelDecls(teacherSrc);
const student = topLevelDecls(studentSrc);

// The three the sprint requires, then everything else the engine depends on.
const REQUIRED = ["STATIC_SYSTEM", "countWords", "validateGradingResult"];
const ALSO = [
  "CRITERION_MAX",
  "ALLOWED_ZERO_REASONS",
  "buildDynamicBlock",
  "describeResult",
  "GRADING_MODEL",
  "modelSettings",
  "GradingError",
  "gradeEssay",
];

function firstDiffLine(a, b) {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      return `line ${i + 1} of the declaration\n    teacher: ${JSON.stringify(al[i])}\n    student: ${JSON.stringify(bl[i])}`;
    }
  }
  return "(no line difference found)";
}

console.log(`Teacher copy: ${source}`);
const problems = [];
for (const name of [...REQUIRED, ...ALSO]) {
  const t = teacher[name];
  const s = student[name];
  let status;
  if (t === undefined) status = "MISSING in teacher copy";
  else if (s === undefined) status = "MISSING in lib/grade.js";
  else if (t !== s) status = `DIFFERENT at ${firstDiffLine(t, s)}`;
  else status = "identical";
  console.log(`  ${status === "identical" ? "OK  " : "FAIL"} ${name}${status === "identical" ? "" : `: ${status}`}`);
  if (status !== "identical") problems.push(name);
}

// Also compare what actually runs: the loaded module's prompt and word count.
const loaded = require(path.join(root, "lib", "grade.js"));
const tsMatch = /const STATIC_SYSTEM = (`[\s\S]*?`);\n/.exec(teacherSrc);
if (!tsMatch) {
  problems.push("STATIC_SYSTEM (value)");
  console.log("  FAIL STATIC_SYSTEM value: not found in teacher copy");
} else {
  // Evaluates the template literal only (it has no ${} substitutions).
  const teacherPrompt = new Function(`return ${tsMatch[1]};`)();
  const same = teacherPrompt === loaded.STATIC_SYSTEM;
  console.log(`  ${same ? "OK  " : "FAIL"} STATIC_SYSTEM value (${loaded.STATIC_SYSTEM.length} chars)`);
  if (!same) problems.push("STATIC_SYSTEM (value)");
}

// ---- routes/transcribe.js (photo reader) ----------------------------------
const tFile = opt("transcribe-file", null);
let teacherT;
let tSource;
if (tFile) {
  tSource = path.resolve(tFile);
  teacherT = fs.readFileSync(tSource, "utf8");
} else {
  tSource = `${teacherRepo} @ ${ref}:routes/transcribe.js`;
  try {
    teacherT = execFileSync("git", ["-C", teacherRepo, "show", `${ref}:routes/transcribe.js`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    fail(`cannot read ${tSource}: ${String(err.stderr || err.message).trim()}`);
  }
}
const studentT = fs.readFileSync(path.join(root, "routes", "transcribe.js"), "utf8");

// A block of code from its first line to the end marker (inclusive).
function block(src, start, end) {
  const i = src.indexOf(start);
  if (i < 0) return undefined;
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? undefined : src.slice(i, j + end.length);
}
const T_BLOCKS = {
  "API request (model, max_tokens, thinking, content)": [
    "const message = await anthropic.messages.create({", "\n      });"],
  "confidence logic (NO_ESSAY_FOUND, LOW_CONFIDENCE, [?])": [
    "// Check for no-essay marker", "res.json({ transcription: text, confidence });"],
  "file checks (HEIC 415, type 415, base64 size)": [
    "const mediaType = detectImageType(req.file.buffer);", "return res.status(413).json({ error: TOO_BIG });\n    }"],
};
const T_DECLS = ["TRANSCRIPTION_PROMPT", "detectImageType", "PNG_SIGNATURE", "MAX_SIZE", "API_MAX_BASE64", "TOO_BIG", "upload"];

console.log(`\nTeacher copy: ${tSource}`);
const tProblems = [];
const tTeacher = topLevelDecls(teacherT);
const tStudent = topLevelDecls(studentT);
for (const name of T_DECLS) {
  const t = tTeacher[name];
  const st = tStudent[name];
  let status;
  if (t === undefined) status = "MISSING in teacher copy";
  else if (st === undefined) status = "MISSING in routes/transcribe.js";
  else if (t !== st) status = `DIFFERENT at ${firstDiffLine(t, st)}`;
  else status = "identical";
  console.log(`  ${status === "identical" ? "OK  " : "FAIL"} ${name}${status === "identical" ? "" : `: ${status}`}`);
  if (status !== "identical") tProblems.push(name);
}
for (const [label, [start, end]] of Object.entries(T_BLOCKS)) {
  const t = block(teacherT, start, end);
  const st = block(studentT, start, end);
  let status;
  if (t === undefined) status = "MISSING in teacher copy";
  else if (st === undefined) status = "MISSING in routes/transcribe.js";
  else if (t !== st) status = `DIFFERENT at ${firstDiffLine(t, st)}`;
  else status = "identical";
  console.log(`  ${status === "identical" ? "OK  " : "FAIL"} ${label}${status === "identical" ? "" : `: ${status}`}`);
  if (status !== "identical") tProblems.push(label);
}
const tpMatch = /const TRANSCRIPTION_PROMPT = (`[\s\S]*?`);\n/.exec(teacherT);
const spMatch = /const TRANSCRIPTION_PROMPT = (`[\s\S]*?`);\n/.exec(studentT);
if (!tpMatch || !spMatch) {
  tProblems.push("TRANSCRIPTION_PROMPT (value)");
  console.log("  FAIL TRANSCRIPTION_PROMPT value: not found");
} else {
  const a = new Function(`return ${tpMatch[1]};`)();
  const b = new Function(`return ${spMatch[1]};`)();
  console.log(`  ${a === b ? "OK  " : "FAIL"} TRANSCRIPTION_PROMPT value (${b.length} chars)`);
  if (a !== b) tProblems.push("TRANSCRIPTION_PROMPT (value)");
}
const wholeSame = teacherT === studentT;
console.log(`  ${wholeSame ? "OK  " : "NOTE"} whole file ${wholeSame ? "byte-identical" : "differs from the teacher copy"}`);

if (problems.length || tProblems.length) {
  fail(
    (problems.length ? `lib/grade.js differs from the teacher engine in: ${problems.join(", ")}.\n` +
      "Do not edit lib/grade.js here. Re-copy it from the teacher repo after the change\n" +
      "has passed the golden run there.\n" : "") +
    (tProblems.length ? `routes/transcribe.js differs from the teacher photo reader in: ${tProblems.join(", ")}.\n` +
      "Re-copy it from the teacher repo; do not change the prompt or the confidence logic here.\n" : "")
  );
}
console.log("\nGrader and photo reader in sync with the teacher app.");
