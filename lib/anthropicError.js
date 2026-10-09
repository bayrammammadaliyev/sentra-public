// Turns an Anthropic API error into a status and an Azerbaijani message that
// is safe to show a teacher. The raw API error (request id, limits, the state
// of our account) goes to the server log only - it used to reach the page as
// JSON. Never answers 401: the pages treat 401 as "your login expired" and
// send the teacher to the login screen, but a 401 from the API means OUR key.
function anthropicErrorResponse(err, fallback) {
  const status = err && err.status;
  if (status === 401 || status === 403) {
    return { status: 503, error: "Xidmətdə texniki problem var. Bir az sonra yenidən cəhd edin." };
  }
  if (status === 429) {
    return { status: 429, error: "Hazırda sorğu çoxdur. Bir dəqiqə sonra yenidən cəhd edin." };
  }
  if (status >= 500) {
    return { status: 503, error: "AI xidməti hazırda məşğuldur. Bir az sonra yenidən cəhd edin." };
  }
  return { status: status === 400 ? 422 : 500, error: fallback };
}

// API errors carry no student text; anything else (a bug in our code) is
// logged with its stack.
function logAnthropicError(label, err) {
  if (!err || !err.status) return console.error(label, err);
  const body = err.error && err.error.error;
  console.error(label, {
    status: err.status,
    type: body && body.type,
    message: (body && body.message) || err.message,
    request_id: err.requestID,
  });
}

module.exports = { anthropicErrorResponse, logAnthropicError };
