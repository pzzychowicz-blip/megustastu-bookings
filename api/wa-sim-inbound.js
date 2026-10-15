// api/wa-sim-inbound.js
//
// WhatsApp backend — SANDBOX simulator inbound (online live-Gemini path).
//
// The DEPLOYED Sim panel posts here to drive the REAL inbound pipeline —
// including live Gemini parsing — WITHOUT a Meta webhook. Unlike api/wa-inbound
// (HMAC-gated for Meta, and unsigned only on the local harness via
// WA_ALLOW_UNSIGNED), this endpoint is gated by a STAFF Firebase ID token — the
// same trust the booking app already uses. So the public webhook stays closed
// and WA_ALLOW_UNSIGNED is NEVER needed on Vercel: only a signed-in staff member
// can inject a simulated message.
//
//   POST { phone, text, name?, agoMs?, media? }
//   POST { event, phone?, name?, text?, remove? }   (v18.9.0, coexistence)
//   Authorization: Bearer <Firebase ID token>   (auth.currentUser.getIdToken())
//
// v18.9.0: `event` is one of the WhatsApp Business app's coexistence events
// (a contact saved on the phone, a phone reply, a customer's edit or delete,
// the chat history, the connection going and coming back), built as Meta's
// webhook and stored by the real webhook's handlers: _lib/sim-events.js. A
// body with an `event` is never a customer message.
//
// v18.8.0 phase 6: `media` is "image", "audio" or "document" — a KIND, never an
// id. The server mints the MOCK id (src/lib/wa-mock-media.js), and `text` is
// the caption, so a photo or a voice note may come with none. An id taken from
// the request would go into a Graph path with the restaurant's token on it, the
// thing api/wa-media.js is built not to allow.
//
// Mirrors ONE message of api/wa-inbound's flow: store fast (processInbound with
// parse=null + one-time auto-ack), answer, then parse with Gemini AFTER the
// response (applyParse) so the draft lands via the client's onValue listener —
// exactly like production. Also routable under the local harness
// (scripts/wa-backend-dev.mjs) for DEV testing with a real DEV id token.

import { verifyStaffToken, staffAuthError } from "./_lib/rtdb.js";
import { simEnabled } from "./_lib/env.js";
import { injectSimInbound } from "./_lib/inbound-core.js";
import { SIM_MEDIA } from "../src/lib/wa-mock-media.js";
import { runSimEvent } from "./_lib/sim-events.js";

// Run `promise` after the response is sent (same hook as api/wa-inbound): on
// Vercel via the request-context waitUntil, on the local harness the long-lived
// process just keeps running it. The .catch keeps a parse failure from becoming
// an unhandled rejection.
function scheduleAfterResponse(promise) {
  promise.catch((e) => console.error("[wa-sim-inbound] post-response work failed:", e && e.message));
  try {
    const ctx = globalThis[Symbol.for("@vercel/request-context")];
    const waitUntil = ctx && ctx.get && ctx.get() && ctx.get().waitUntil;
    if (typeof waitUntil === "function") waitUntil(promise);
  } catch { /* no Vercel context — local harness */ }
}

function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve(null); } }
    return Promise.resolve(req.body);
  }
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

export default async function handler(req, res) {
  // v18.0.0 phase 5b — FIRST statement, fail-closed. See simEnabled() in
  // _lib/env.js for why it is first and why absent means off.
  if (!simEnabled()) { res.status(404).json({ error: "not found" }); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }

  // ── Staff auth (NOT Meta HMAC — the sim is staff-only) ──────────────────────
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) { res.status(401).json({ error: "missing token" }); return; }
  let decoded;
  try {
    decoded = await verifyStaffToken(idToken);
  } catch (e) {
    const f = staffAuthError(e);
    res.status(f.status).json({ error: f.error });
    return;
  }

  const body = await readJsonBody(req);
  if (body && body.event !== undefined) {
    try {
      const r = await runSimEvent(body, decoded);
      res.status(r.status).json(r.data);
    } catch (e) {
      console.error("[wa-sim-inbound] event failed:", e && e.message);
      res.status(500).json({ error: "internal error: " + (e && e.message) });
    }
    return;
  }
  const phone = body && body.phone;
  const text = body && typeof body.text === "string" ? body.text : "";
  const media = body && body.media != null ? body.media : null;
  if (media !== null && !(typeof media === "string" && Object.prototype.hasOwnProperty.call(SIM_MEDIA, media))) {
    res.status(400).json({ error: "media must be one of: " + Object.keys(SIM_MEDIA).join(", ") });
    return;
  }
  if (!phone || (!text.trim() && !media)) { res.status(400).json({ error: "phone and text (or media) are required" }); return; }
  const agoMs = Number(body.agoMs) || 0;

  try {
    const r = await injectSimInbound({ phone, text, name: body && body.name, agoMs, media }, scheduleAfterResponse);
    res.status(200).json({ ok: true, phoneKey: r.phoneKey, skipped: r.skipped });
  } catch (e) {
    console.error("[wa-sim-inbound] failed:", e && e.message);
    res.status(500).json({ error: "internal error: " + (e && e.message) });
  }
}
