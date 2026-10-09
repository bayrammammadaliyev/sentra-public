const express = require("express");
const router = express.Router();
const supabase = require("../lib/supabase");
const requireAuth = require("../lib/requireAuth");
const { loginLimiter, signupLimiter, forgotLimiter, refreshLimiter } = require("../lib/rateLimit");
const {
  MIN_PASSWORD_LENGTH,
  UPDATE_FAILED,
  passwordLengthMessage,
  readGoTrueError,
  updatePasswordError,
  loginError,
  signupError,
  refreshError,
  SESSION_EXPIRED,
} = require("../lib/authErrors");

// Adapted from the teacher app's routes/auth.js (0418ad2). Differences:
// - signup has no invite code, and email confirmation is ON, so it never
//   returns a session: the student confirms by email, then logs in;
// - login and refresh hand the page BOTH tokens, and POST /refresh swaps a
//   refresh token for a new pair, so students are not logged out every hour.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIRST_NAME = 60;
const SIGNUP_OK = {
  message:
    "Qeydiyyat qəbul edildi. E-poçtunuzu yoxlayın və təsdiq keçidini klikləyin, sonra daxil olun.",
};

// Only what the page needs from a GoTrue session; the page keeps both tokens.
function sessionOut(s) {
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
  };
}

router.post("/signup", signupLimiter, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase konfiqurasiyası tapılmadı." });
  }

  const { email, password, first_name } = req.body || {};
  const firstName = typeof first_name === "string" ? first_name.trim() : "";

  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    return res.status(400).json({ error: "E-poçt və şifrə daxil edilməlidir." });
  }
  if (!EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: "E-poçt ünvanını düzgün yazın." });
  }
  if (!firstName) {
    return res.status(400).json({ error: "Adınızı daxil edin." });
  }
  if (firstName.length > MAX_FIRST_NAME) {
    return res.status(400).json({ error: `Ad ən çoxu ${MAX_FIRST_NAME} simvol ola bilər.` });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: passwordLengthMessage(MIN_PASSWORD_LENGTH) });
  }

  // The confirmation email links back to the login page, which says the
  // email is confirmed. Without SITE_URL Supabase uses its own Site URL.
  const siteUrl = process.env.SITE_URL;
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { first_name: firstName },
      ...(siteUrl ? { emailRedirectTo: `${siteUrl}/login.html` } : {}),
    },
  });

  if (error) {
    // By Supabase's error code (lib/authErrors.js), never its English text.
    // Only status + code are logged (the text can contain the email).
    const out = signupError(error);
    if (out.fallback) {
      console.error("signup error:", error.status, error.code || "(no code)");
    }
    return res.status(out.status).json({ error: out.error });
  }

  // With confirmation ON there is never a session here. If one comes back,
  // confirmation was switched off in Supabase: still don't log in from here.
  if (data && data.session) {
    console.warn("signup returned a session: is email confirmation OFF in Supabase?");
  }

  // The same answer for a new and an already registered email (Supabase
  // also answers both alike while confirmation is on), so signup can't be
  // used to find out who has an account.
  res.json(SIGNUP_OK);
});

router.post("/login", loginLimiter, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase konfiqurasiyası tapılmadı." });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "E-poçt və şifrə daxil edilməlidir." });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // By Supabase's error code (lib/authErrors.js), never its English text.
    // Unmapped codes are logged with status + code only.
    const out = loginError(error);
    if (out.fallback) {
      console.error("login error:", error.status, error.code || "(no code)");
    }
    return res.status(out.status).json({ error: out.error });
  }

  res.json({
    session: sessionOut(data.session),
    user: {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.first_name || "",
    },
  });
});

// Swaps a refresh token for a new access + refresh token pair. Called by the
// page (public/lib/auth.js) once after a 401, before it gives up and logs the
// student out. Direct GoTrue call, like /logout: the shared supabase-js
// client must not hold anyone's session. Supabase rotates refresh tokens, so
// the page must store the NEW refresh token every time.
router.post("/refresh", refreshLimiter, async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: "Supabase konfiqurasiyası tapılmadı." });
  }

  const { refresh_token } = req.body || {};
  if (typeof refresh_token !== "string" || !refresh_token || refresh_token.length > 2000) {
    return res.status(401).json({ error: SESSION_EXPIRED });
  }

  let resp;
  try {
    resp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token }),
    });
  } catch (err) {
    console.error("refresh request error:", err && err.message);
    return res.status(503).json({ error: refreshError({ status: 503 }).error });
  }

  if (!resp.ok) {
    const err = await readGoTrueError(resp);
    const out = refreshError(err);
    if (out.fallback) console.error("refresh GoTrue error:", err.status, err.code || "(no code)");
    return res.status(out.status).json({ error: out.error });
  }

  let body;
  try {
    body = await resp.json();
  } catch (_) {
    body = null;
  }
  if (!body || !body.access_token || !body.refresh_token) {
    console.error("refresh: unexpected GoTrue answer");
    return res.status(503).json({ error: refreshError({ status: 503 }).error });
  }
  res.json({ session: sessionOut(body) });
});

router.post("/logout", requireAuth, async (req, res) => {
  // Revoke the user's refresh token across all devices by calling the
  // Supabase auth endpoint directly with the user's own access token.
  // This is byte-identical to what supabase-js emits for
  // signOut({ scope: 'global' }) and requires no service-role key.
  //
  // Known ceiling: this revokes the refresh token (no new access tokens
  // can be minted) but the already-issued access JWT remains valid until
  // its natural expiry (~1h). Killing the access token server-side would
  // require a service-role key, which this design intentionally avoids.
  try {
    const accessToken = req.accessToken;
    if (accessToken) {
      const resp = await fetch(
        `${process.env.SUPABASE_URL}/auth/v1/logout?scope=global`,
        {
          method: "POST",
          headers: {
            apikey: process.env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      if (!resp.ok) {
        console.error(
          "Logout revocation failed:",
          resp.status,
          await resp.text().catch(() => "")
        );
      }
    }
  } catch (err) {
    console.error("Logout revocation error:", err);
  }

  res.json({ message: "Uğurla çıxış edildi." });
});

// Returns the currently authenticated user (decoded from the Bearer token).
// Used by the redesigned dashboard / sidebar to populate the user widget.
router.get("/me", requireAuth, (req, res) => {
  const u = req.user || {};
  res.json({
    id: u.id,
    email: u.email,
    name: u.user_metadata?.first_name || u.user_metadata?.name || "",
    user_metadata: u.user_metadata || {},
  });
});

// Sends a password-recovery email via Supabase's built-in mailer. The recovery
// link points at <SITE_URL>/reset-password.html, where the user sets a new
// password (handled by /update-password below).
//
// PRIVACY: this endpoint always returns the same 200 success body — whether or
// not the email belongs to a real account, and even if Supabase errors on
// "user not found". This prevents account-existence enumeration. Genuine input
// errors (missing/invalid email) and rate limiting are the only non-200s.
const FORGOT_OK = {
  message:
    "Əgər bu e-poçt qeydiyyatdadırsa, bərpa keçidi göndərildi.",
};

router.post("/forgot-password", forgotLimiter, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase konfiqurasiyası tapılmadı." });
  }

  const { email } = req.body || {};
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: "Düzgün e-poçt ünvanı daxil edin." });
  }

  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    // Fail safe: never block the user nor leak config state. Without SITE_URL
    // the recovery link cannot be built, so we skip the send and still return
    // the uniform success. SITE_URL must be set on Railway.
    console.error(
      "forgot-password: SITE_URL is unset — skipping recovery email send."
    );
    return res.json(FORGOT_OK);
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${siteUrl}/reset-password.html`,
  });

  if (error) {
    // Log for ops but DO NOT surface to the client (would leak existence/state).
    console.error("forgot-password resetPasswordForEmail error:", error.message);
  }

  res.json(FORGOT_OK);
});

// Sets a new password using the recovery access token from the email link.
// The token is itself a valid Supabase session, so we scope a one-off client to
// it (same per-token-client idiom as the stats routes) and call updateUser.
router.post("/update-password", async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: "Supabase konfiqurasiyası tapılmadı." });
  }

  const { accessToken, password } = req.body || {};

  if (typeof accessToken !== "string" || !accessToken) {
    return res
      .status(400)
      .json({ error: "Bərpa keçidi etibarsızdır. Yeni keçid tələb edin." });
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ error: passwordLengthMessage(MIN_PASSWORD_LENGTH) });
  }

  // Apply the new password by calling the GoTrue user endpoint directly with the
  // recovery token as the bearer — the same direct-fetch style as /logout above.
  // supabase-js auth.updateUser() can't be used here: it reads an in-memory
  // session (which we don't have) and throws AuthSessionMissingError before any
  // network call, ignoring the token. The recovery JWT authorizes this PUT on
  // its own, no prior setSession required.
  let resp;
  try {
    resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
  } catch (err) {
    // Supabase didn't answer: not the link's fault, so don't say it expired.
    console.error("update-password request error:", err);
    return res.status(502).json({ error: UPDATE_FAILED });
  }

  if (!resp.ok) {
    // Map by Supabase's error code (lib/authErrors.js). The real error is
    // logged for diagnosis; its English text never reaches the page.
    const err = await readGoTrueError(resp);
    console.error("update-password GoTrue error:", err.status, err.code, err.message);
    const out = updatePasswordError(err);
    return res.status(out.status).json(out.code ? { error: out.error, code: out.code } : { error: out.error });
  }

  res.json({ message: "Şifrə uğurla yeniləndi." });
});

module.exports = router;
