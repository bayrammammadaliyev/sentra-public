const { createClient } = require("@supabase/supabase-js");

// Request-scoped Supabase client carrying the student's JWT, so Row Level
// Security decides what it may read and write (same idiom as the teacher
// app's routes). Anon key only; never a service-role key.
function userClient(token) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

module.exports = userClient;
