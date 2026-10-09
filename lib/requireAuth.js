const supabase = require("./supabase");

async function requireAuth(req, res, next) {
  // Several routers are mounted on /api and each runs requireAuth, so a single
  // request can pass through here several times (up to 6x for /api/grade).
  // req.user is only ever set below, after Supabase verified this request's
  // token - so verify once and skip the repeat network round trips.
  if (req.user && req.accessToken) return next();

  if (!supabase) {
    return res.status(500).json({ error: "Supabase konfiqurasiyası tapılmadı." });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Giriş tələb olunur." });
  }

  const token = authHeader.split(" ")[1];

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Etibarsız və ya vaxtı keçmiş token." });
  }

  req.user = user;
  req.accessToken = token;
  next();
}

module.exports = requireAuth;
