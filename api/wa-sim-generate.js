// api/wa-sim-generate.js
//
// WhatsApp backend — SANDBOX "🎲 Generate scenario" (Gemini-invented variety).
// Staff-Firebase-token gated (like the other sim endpoints). For each requested
// scenario it asks Gemini to INVENT a realistic, varied customer message
// (generateScenarioMessage), then injects it as a fresh inbound (new random
// sender) through the real pipeline (injectSimInbound) — so it gets parsed into
// a draft and appears in the inbox exactly like a real message. Adds variety
// beyond the 60 hand-written scenarios.
//
//   POST { hint?, count? }   (count 1-3)
//   Authorization: Bearer <Firebase ID token>
//   → { generated, samples: [{ phone, text }] }

import { verifyStaffToken } from "./_lib/rtdb.js";
import { generateScenarioMessage } from "./_lib/gemini.js";
import { injectSimInbound } from "./_lib/inbound-core.js";

function scheduleAfterResponse(promise) {
  promise.catch((e) => console.error("[wa-sim-generate] post-response work failed:", e && e.message));
  try {
    const ctx = globalThis[Symbol.for("@vercel/request-context")];
    const waitUntil = ctx && ctx.get && ctx.get() && ctx.get().waitUntil;
    if (typeof waitUntil === "function") waitUntil(promise);
  } catch (e) { /* local harness — no Vercel context */ }
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

// A fresh Spanish mobile (+34 6XXXXXXXX) per generated scenario → a new
// conversation each time, so generations don't pile onto one thread.
function randomPhone() {
  return "+346" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
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
  const hint = body && typeof body.hint === "string" ? body.hint : "";
  const count = Math.max(1, Math.min(3, parseInt(body && body.count, 10) || 1));

  try {
    const samples = [];
    for (let i = 0; i < count; i++) {
      const gen = await generateScenarioMessage({ hint });        // Gemini invents the message
      if (!gen.message) continue;
      const phone = randomPhone();
      await injectSimInbound({ phone, text: gen.message, name: gen.name }, scheduleAfterResponse); // store + schedule parse
      samples.push({ phone, text: gen.message });
    }
    if (samples.length === 0) { res.status(502).json({ error: "Gemini returned no message" }); return; }
    res.status(200).json({ generated: samples.length, samples });
  } catch (e) {
    console.error("[wa-sim-generate] failed:", e && e.message);
    res.status(e && e.status ? e.status : 500).json({ error: (e && e.message) || "internal error" });
  }
}
