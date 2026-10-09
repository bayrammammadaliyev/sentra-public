const { rateLimit } = require("express-rate-limit");

// NOTE: These limiters use express-rate-limit's default in-memory store. If
// Railway ever scales beyond a single replica, switch to a shared store
// (e.g. Redis via rate-limit-redis) so counts are consistent across instances.

// Copied from the teacher app (0418ad2). Auth values are the teacher app's,
// plus refresh. Grading and coaching have student limits (Sprint 2); the
// daily grading limit itself is in routes/grade.js (it is stored in the
// database, so it survives restarts).
const GRADE_WINDOW_MS = 60 * 60 * 1000;     // 60 min
const GRADE_MAX = 25;                        // 25 req / 60 min / USER (= the daily limit)

// One coaching per essay is stored; this only stops a failing essay from
// being retried without end (each retry is a paid API call).
const COACH_WINDOW_MS = 60 * 60 * 1000;     // 60 min
const COACH_MAX = 30;                        // 30 req / 60 min / USER

// Photo reading (routes/transcribe.js, copied from the teacher app): each
// read is a paid call. Students: 20 per hour (teachers: 60).
const TRANSCRIBE_WINDOW_MS = 60 * 60 * 1000; // 60 min
const TRANSCRIBE_MAX = 20;                   // 20 req / 60 min / USER

// Practice sets have their own daily cap (PRACTICE_DAILY_LIMIT, stored in
// the database); this only stops runaway retries of a failing one.
const PRACTICE_WINDOW_MS = 60 * 60 * 1000;  // 60 min
const PRACTICE_MAX = 30;                     // 30 req / 60 min / USER

const LOGIN_WINDOW_MS = 15 * 60 * 1000;      // 15 min
const LOGIN_MAX = 10;                        // 10 req / 15 min / IP

const SIGNUP_WINDOW_MS = 60 * 60 * 1000;     // 60 min
const SIGNUP_MAX = 5;                        // 5 req / 60 min / IP

const FORGOT_WINDOW_MS = 15 * 60 * 1000;     // 15 min
const FORGOT_MAX = 5;                        // 5 req / 15 min / IP

// A logged-in student refreshes about once an hour per device; several
// students can share one school IP, so this is generous.
const REFRESH_WINDOW_MS = 15 * 60 * 1000;    // 15 min
const REFRESH_MAX = 60;                      // 60 req / 15 min / IP

const TOO_MANY_MESSAGE =
  "Çox sayda sorğu göndərildi. Bir az gözləyib yenidən cəhd edin.";

// Match the existing error JSON shape used across routes: { error: "..." }.
function sendTooMany(req, res /* next, options */) {
  res.status(429).json({ error: TOO_MANY_MESSAGE });
}

// Normalize IPv6 to its /64 prefix so a single attacker cannot rotate through
// addresses inside their own subnet. IPv4 is returned unchanged.
function ipv6SafeIp(ip) {
  if (typeof ip !== "string" || !ip) return "unknown";
  if (!ip.includes(":")) return ip; // IPv4
  // Expand and take the first 4 hextets (the /64 prefix).
  const stripped = ip.replace(/^::ffff:/i, ""); // IPv4-mapped IPv6
  if (!stripped.includes(":")) return stripped;
  const parts = stripped.split(":");
  return parts.slice(0, 4).join(":") + "::/64";
}

// Per-user keying: uses req.user.id (set by lib/requireAuth.js). Falls back to
// IPv6-safe IP keying when req.user is not populated for any reason.
function userKeyGenerator(req /* res */) {
  if (req.user && req.user.id) {
    return "user:" + req.user.id;
  }
  return "ip:" + ipv6SafeIp(req.ip);
}

const gradeLimiter = rateLimit({
  windowMs: GRADE_WINDOW_MS,
  limit: GRADE_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  handler: sendTooMany,
});

const coachLimiter = rateLimit({
  windowMs: COACH_WINDOW_MS,
  limit: COACH_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  handler: sendTooMany,
});

const transcribeLimiter = rateLimit({
  windowMs: TRANSCRIBE_WINDOW_MS,
  limit: TRANSCRIBE_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  handler: sendTooMany,
});

const practiceLimiter = rateLimit({
  windowMs: PRACTICE_WINDOW_MS,
  limit: PRACTICE_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  handler: sendTooMany,
});

const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: sendTooMany,
});

const signupLimiter = rateLimit({
  windowMs: SIGNUP_WINDOW_MS,
  limit: SIGNUP_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: sendTooMany,
});

const forgotLimiter = rateLimit({
  windowMs: FORGOT_WINDOW_MS,
  limit: FORGOT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: sendTooMany,
});

const refreshLimiter = rateLimit({
  windowMs: REFRESH_WINDOW_MS,
  limit: REFRESH_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: sendTooMany,
});

module.exports = {
  gradeLimiter,
  coachLimiter,
  practiceLimiter,
  transcribeLimiter,
  loginLimiter,
  signupLimiter,
  forgotLimiter,
  refreshLimiter,
};
