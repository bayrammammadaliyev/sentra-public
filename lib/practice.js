// "Səhvlərimdən məşq": 3 multiple-choice questions on the grammar point a
// student got wrong most often in one essay. Separate call, like coaching;
// not golden-locked.
const crypto = require("crypto");
const anthropic = require("./anthropic");
const { COACH_MODEL, COACH_SETTINGS } = require("./coach");

// Same model and thinking/effort setting as coaching.
const PRACTICE_MODEL = COACH_MODEL;
const PRACTICE_SETTINGS = { ...COACH_SETTINGS, max_tokens: 3000 };

const PRACTICE_SYSTEM = `You write short grammar practice for Azerbaijani 11th-grade students preparing for an English exam. You receive an error category, the student's own mistakes in that category (original → corrected), and the topic of their essay.

Write exactly 3 multiple-choice questions that practise the SAME grammar point as the student's mistakes.
- Each question is one English sentence with exactly one gap written as ___ .
- Sentences are NEW: never copy or lightly reword the student's sentences. Keep them related to the essay topic, at B1 level.
- 3 or 4 options, all different. Exactly ONE option is correct in standard English; every wrong option must be clearly wrong, not just less natural. For articles, use "-" as the no-article option.
- Each gap must have exactly ONE acceptable answer in every reading of the sentence. Give enough context to rule out the others (first mention vs already mentioned, specific vs general). For articles, never put a gap before nouns where both an article and no article can be correct (school, hospital, church, prison, bed, college, university, work, home).
- Where possible, each question tests a different case of the rule.
- explanation: one natural, grammatically correct Azerbaijani sentence, addressing the student politely as "siz", saying why the correct answer is right.

Output only JSON, no markdown:
{"questions":[{"sentence":"...","options":["...","..."],"correct":"<the correct option text>","explanation":"..."}]}`;

// From the teacher app's routes/student-stats.js (CATEGORY_DISPLAY), with
// "fel" written "feil" as the founder asked.
const CATEGORY_DISPLAY = {
  article: "artikllər (a/an/the)",
  subject_verb_agreement: "mübtəda-xəbər uzlaşması",
  pronoun_antecedent: "əvəzlik uzlaşması",
  contraction: "qısaltmalar (apostrof)",
  uncountable_noun: "sayılmayan isimlər",
  spelling: "orfoqrafiya",
  preposition: "ön qoşmalar",
  tense: "feil zamanları",
  word_form: "söz forması",
};

class PracticeError extends Error {}

const normalize = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();
const isText = (v) => typeof v === "string" && v.trim().length > 0;

// The most frequent error category; a tie goes to the category whose first
// error appears earliest in the essay. Returns { category, errors } or null.
function pickCategory(grading, essay) {
  const errors = Array.isArray(grading && grading.errors) ? grading.errors : [];
  const counts = {};
  const firstPos = {};
  const lower = String(essay || "").toLowerCase();
  for (const e of errors) {
    if (!e || !isText(e.category)) continue;
    counts[e.category] = (counts[e.category] || 0) + 1;
    const p = lower.indexOf(String(e.original || "").toLowerCase());
    const pos = p < 0 ? Infinity : p;
    if (!(e.category in firstPos) || pos < firstPos[e.category]) firstPos[e.category] = pos;
  }
  const category = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || firstPos[a] - firstPos[b])[0];
  if (!category) return null;
  return {
    category,
    errors: errors
      .filter((e) => e && e.category === category)
      .map((e) => ({ original: String(e.original || ""), corrected: String(e.corrected || "") })),
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Checks the model's questions (brief rules), then shuffles the options on
// the server. Throws PracticeError when unusable (the caller retries once).
// `banned` = the student's original and corrected texts: a question must
// not be one of them (also checked with the gap filled in).
function validateQuestions(out, banned) {
  if (!out || typeof out !== "object" || !Array.isArray(out.questions)) throw new PracticeError("no questions array");
  if (out.questions.length !== 3) throw new PracticeError(`expected 3 questions, got ${out.questions.length}`);
  const bannedNorm = new Set(banned.filter(isText).map(normalize));

  const questions = out.questions.map((q, i) => {
    if (!q || typeof q !== "object") throw new PracticeError(`question ${i} not an object`);
    if (!isText(q.sentence)) throw new PracticeError(`question ${i}: sentence missing`);
    const sentence = q.sentence.trim();
    if (sentence.split("___").length - 1 !== 1) throw new PracticeError(`question ${i}: gap must appear exactly once`);
    if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 4) {
      throw new PracticeError(`question ${i}: 3-4 options needed`);
    }
    if (!q.options.every(isText)) throw new PracticeError(`question ${i}: empty option`);
    const options = q.options.map((o) => o.trim());
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      throw new PracticeError(`question ${i}: options not unique`);
    }
    if (!isText(q.correct)) throw new PracticeError(`question ${i}: correct missing`);
    const correct = options.find((o) => o.toLowerCase() === q.correct.trim().toLowerCase());
    if (correct === undefined) throw new PracticeError(`question ${i}: correct is not an option`);
    if (!isText(q.explanation)) throw new PracticeError(`question ${i}: explanation missing`);
    const filled = sentence.replace("___", correct === "-" ? "" : correct);
    if (bannedNorm.has(normalize(sentence)) || bannedNorm.has(normalize(filled))) {
      throw new PracticeError(`question ${i}: copies the student's sentence`);
    }
    return { sentence, options, correct, explanation: q.explanation.trim() };
  });

  // Shuffle on the server. If the correct answer lands in the same position
  // in all 3 questions, shuffle again (it should not look like a pattern).
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const q of questions) q.options = shuffle(q.options);
    const positions = new Set(questions.map((q) => q.options.indexOf(q.correct)));
    if (positions.size > 1) break;
  }
  return questions;
}

function parseJson(text) {
  const jsonText = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(jsonText);
  } catch (_) {
    throw new PracticeError("JSON parse error");
  }
}

// Structured output for generation as well: without it, about 1 in 5 sets
// came back as broken JSON or with 4 questions (practice-check, 9 Oct 2026).
// The server still validates everything below.
const PRACTICE_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentence: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct: { type: "string" },
          explanation: { type: "string" },
        },
        required: ["sentence", "options", "correct", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

async function callOnce({ category, errors, topic }) {
  const started = Date.now();
  const stream = anthropic.messages.stream({
    model: PRACTICE_MODEL,
    ...PRACTICE_SETTINGS,
    output_config: { ...PRACTICE_SETTINGS.output_config, format: { type: "json_schema", schema: PRACTICE_SCHEMA } },
    system: [{ type: "text", text: PRACTICE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          `ERROR CATEGORY: ${category}\n\n` +
          `THE STUDENT'S MISTAKES (original → corrected):\n` +
          errors.map((e) => `- ${e.original} → ${e.corrected}`).join("\n") +
          `\n\nESSAY TOPIC: ${topic}`,
      },
    ],
  });
  const message = await stream.finalMessage();
  const meta = { ms: Date.now() - started, usage: message.usage, stopReason: message.stop_reason };
  if (message.stop_reason === "refusal") throw Object.assign(new PracticeError("refusal"), { meta });
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) throw Object.assign(new PracticeError("no text block"), { meta });
  try {
    const banned = errors.flatMap((e) => [e.original, e.corrected]);
    return { questions: validateQuestions(parseJson(textBlock.text), banned), meta };
  } catch (err) {
    err.meta = meta;
    throw err;
  }
}

// Solver check: a second, independent call answers the questions WITHOUT
// seeing the intended answers. If it finds a gap ambiguous, or picks a
// different option, the set is not reliable enough for a student.
const SOLVER_SYSTEM = `You check English grammar practice questions. Each question is a sentence with one gap (___) and a list of options.

For each question, return the single correct option text. If more than one option is acceptable in standard English, return AMBIGUOUS.

Output only JSON, no markdown: {"answers": ["...", "...", "..."]}`;

// Structured output: with thinking off, the solver sometimes reasoned in
// plain text instead of answering in JSON; the schema makes the API return
// only {"answers": [...]}.
const SOLVER_SCHEMA = {
  type: "object",
  properties: { answers: { type: "array", items: { type: "string" } } },
  required: ["answers"],
  additionalProperties: false,
};

async function solverCheck(questions) {
  const started = Date.now();
  const stream = anthropic.messages.stream({
    model: PRACTICE_MODEL,
    ...PRACTICE_SETTINGS,
    max_tokens: 1000,
    output_config: { ...PRACTICE_SETTINGS.output_config, format: { type: "json_schema", schema: SOLVER_SCHEMA } },
    system: [{ type: "text", text: SOLVER_SYSTEM }],
    messages: [
      {
        role: "user",
        content: questions
          .map((q, i) => `${i + 1}. ${q.sentence}\nOptions: ${q.options.map((o) => JSON.stringify(o)).join(", ")}`)
          .join("\n\n"),
      },
    ],
  });
  const message = await stream.finalMessage();
  const meta = { ms: Date.now() - started, usage: message.usage, stopReason: message.stop_reason };
  const textBlock = message.content.find((b) => b.type === "text");
  let answers = null;
  try {
    const out = textBlock ? parseJson(textBlock.text) : null;
    if (out && Array.isArray(out.answers) && out.answers.length === questions.length) answers = out.answers;
  } catch (_) {}
  // raw: the solver's reply (generated sentences only, never essay text), kept
  // for scripts/practice-check.js; not written to the server log.
  if (!answers) return { pass: false, ambiguous: 0, mismatches: questions.length, unusable: true, raw: textBlock ? textBlock.text.slice(0, 400) : `(no text; stop ${message.stop_reason})`, meta };
  let ambiguous = 0;
  let mismatches = 0;
  answers.forEach((a, i) => {
    const t = String(a).trim();
    if (t.toUpperCase() === "AMBIGUOUS") ambiguous++;
    else if (t.toLowerCase() !== questions[i].correct.toLowerCase()) mismatches++;
  });
  return { pass: ambiguous === 0 && mismatches === 0, ambiguous, mismatches, answers, meta };
}

// Up to 2 generation attempts in total. An attempt fails on unusable output
// (validation) or on the solver check; then the whole set is regenerated.
// API errors are thrown as-is.
const MAX_GENERATIONS = 2;
async function makePractice({ category, errors, topic }) {
  const attempts = [];
  for (let i = 0; i < MAX_GENERATIONS; i++) {
    let questions;
    try {
      const out = await callOnce({ category, errors, topic });
      questions = out.questions;
      attempts.push(out.meta);
    } catch (err) {
      if (!(err instanceof PracticeError)) throw err;
      attempts.push({ ...(err.meta || {}), error: err.message });
      continue;
    }
    const check = await solverCheck(questions);
    // Content-free log line: how often the solver check fails, and why.
    console.log("practice solver:", JSON.stringify({
      category, attempt: i + 1, pass: check.pass, ambiguous: check.ambiguous,
      mismatches: check.mismatches, unusable: !!check.unusable, ms: check.meta.ms,
    }));
    attempts.push({ ...check.meta, solver: true, pass: check.pass, ambiguous: check.ambiguous, mismatches: check.mismatches, unusable: !!check.unusable, raw: check.raw, answers: check.answers });
    if (check.pass) return { questions, attempts };
    attempts[attempts.length - 2].error = "solver check failed";
  }
  const failure = new PracticeError(`practice failed after ${MAX_GENERATIONS} generations`);
  failure.attempts = attempts;
  throw failure;
}

// What the browser may see: never the correct answers or explanations
// before the student has answered.
function publicQuestions(questions) {
  return questions.map((q) => ({ sentence: q.sentence, options: q.options }));
}

// Checks answers against the stored questions.
function checkAnswers(questions, answers) {
  const results = questions.map((q, i) => {
    const chosen = answers[i];
    return { chosen, correct: q.correct, is_correct: chosen === q.correct, explanation: q.explanation };
  });
  return { results, score: results.filter((r) => r.is_correct).length };
}

module.exports = {
  PRACTICE_MODEL,
  PRACTICE_SYSTEM,
  CATEGORY_DISPLAY,
  PracticeError,
  pickCategory,
  validateQuestions,
  makePractice,
  solverCheck,
  SOLVER_SYSTEM,
  publicQuestions,
  checkAnswers,
};
