require("dotenv").config();

// e-meyar student version. Hardening copied from the teacher app's server.js
// (0418ad2); no canonical-host redirects yet (no domain).

const express = require("express");
const path = require("path");
const authRoute = require("./routes/auth");
const gradeRoute = require("./routes/grade");
const coachingRoute = require("./routes/coaching");
const practiceRoute = require("./routes/practice");
const meRoute = require("./routes/me");
// Copied unchanged from the teacher app (photos are never stored). Its
// router runs requireAuth for every /api path that reaches it, so it is
// mounted last: unknown /api paths then answer 401 instead of 404.
const transcribeRoute = require("./routes/transcribe");
const { countWords } = require("./lib/grade");
const { TOPICS, MAX_TOPIC_CHARS, MAX_ESSAY_CHARS } = require("./lib/topics");
const { CATEGORY_DISPLAY } = require("./lib/practice");

const app = express();

// Railway terminates TLS at its edge proxy. Trust exactly one hop so
// express-rate-limit / req.ip see the real client IP from X-Forwarded-For,
// without allowing clients to spoof the header (which `true` would permit).
app.set("trust proxy", 1);

// No CORS middleware: the pages and the API are always served from the same
// origin (production, staging and localhost alike), so browsers need no CORS
// headers, and without them other websites cannot read API responses.

// Baseline security headers. No Content-Security-Policy yet - every page uses
// inline <script>, so a CSP would need nonces or hashes on all of them first.
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // req.secure honours X-Forwarded-Proto via "trust proxy" above; browsers
  // ignore HSTS over plain http anyway, so localhost is unaffected.
  if (req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
  }
  next();
});

app.use(express.json());

// Serve the public splash page at the root URL.
// Placed BEFORE express.static so it takes precedence over any default index.html resolution.
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "splash.html"));
});

// Shared with the page, generated from the server's own code so the two can
// never drift: the word counter is the grader's countWords() itself, and the
// topic cards are lib/topics.js.
const SHARED_JS =
  `window.countWords = ${countWords.toString()};\n` +
  `window.TOPICS = ${JSON.stringify(TOPICS)};\n` +
  `window.MAX_TOPIC_CHARS = ${MAX_TOPIC_CHARS};\n` +
  `window.MAX_ESSAY_CHARS = ${MAX_ESSAY_CHARS};\n` +
  `window.CATEGORY_DISPLAY = ${JSON.stringify(CATEGORY_DISPLAY)};\n`;
app.get("/lib/shared.js", (_req, res) => {
  res.type("application/javascript").set("Cache-Control", "no-cache").send(SHARED_JS);
});

app.use(express.static(path.join(__dirname, "public")));

// The commit Railway deployed (set for GitHub-triggered deploys), so one look
// at /api/health shows WHICH version is live. "unknown" locally.
const LIVE_COMMIT = (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || "unknown";

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", commit: LIVE_COMMIT });
});

app.use("/api/auth", authRoute);
app.use("/api", gradeRoute);
app.use("/api", coachingRoute);
app.use("/api", practiceRoute);
app.use("/api", meRoute);
app.use("/api", transcribeRoute);

// Unknown API paths answer in the { error } shape, not Express's HTML page.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Tapılmadı." });
});

// Last-resort error handler (Express 5 also routes rejected async handlers
// here). Logs the details server-side and answers with the { error } shape
// the frontend expects - never a stack trace or file path. Also set
// NODE_ENV=production on Railway so Express itself never renders one.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error("Unhandled error:", err);
  const messages = {
    400: "Sorğu düzgün formatda deyil.",
    404: "Tapılmadı.",
    413: "Sorğu çox böyükdür.",
  };
  res
    .status(status)
    .json({ error: messages[status] || "Serverdə gözlənilməz xəta baş verdi." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
