// router.param() callback for ids in the address. Every id is a UUID, so a
// malformed one (e.g. a link cut short when pasted into WhatsApp) can never
// match: answer 404 with a plain Azerbaijani message right away, instead of
// asking the database, which replies with an English
// "invalid input syntax for type uuid" that the page would show.
// router.use(requireAuth) runs before param callbacks, so 401 stays 401.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(notFoundMessage) {
  return (req, res, next, value) => {
    if (UUID_RE.test(String(value))) return next();
    res.status(404).json({ error: notFoundMessage });
  };
}

module.exports = uuidParam;
