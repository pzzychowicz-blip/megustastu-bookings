// api/wa-sim-suggest.js
//
// WhatsApp backend — SANDBOX "✨ Suggest reply" (online). Gemini plays the
// CUSTOMER and writes their next message for the Sim panel's "Reply as customer"
// box. The online counterpart of the local harness's /dev/customer-reply route;
// like api/wa-sim-inbound it is gated by a STAFF Firebase ID token (not Meta
// HMAC), so the Gemini key stays server-side and there is no public exposure.
//
//   POST { language: "es"|"en", history: [{ direction:"in"|"out", text }, …] }
//   Authorization: Bearer <Firebase ID token>
//   → { text }   the customer's suggested next message
//
// Shares generateCustomerReply with the harness (api/_lib/gemini.js) — one
// source of truth for the prompt + Gemini call.

import { verifyStaffToken } from "./_lib/rtdb.js";
import { generateCustomerReply } from "./_lib/gemini.js";

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

  // ── Staff auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) { res.status(401).json({ error: "missing token" }); return; }
  try {
    await verifyStaffToken(idToken);
  } catch (e) {
    if (e && e.code === "NO_SERVICE_ACCOUNT") { res.status(503).json({ error: e.message }); return; }
    res.status(401).json({ error: "invalid token" });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || !Array.isArray(body.history)) { res.status(400).json({ error: "history[] required" }); return; }
  try {
    const text = await generateCustomerReply(body.history, body.language);
    res.status(200).json({ text });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.name === "AbortError" ? "Gemini timeout" : e.message });
  }
}
