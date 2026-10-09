// Log a Supabase/PostgREST error without its `details` field. For constraint
// violations Postgres puts the whole failing row there ("Failing row contains
// (...)"), which would copy student names or essay text into the server logs -
// and logs have no RLS, no per-student deletion, and a retention period we
// don't control.
function logDbError(label, err) {
  console.error(label, err ? { code: err.code, message: err.message, hint: err.hint } : err);
}

module.exports = logDbError;
