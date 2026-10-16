// api/_lib/request.js
//
// v18.9.0 (/code-review) — what a staff endpoint reads off a request, written
// once. `readJsonBody` was a private copy in six handlers (two spellings of
// one function) and the bearer parse a copy in eight, so a change to either (a
// size cap, a new error case) would have landed in one copy and not the rest:
// the shape `staffAuthError` (rtdb.js) was extracted to end.
// tests/api-handlers.test.js fails a handler that writes either out again.

// readJsonBody(req) → the request's JSON body, or null when it has none or it
// does not parse. Vercel's helper may have parsed it already (a string or an
// object); the local harness (scripts/wa-backend-dev.mjs) hands over the stream.
export function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve(null); } }
    return Promise.resolve(req.body);
  }
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

// bearerToken(req) → the Firebase ID token in `Authorization: Bearer <token>`,
// or null (no header, another scheme). What it proves is verifyStaffToken's
// question (rtdb.js), never this one's.
export function bearerToken(req) {
  const authHeader = req.headers["authorization"] || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}
