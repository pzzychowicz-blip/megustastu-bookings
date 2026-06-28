// api/_lib/env.js
//
// WhatsApp backend — environment access in ONE place. Every function/module
// reads its config through here so the variable names stay greppable and the
// mode flags have a single definition.
//
// Files under api/_lib/ are NOT exposed as Vercel routes (underscore-prefixed
// folders are excluded from the api/ filesystem routing) — they're the shared
// server library for api/wa-inbound.js + api/wa-send.js.
//
// Local development: scripts/wa-backend-dev.mjs parses .env.local into
// process.env before importing the handlers. On Vercel these come from the
// project's environment-variable settings (added at ship time — NOT yet done).
//
// Variables (all strings):
//   WA_DB_URL                RTDB url. Defaults to the DEV database — the
//                            sandbox-safe default. At ship time Vercel sets the
//                            PROD url explicitly; the default never points there.
//   FIREBASE_SERVICE_ACCOUNT One-line JSON of the service-account key (kept in
//                            .env.local, which is gitignored via *.local).
//   GEMINI_API_KEY           Google AI Studio key (free tier).
//   GEMINI_MODEL             Model id; default "gemini-3-flash" (confirm in AI
//                            Studio — see /dev/models on the local harness).
//   WA_LLM_MODE              "live" | "mock"  (default mock — no network).
//   WA_SEND_MODE             "live" | "mock"  (default mock — no Graph calls).
//   META_VERIFY_TOKEN        Webhook GET-verification shared secret (we choose
//                            it; pasted into the Meta app config at ship time).
//   META_APP_SECRET          Meta app secret for X-Hub-Signature-256 HMAC.
//   META_WA_TOKEN            Cloud API bearer token (live send only).
//   META_PHONE_NUMBER_ID     The restaurant number's Cloud API id (live send).
//   WA_ALLOW_UNSIGNED        "1" → skip HMAC verification. LOCAL ONLY — the
//                            harness sets it; never set it on Vercel.

const DEV_DB_URL = "https://megustastu-bookings-dev-default-rtdb.europe-west1.firebasedatabase.app";

export function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function dbUrl() { return env("WA_DB_URL", DEV_DB_URL); }
export function llmMode() { return env("WA_LLM_MODE", "mock") === "live" ? "live" : "mock"; }
export function sendMode() { return env("WA_SEND_MODE", "mock") === "live" ? "live" : "mock"; }
export function allowUnsigned() { return env("WA_ALLOW_UNSIGNED", "") === "1"; }

export function serviceAccount() {
  const raw = env("FIREBASE_SERVICE_ACCOUNT", null);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON: " + e.message);
  }
}
