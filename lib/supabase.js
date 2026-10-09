const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "SUPABASE_URL or SUPABASE_ANON_KEY is missing. Auth will not work."
  );
}

// One shared anon client for the whole server. It must never hold a user's
// session: every signup/login of every student goes through it, so session
// storage and auto-refresh are switched off (the teacher app keeps the
// supabase-js defaults). Tokens are always passed in explicitly.
const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;

module.exports = supabase;
