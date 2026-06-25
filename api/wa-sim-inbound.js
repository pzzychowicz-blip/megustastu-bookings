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
//   POST { phone, text, name?, agoMs? }
//   Authorization: Bearer <Firebase ID token>   (auth.currentUser.getIdToken())
//
// Mirrors ONE message of api/wa-inbound's flow: store fast (processInbound with
// parse=null + one-time auto-ack), answer, then parse with Gemini AFTER the
// response (applyParse) so the draft lands via the client's onValue listener —
// exactly like production. Also routable under the local harness
// (scripts/wa-backend-dev.mjs) for DEV testing with a real DEV id token.

import { verifyStaffToken, getConversation, readOperatingHours } from "./_lib/rtdb.js";
import { processInbound, applyParse } from "./_lib/inbound-core.js";
import { parseMessage, mockParse } from "./_lib/gemini.js";
import { normalizePhone } from "../src/lib/whatsapp.js";

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
  } catch (e) { /* no Vercel context — local harness */ }
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
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }

  // ── Staff auth (NOT Meta HMAC — the sim is staff-only) ──────────────────────
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) { res.status(401).json({ error: "missing token" }); return; }
  try {
    await verifyStaffToken(idToken);
  } catch (e) {
    res.status(401).json({ error: "invalid token" });
    return;
  }

  const body = await readJsonBody(req);
  const phone = body && body.phone;
  const text = body && typeof body.text === "string" ? body.text : "";
  if (!phone || !text.trim()) { res.status(400).json({ error: "phone and text are required" }); return; }
  const agoMs = Number(body.agoMs) || 0;
  const ts = Date.now() - agoMs;

  try {
    // Draft-aware parse context: a PENDING draft becomes the merge base so a
    // follow-up message updates it (mirrors api/wa-inbound's getConversation).
    const conv = await getConversation(normalizePhone(phone));
    const existingDraft = conv && conv.draftStatus === "parsed" ? conv.draftData : null;
    const r = await processInbound({
      phone, text, ts,
      wamid: "sim." + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      profileName: (body && body.name) || null,
      parse: null,                       // Gemini runs in phase B, after the response
      langHint: mockParse(text).language, // free regex lang for the auto-ack
      preloadedConv: conv,
    });

    // Phase B: live Gemini parse → draft patch, after the response. The client
    // sees the draft appear through its normal onValue listener.
    scheduleAfterResponse((async () => {
      const hours = await readOperatingHours();
      const parse = await parseMessage(text, { hours, existingDraft });
      await applyParse(r.phoneKey, parse, ts);
    })());

    res.status(200).json({ ok: true, phoneKey: r.phoneKey, skipped: r.skipped });
  } catch (e) {
    console.error("[wa-sim-inbound] failed:", e && e.message);
    res.status(500).json({ error: "internal error: " + (e && e.message) });
  }
}
