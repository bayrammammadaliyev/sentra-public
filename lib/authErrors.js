// Supabase Auth (GoTrue) errors → plain Azerbaijani for students.
// Adapted from the teacher app's lib/authErrors.js (0418ad2): no invite-code
// hook messages; adds unconfirmed email (confirmation is ON here) and the
// session-refresh errors.
// Mapped by Supabase's error CODE, never by its English text: that text is
// only logged, never sent to the page. Code list:
// https://supabase.com/docs/guides/auth/debugging/error-codes

// Supabase → Authentication → Sign In / Providers → Email (checked 6 Oct 2026):
// minimum password length 8, no required character types — the same 8 our
// pages and routes check. Supabase's own message carries the number, so it is
// read from there first in case the setting changes.
const MIN_PASSWORD_LENGTH = 8;

const SAME_PASSWORD = "Yeni şifrə köhnə şifrədən fərqli olmalıdır.";
const WEAK_PASSWORD_OTHER = "Bu şifrə kifayət qədər güclü deyil. Başqa şifrə seçin.";
const LINK_EXPIRED = "Bərpa keçidi etibarsız və ya vaxtı keçmişdir. Yeni keçid tələb edin.";
const UPDATE_FAILED = "Şifrəni yeniləmək alınmadı. Bir az sonra yenidən cəhd edin.";
const INVALID_CREDENTIALS = "E-poçt və ya şifrə yanlışdır.";
const ACCOUNT_EXISTS = "Bu e-poçt ilə hesab artıq mövcuddur. Daxil olun və ya şifrəni bərpa edin.";
const EMAIL_INVALID = "E-poçt ünvanını düzgün yazın.";
const TOO_MANY_ATTEMPTS = "Çox sayda cəhd edildi. Bir neçə dəqiqə sonra yenidən cəhd edin.";
const LOGIN_FAILED = "Daxil olmaq alınmadı. Bir az sonra yenidən cəhd edin.";
const SIGNUP_FAILED = "Qeydiyyat alınmadı. Bir az sonra yenidən cəhd edin.";

const EMAIL_NOT_CONFIRMED =
  "E-poçtunuz hələ təsdiqlənməyib. Gələnlər qutunuzdakı (və spam qovluğundakı) təsdiq keçidini klikləyin.";
// Supabase's email sender is over its hourly limit (the built-in sender
// allows very few emails per hour): not the student's fault.
const EMAIL_SEND_LIMIT =
  "Hazırda təsdiq e-poçtu göndərmək mümkün olmadı. Bir az sonra yenidən cəhd edin.";
const SESSION_EXPIRED = "Sessiyanın vaxtı bitib. Yenidən daxil olun.";
const REFRESH_FAILED = "Sessiyanı yeniləmək alınmadı. Bir az sonra yenidən cəhd edin.";

// Problems with the recovery link itself: the student needs a new email.
const LINK_CODES = new Set([
  "bad_jwt",
  "session_expired",
  "session_not_found",
  "no_authorization",
  "user_not_found",
  "reauthentication_needed",
]);

function passwordLengthMessage(n) {
  return `Şifrə ən azı ${n} simvol olmalıdır.`;
}

// weak_password: the length rule when that's the reason, else a general line.
function weakPasswordMessage(err) {
  const reasons = Array.isArray(err.reasons) ? err.reasons : [];
  if (reasons.length && !reasons.includes("length")) return WEAK_PASSWORD_OTHER;
  const m = /at least (\d+) character/i.exec(err.message || "");
  return passwordLengthMessage(m ? Number(m[1]) : MIN_PASSWORD_LENGTH);
}

// A raw GoTrue error answer → { status, code, message, reasons }. Our direct
// fetch sends no API-version header, so the body is
// { code: <http status>, error_code, msg }; the newer format is
// { code: "<error_code>", message }. The code is also in x-sb-error-code.
async function readGoTrueError(resp) {
  let body = {};
  try {
    body = await resp.json();
  } catch (_) {}
  return {
    status: resp.status,
    code:
      body.error_code ||
      (typeof body.code === "string" ? body.code : "") ||
      resp.headers.get("x-sb-error-code") ||
      "",
    message: body.msg || body.message || "",
    reasons: body.weak_password && body.weak_password.reasons,
  };
}

function isRateLimit(err) {
  return (
    err.code === "over_request_rate_limit" ||
    err.code === "over_email_send_rate_limit" ||
    err.status === 429
  );
}

// Recovery-link password change → { status, code?, error }. `code` is only
// set when the link still works, so the page can let the student retry.
function updatePasswordError(err) {
  if (err.code === "same_password") {
    return { status: 422, code: "same_password", error: SAME_PASSWORD };
  }
  if (err.code === "weak_password") {
    return { status: 422, code: "weak_password", error: weakPasswordMessage(err) };
  }
  if (LINK_CODES.has(err.code) || (!err.code && (err.status === 401 || err.status === 403))) {
    return { status: 400, error: LINK_EXPIRED };
  }
  if (isRateLimit(err)) return { status: 429, error: TOO_MANY_ATTEMPTS };
  return { status: 400, error: UPDATE_FAILED };
}

// Login → { status, error, fallback? }. Supabase answers invalid_credentials both for an
// unknown email and a wrong password, so this says no more than before about
// whether an account exists; other codes get the general line.
function loginError(err) {
  if (err.code === "invalid_credentials") return { status: 400, error: INVALID_CREDENTIALS };
  if (err.code === "email_not_confirmed") return { status: 400, error: EMAIL_NOT_CONFIRMED };
  if (isRateLimit(err)) return { status: 429, error: TOO_MANY_ATTEMPTS };
  return { status: 400, error: LOGIN_FAILED, fallback: true };
}

// Signup → { status, error, fallback? }. `fallback` = no specific mapping.
function signupError(err) {
  if (err.code === "weak_password") return { status: 422, error: weakPasswordMessage(err) };
  if (err.code === "over_email_send_rate_limit") return { status: 429, error: EMAIL_SEND_LIMIT };
  if (err.code === "user_already_exists" || err.code === "email_exists") {
    return { status: 400, error: ACCOUNT_EXISTS };
  }
  if (err.code === "validation_failed" || err.code === "email_address_invalid") {
    return { status: 400, error: EMAIL_INVALID };
  }
  if (isRateLimit(err)) return { status: 429, error: TOO_MANY_ATTEMPTS };
  return { status: 400, error: SIGNUP_FAILED, fallback: true };
}

// Refresh-token exchange → { status, error, fallback? }. Any refusal of the
// token itself (4xx: used, revoked, unknown or malformed - Supabase answers
// a malformed one with 400 validation_failed) means "log in again" (401):
// retrying can't help. Rate limits and server/network trouble are temporary,
// so the page keeps the student logged in and can retry.
function refreshError(err) {
  if (isRateLimit(err)) return { status: 429, error: TOO_MANY_ATTEMPTS };
  if (err.status >= 400 && err.status < 500) {
    // Known "session over" codes are expected; log only unusual ones.
    const known = [
      "refresh_token_not_found",
      "refresh_token_already_used",
      "session_not_found",
      "session_expired",
      "user_not_found",
      "bad_jwt",
      "validation_failed",
    ].includes(err.code);
    return { status: 401, error: SESSION_EXPIRED, fallback: !known };
  }
  return { status: 503, error: REFRESH_FAILED, fallback: true };
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  LINK_EXPIRED,
  UPDATE_FAILED,
  passwordLengthMessage,
  weakPasswordMessage,
  readGoTrueError,
  updatePasswordError,
  loginError,
  signupError,
  refreshError,
  SESSION_EXPIRED,
};
