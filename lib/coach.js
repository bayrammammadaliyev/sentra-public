// Coaching for students: a SEPARATE call after grading that explains the
// scores and shows what would earn more points. It never changes the grade.
// Not golden-locked (unlike lib/grade.js): the prompt may be iterated here.
const anthropic = require("./anthropic");

const COACH_MODEL = "claude-sonnet-5-5";

// Sonnet 5.5 can't take thinking {type: "disabled"} (400). between_tools is
// its "no thinking" mode, accepted at effort high or below. The teacher repo's
// golden runner tried it at high and medium (29 Sep 2026): same mean latency
// (10.0 s both), medium used fewer output tokens, so medium.
const COACH_SETTINGS = {
  max_tokens: 4000,
  thinking: { type: "between_tools" },
  output_config: { effort: "medium" },
};

const COACH_SYSTEM = `You are a writing coach for Azerbaijani 11th-grade students preparing for the DİM 2027 English exam, Task 26: an opinion paragraph of at least 100 words.

You receive the topic, the student's essay and the OFFICIAL GRADING RESULT. The grading is final. You never change, question, re-score or contradict it. Your job: explain why the student got these scores, and what would earn more points next time.

THE RUBRIC (for explanations only, never re-grade):
- A (max 1): on topic; at least 100 words (70–99 words caps A at 0.5); one paragraph with a topic sentence, supporting ideas and a concluding sentence. Copying the prompt or using memorized template sentences loses A.
- B (max 2): at least two clear arguments, each supported by an example or explanation; BOTH sides of the argument; linking words; logical order without digressions. Missing any one of these drops B to 1. Showing only one side is the most common reason.
- C (max 1): grammar VARIETY, simple AND complex sentences (relative clauses, conditionals, subordinate clauses). Small errors are fine if the meaning stays clear. Mostly simple sentences caps C at 0.5 even with no errors.
- D (max 1): varied, topic-appropriate vocabulary; no repetition of the same words; paraphrase and synonyms.
Students usually don't know C and D reward variety, not only correctness. Tell them when it applies.

LANGUAGE: All explanations in Azerbaijani, addressing the student politely as "siz" (siz-forms throughout, never sən), plain and warm, no empty praise. Anything quoted from the essay or written in English for the essay stays in English. Write natural, grammatically correct Azerbaijani as an Azerbaijani teacher would. Refer to the student's essay as "esseniz" (e.g. "Esseniz mövzuya uyğundur").
Word choices: always the "-niz" forms for the essay ("esseniz", "essenizi", "essenizin", "essenizdə"), never "esseni" or "essenin"; points are "bal", never "xal"; a verb is "feil" (plural "feillər"), never "fel" or "fe'l". Follow Azerbaijani vowel harmony in suffixes (e.g. "A da", not "A də").

RULES:
1. For each criterion that lost points: explain specifically why, pointing to what is or isn't in THEIR essay. Then give ONE fix: copy ONE sentence exactly as it appears in their essay into "original", and write an improved version of only that sentence in "improved". Never more than one improved sentence per criterion. Never write a paragraph, a model essay, or a ready-made opening or closing sentence. Memorized template sentences score zero on this exam.
   - A, length problem: give the exact gap (e.g. "81 söz yazmısınız; A üzrə tam bal üçün ən azı 19 söz əlavə etməlisiniz" - use the WORD FACTS numbers) and where in the paragraph an idea could go. fix may be null.
   - B, one side missing: explain the pattern (own view, then the opposing view, then why they still hold their view) and use the fix to show how one of their sentences could introduce the other side.
   - C: take one simple sentence of theirs and show it as a complex sentence.
   - D: name the most repeated word or phrase in their essay and give 2–3 alternatives.
2. For each criterion at full score: one short sentence on what specifically they did well. fix: null.
3. Use only the errors listed in the grading result. Do not find new errors.
4. next_focus: the one change that would gain the most points next time (B is worth 2), in 1–2 sentences.
5. If total_zero_reason is set, every score is 0 for that one reason. Do not coach per criterion: set criteria to [], explain in zero_explanation what the reason means and exactly how to avoid it next time (2–3 sentences; for off_topic add one sentence about their language), and make next_focus the avoidance step.
6. Never calculate word counts yourself. Use only the WORD FACTS numbers. If the essay is under 70 words, state both: how many words avoid the zero score (to 70) and how many reach full marks for A (to 100).

OUTPUT: only this JSON, no markdown:
{
  "zero_explanation": null or "<Azerbaijani>",
  "criteria": [
    { "id": "A"|"B"|"C"|"D",
      "lost_points": true|false,
      "explanation": "<Azerbaijani, 1–3 sentences>",
      "fix": null or { "original": "<exact sentence from the essay>", "improved": "<one English sentence>", "why": "<Azerbaijani, 1 sentence>" },
      "repeated_word": null or { "word": "<English>", "count": 0, "alternatives": ["...", "..."] }
    }
  ],
  "next_focus": "<Azerbaijani, 1–2 sentences>"
}
repeated_word is used for D only; leave count as 0, the server counts it.`;

const IDS = ["A", "B", "C", "D"];
const MAX_IMPROVED_CHARS = 300;

class CoachingError extends Error {}

// Lowercase, one space between words, straight quotes: so a sentence the
// model copied still matches when only spacing, case or quote style differ.
function normalize(s) {
  return String(s)
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Whole-word (or whole-phrase) count, case-insensitive. "use" does not count
// inside "useful"; a phrase matches across any whitespace.
function countOccurrences(text, word) {
  const w = normalize(word);
  if (!w) return 0;
  const pattern = w
    .split(" ")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const re = new RegExp(`(?<![\\p{L}\\p{N}'])${pattern}(?![\\p{L}\\p{N}'])`, "giu");
  const matches = normalize(text).match(re);
  return matches ? matches.length : 0;
}

const isText = (v) => typeof v === "string" && v.trim().length > 0;

// Word gaps computed here from the grader's (server-counted) word_count, so
// the coach never does arithmetic (rule 6 of COACH_SYSTEM).
function wordFacts(grading) {
  const n = Number.isInteger(grading && grading.word_count) ? grading.word_count : 0;
  return (
    `word_count: ${n}\n` +
    `words_needed_to_reach_70: ${Math.max(0, 70 - n)}\n` +
    `words_needed_to_reach_100: ${Math.max(0, 100 - n)}`
  );
}

// Safety net for word choices the prompt asks for but the model sometimes
// misses: the essay is always "esseniz-", points are "bal", a verb is
// "feil". Explicit endings only, so other words are never touched (e.g.
// "xalq", "felyeton"). Azerbaijani text fields only, never the English quotes.
const WORDING_FIXES = [
  [/(?<!\p{L})([Ee])sseniniz(\p{L}*)/gu, "$1sseniz$2"], // esseninizdə/-in/-i -> essenizdə/-in/-i
  [/(?<!\p{L})([Ee])sseni(?!\p{L})/gu, "$1ssenizi"],
  [/(?<!\p{L})([Ee])ssenin(?!\p{L})/gu, "$1ssenizin"],
  [/(?<!\p{L})([Xx])al(ı|a|ın|dan|da|lar|ları|lara|ların)?(?!\p{L})/gu, (m, x, suf) => (x === "X" ? "B" : "b") + "al" + (suf || "")],
  [/(?<!\p{L})([Ff])e'?l(i|in|ə|dən|də|dəki|lər|ləri|lərin|lərə|lərdə|lərdəki)?(?!\p{L})/gu, (m, f, suf) => f + "eil" + (suf || "")],
];

function fixWording(text) {
  if (typeof text !== "string") return text;
  return WORDING_FIXES.reduce((t, [re, to]) => t.replace(re, to), text);
}

function fixCoachingWording(c) {
  c.zero_explanation = fixWording(c.zero_explanation);
  c.next_focus = fixWording(c.next_focus);
  for (const item of c.criteria || []) {
    item.explanation = fixWording(item.explanation);
    if (item.fix) item.fix.why = fixWording(item.fix.why);
  }
  return c;
}

// The grading JSON as the coach sees it: everything except "summary" (it is
// written for a teacher, and the coach must work from the scores).
function gradingForCoach(grading) {
  const { summary, ...rest } = grading || {};
  return rest;
}

// Checks and corrects the model's JSON in place (brief items a–e). Throws
// CoachingError when the shape is unusable, so the caller retries once.
function validateCoaching(c, grading, essay) {
  if (!c || typeof c !== "object" || Array.isArray(c)) throw new CoachingError("not an object");
  if (!isText(c.next_focus)) throw new CoachingError("next_focus missing");

  // d. Total zero: one explanation instead of per-criterion coaching.
  if (grading.total_zero_reason) {
    if (!isText(c.zero_explanation)) throw new CoachingError("zero_explanation missing");
    c.criteria = [];
    return fixCoachingWording(c);
  }
  c.zero_explanation = null;

  if (!Array.isArray(c.criteria)) throw new CoachingError("criteria not an array");
  const byId = {};
  for (const item of c.criteria) {
    if (!item || typeof item !== "object" || !IDS.includes(item.id) || byId[item.id]) {
      throw new CoachingError("bad or duplicate criterion");
    }
    byId[item.id] = item;
  }
  if (IDS.some((id) => !byId[id])) throw new CoachingError("criterion missing");

  const essayNorm = normalize(essay);
  c.criteria = IDS.map((id) => {
    const item = byId[id];
    const g = (grading.criteria || []).find((x) => x && x.id === id);
    if (!g) throw new CoachingError("grading criterion missing");
    if (!isText(item.explanation)) throw new CoachingError(`explanation missing for ${id}`);

    // a. Always from the grade, never from the model.
    item.lost_points = g.score < g.max;

    // b. The fix must quote the essay and stay one sentence long.
    const f = item.fix;
    if (
      !f || typeof f !== "object" ||
      !isText(f.original) || !isText(f.improved) ||
      !essayNorm.includes(normalize(f.original)) ||
      f.improved.length > MAX_IMPROVED_CHARS
    ) {
      item.fix = null;
    } else {
      item.fix = { original: f.original, improved: f.improved, why: isText(f.why) ? f.why : "" };
    }

    // c. The server counts the repeated word; D only.
    const rw = item.repeated_word;
    if (id !== "D" || !rw || typeof rw !== "object" || !isText(rw.word)) {
      item.repeated_word = null;
    } else {
      const count = countOccurrences(essay, rw.word);
      item.repeated_word = count === 0 ? null : {
        word: rw.word,
        count,
        alternatives: Array.isArray(rw.alternatives) ? rw.alternatives.filter(isText).slice(0, 3) : [],
      };
    }
    return item;
  });
  return fixCoachingWording(c);
}

// Same fence stripping as lib/grade.js.
function parseJson(text) {
  const jsonText = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(jsonText);
  } catch (_) {
    throw new CoachingError("JSON parse error");
  }
}

async function callOnce({ topic, essay, grading }) {
  const started = Date.now();
  const stream = anthropic.messages.stream({
    model: COACH_MODEL,
    ...COACH_SETTINGS,
    system: [{ type: "text", text: COACH_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          `TOPIC:\n${topic}\n\n` +
          `STUDENT ESSAY:\n${essay}\n\n` +
          `OFFICIAL GRADING RESULT:\n${JSON.stringify(gradingForCoach(grading), null, 2)}\n\n` +
          `WORD FACTS:\n${wordFacts(grading)}`,
      },
    ],
  });
  const message = await stream.finalMessage();
  const meta = { ms: Date.now() - started, usage: message.usage, stopReason: message.stop_reason };
  if (message.stop_reason === "refusal") throw Object.assign(new CoachingError("refusal"), { meta });
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) throw Object.assign(new CoachingError("no text block"), { meta });
  try {
    const coaching = validateCoaching(parseJson(textBlock.text), grading, essay);
    return { coaching, meta };
  } catch (err) {
    err.meta = meta;
    throw err;
  }
}

// One retry on unusable output (brief item e). API errors are thrown as-is.
// Returns { coaching, attempts: [{ ms, usage, stopReason, error? }] }.
async function coachEssay({ topic, essay, grading }) {
  const attempts = [];
  for (let i = 0; i < 2; i++) {
    try {
      const { coaching, meta } = await callOnce({ topic, essay, grading });
      attempts.push(meta);
      return { coaching, attempts };
    } catch (err) {
      if (!(err instanceof CoachingError)) throw err;
      attempts.push({ ...(err.meta || {}), error: err.message });
    }
  }
  const failure = new CoachingError("coaching failed twice");
  failure.attempts = attempts;
  throw failure;
}

module.exports = {
  coachEssay,
  CoachingError,
  COACH_MODEL,
  COACH_SETTINGS,
  COACH_SYSTEM,
  validateCoaching,
  countOccurrences,
  normalize,
  wordFacts,
  fixWording,
};
