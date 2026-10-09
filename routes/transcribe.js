const express = require("express");
const multer = require("multer");
const router = express.Router();
const requireAuth = require("../lib/requireAuth");
const anthropic = require("../lib/anthropic");
const { transcribeLimiter } = require("../lib/rateLimit");
const { anthropicErrorResponse, logAnthropicError } = require("../lib/anthropicError");

// The page redraws every photo as a JPEG of at most 2576 px before uploading
// it (usually well under 2 MB), so these limits only catch old cached pages.
const MAX_SIZE = 10 * 1024 * 1024;
// The API's 10 MB image limit counts the base64 text, which is 4/3 of the
// file - so the real file limit is about 7.5 MB.
const API_MAX_BASE64 = 10 * 1024 * 1024;
const TOO_BIG = "Şəkil çox böyükdür. Səhifəni yeniləyib şəkli yenidən seçin.";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

// The file's first bytes decide its type - not its name or the type the
// browser declares. HEIC is recognised only to explain the rejection: the
// API cannot read it.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function detectImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 12 && buf.toString("latin1", 4, 8) === "ftyp" &&
      /^(heic|heix|heim|heis|hevc|hevx|hevm|hevs|mif1|mif2|msf1)$/.test(buf.toString("latin1", 8, 12))) return "heic";
  return null;
}

const TRANSCRIPTION_PROMPT = `You are transcribing a student's handwritten English essay for a teacher in Azerbaijan. Your task is to read the handwriting and output ONLY the transcribed text — no commentary, no notes, no explanations, no markdown.

Rules:
- Preserve every word exactly as written, including student grammar errors and misspellings. Do NOT correct anything.
- If you cannot read a word confidently, use [?] in place of that word.
- Preserve paragraph breaks if visible in the handwriting.
- Do not add greetings, titles, or any text that isn't in the image.
- If the image contains no visible handwriting or is not an essay, return exactly the text: NO_ESSAY_FOUND
- If more than 30% of words are unreadable, at the end of the transcription add a new line with exactly: LOW_CONFIDENCE

Output only the transcribed essay text.`;

router.use(requireAuth);

router.post("/transcribe", transcribeLimiter, async (req, res) => {
  // Run multer as middleware inside the handler so we can catch its errors.
  upload.single("image")(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: TOO_BIG });
      }
      console.error("Upload error:", uploadErr.code || uploadErr.message);
      return res
        .status(400)
        .json({ error: "Şəkil düzgün göndərilmədi. Yenidən cəhd edin." });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ error: "Şəkil faylı göndərilməyib." });
    }

    const mediaType = detectImageType(req.file.buffer);
    if (mediaType === "heic") {
      return res.status(415).json({
        error: "HEIC formatı dəstəklənmir. Şəkli JPEG kimi saxlayıb yenidən yükləyin.",
      });
    }
    if (!mediaType) {
      return res
        .status(415)
        .json({ error: "Yalnız JPEG, PNG və ya WebP şəkil yükləyin." });
    }
    const base64Data = req.file.buffer.toString("base64");
    if (base64Data.length > API_MAX_BASE64) {
      return res.status(413).json({ error: TOO_BIG });
    }

    try {
      // Sonnet 5 reads images at up to 2576 px on the long edge (Sonnet 4.6:
      // 1568 px) - about 2.7x the pixels, which matters for handwriting. It
      // rejects temperature and thinks by default; thinking is off because
      // transcription needs none. max_tokens leaves room for its ~30% larger
      // tokenizer.
      const message = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 3000,
        thinking: { type: "disabled" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: TRANSCRIPTION_PROMPT,
              },
            ],
          },
        ],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock) {
        return res
          .status(500)
          .json({ error: "API cavabında mətn tapılmadı." });
      }

      let text = textBlock.text.trim();

      // Check for no-essay marker
      if (text === "NO_ESSAY_FOUND") {
        return res.status(422).json({
          error: "Şəkildə esse tapılmadı. Başqa şəkil yükləyin.",
        });
      }

      // Determine confidence
      let confidence = "high";

      // Check for LOW_CONFIDENCE marker at the end
      if (text.endsWith("LOW_CONFIDENCE")) {
        confidence = "low";
        text = text.replace(/\n?LOW_CONFIDENCE\s*$/, "").trim();
      }

      // Count [?] tokens — if more than 5, at least "medium"
      const unknownCount = (text.match(/\[\?\]/g) || []).length;
      if (unknownCount > 5 && confidence === "high") {
        confidence = "medium";
      }

      res.json({ transcription: text, confidence });
    } catch (err) {
      logAnthropicError("Transcription error:", err);
      const { status, error } = anthropicErrorResponse(
        err,
        "Şəkli oxumaq alınmadı. Yenidən cəhd edin və ya mətni əl ilə yazın."
      );
      res.status(status).json({ error });
    }
  });
});

module.exports = router;
