// scripts/wa-backend-dev.mjs
//
// WhatsApp backend — LOCAL dev harness. Runs the api/ Vercel functions as a
// plain Node http server so the whole Phase-1b pipeline works on localhost
// with zero Vercel coupling:   npm run wa:backend   →   http://localhost:3999
//
// What it does:
//   · parses .env.local into process.env (tiny built-in parser, no dotenv)
//   · defaults WA_ALLOW_UNSIGNED=1 (curl / the Sim panel post unsigned JSON;
//     NEVER set that on Vercel — Meta signatures are enforced there)
//   · adapts node's (req,res) to the Vercel handler shape (req.query +
//     res.status().json()/send() chain)
//   · CORS for the Vite dev app (localhost:5176) — needed locally because the
//     app and this harness are different ports; in production /api/* is same-
//     origin on Vercel and no CORS applies
//   · routes:  GET  /health             liveness + active modes
//              GET  /dev/models         lists Gemini models visible to your key
//                                       (confirm the GEMINI_MODEL string here)
//              POST /dev/customer-reply Gemini writes the CUSTOMER's next
//                                       message for the Sim panel's ✨ Suggest
//                                       (test tooling — deliberately NOT an
//                                       api/ function; never deployed)
//              ANY  /api/wa-inbound     the webhook handler
//              POST /api/wa-send        the staff reply handler
//
// This file is dev-tooling only: it is NOT deployed, and the api/ handlers do
// not know it exists (they run identically under Vercel's runtime at ship).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3999;

// ── .env.local parser (KEY=VALUE, # comments, optional single/double quotes) ──
function loadEnvLocal() {
  const p = path.join(ROOT, ".env.local");
  if (!fs.existsSync(p)) {
    console.warn("[wa-backend] no .env.local found — running with defaults (mock LLM, mock send, no DB).");
    return;
  }
  const lines = fs.readFileSync(p, "utf8").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvLocal();
if (process.env.WA_ALLOW_UNSIGNED === undefined) process.env.WA_ALLOW_UNSIGNED = "1";
if (process.env.META_VERIFY_TOKEN === undefined) process.env.META_VERIFY_TOKEN = "local-dev-verify";

// Import AFTER env is in place (api/_lib/env.js reads process.env lazily, but
// keeping the order makes that contract visible).
const { default: waInbound } = await import("../api/wa-inbound.js");
const { default: waSend } = await import("../api/wa-send.js");
const { default: waSimInbound } = await import("../api/wa-sim-inbound.js");
const { default: waSimSuggest } = await import("../api/wa-sim-suggest.js");
const { llmMode, sendMode, env } = await import("../api/_lib/env.js");
// ✨ Suggest generator is shared with api/wa-sim-suggest.js (one source of truth).
const { generateCustomerReply } = await import("../api/_lib/gemini.js");

// ── Vercel handler shim ────────────────────────────────────────────────────────
function vercelify(req, res) {
  const u = new URL(req.url, "http://localhost:" + PORT);
  req.query = Object.fromEntries(u.searchParams.entries());
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (obj) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
  res.send = function (body) { res.end(typeof body === "string" ? body : String(body)); };
  return u.pathname;
}

// ── /dev/customer-reply — Gemini plays the customer (Sim panel ✨ Suggest) ────
// body: { language: "es"|"en", history: [{direction:"in"|"out", text}, …] }
// Returns { text } — the customer's next message. Plain-text generation (no
// schema), temperature 0.9 for natural variation, same model/timeout family as
// the parse path. The client never sees the Gemini key — that's the point of
// routing this through the harness.
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}
// generateCustomerReply now lives in api/_lib/gemini.js (imported above) so the
// online api/wa-sim-suggest and this /dev route share one prompt + Gemini call.

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (/^http:\/\/localhost:\d+$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  const pathname = vercelify(req, res);
  try {
    if (pathname === "/health") {
      res.status(200).json({
        ok: true,
        llm: llmMode(),
        send: sendMode(),
        db: env("FIREBASE_SERVICE_ACCOUNT", null) ? "configured" : "MISSING (.env.local FIREBASE_SERVICE_ACCOUNT)",
        geminiKey: env("GEMINI_API_KEY", null) ? "configured" : "missing (mock parse fallback)",
      });
      return;
    }
    if (pathname === "/dev/models") {
      const key = env("GEMINI_API_KEY", null);
      if (!key) { res.status(400).json({ error: "GEMINI_API_KEY not set" }); return; }
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + key);
      const data = await r.json();
      const names = (data.models || []).map((m) => m.name.replace(/^models\//, ""));
      res.status(200).json({ models: names });
      return;
    }
    if (pathname === "/dev/customer-reply" && req.method === "POST") {
      const body = await readBody(req);
      if (!body || !Array.isArray(body.history)) { res.status(400).json({ error: "history[] required" }); return; }
      try {
        const text = await generateCustomerReply(body.history, body.language);
        res.status(200).json({ text });
      } catch (e) {
        res.status(e.status || 500).json({ error: e.name === "AbortError" ? "Gemini timeout" : e.message });
      }
      return;
    }
    if (pathname === "/api/wa-inbound") { await waInbound(req, res); return; }
    if (pathname === "/api/wa-send") { await waSend(req, res); return; }
    if (pathname === "/api/wa-sim-inbound") { await waSimInbound(req, res); return; }
    if (pathname === "/api/wa-sim-suggest") { await waSimSuggest(req, res); return; }
    res.status(404).json({ error: "not found", routes: ["/health", "/dev/models", "/dev/customer-reply", "/api/wa-inbound", "/api/wa-send", "/api/wa-sim-inbound", "/api/wa-sim-suggest"] });
  } catch (e) {
    console.error("[wa-backend] handler error:", e);
    if (!res.headersSent) res.status(500).json({ error: e.code === "NO_SERVICE_ACCOUNT" ? e.message : "internal error: " + e.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log("[wa-backend] WhatsApp backend harness on http://localhost:" + PORT);
  console.log("[wa-backend]   modes: llm=" + llmMode() + " send=" + sendMode() + " unsigned=" + process.env.WA_ALLOW_UNSIGNED);
  console.log("[wa-backend]   db:    " + (env("FIREBASE_SERVICE_ACCOUNT", null) ? env("WA_DB_URL", "(DEV default)") : "NOT CONFIGURED — set FIREBASE_SERVICE_ACCOUNT in .env.local"));
  console.log("[wa-backend]   try:   curl http://localhost:" + PORT + "/health");
});
