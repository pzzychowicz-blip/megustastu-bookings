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
//   WA_STAFF_EMAILS          Comma-separated allow-list of staff emails that
//                            may call the token-gated endpoints. UNSET means
//                            "any signed-in account of this Firebase project",
//                            which is the sandbox default and is why the DEV
//                            harness needs no configuration — but see
//                            requireStaffAllowList() below: unset becomes a
//                            hard failure the moment the backend can send real
//                            messages or reach a non-DEV database.

const DEV_DB_URL = "https://megustastu-bookings-dev-default-rtdb.europe-west1.firebasedatabase.app";

export function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function dbUrl() { return env("WA_DB_URL", DEV_DB_URL); }
export function llmMode() { return env("WA_LLM_MODE", "mock") === "live" ? "live" : "mock"; }
export function sendMode() { return env("WA_SEND_MODE", "mock") === "live" ? "live" : "mock"; }
export function allowUnsigned() { return env("WA_ALLOW_UNSIGNED", "") === "1"; }

// ── Staff allow-list ─────────────────────────────────────────────────────────
// verifyIdToken proves a valid token FOR THIS FIREBASE PROJECT and nothing
// more, while these endpoints grant abilities the client security rules do not:
// live Gemini calls billed to us, and live sends from the restaurant's own
// WhatsApp number. Firebase email/password signup is on by default, so "has a
// token" and "is staff" are not the same claim.
export function staffEmails() {
  return env("WA_STAFF_EMAILS", "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Whether an EMPTY allow-list is acceptable. The sandbox runs against the DEV
// database in mock-send mode, where the worst a stray account can do is write
// test data to a scratch project — so unset is allowed there and the harness
// needs no configuration.
//
// It stops being acceptable in exactly the two states ROADMAP names as the
// trigger: a backend that can SEND from the real number, or one pointed at a
// database that is not the DEV default. Tying the requirement to those states
// rather than to a deploy checklist is the point — a checklist is a thing
// someone has to remember at the moment they are busiest.
export function requireStaffAllowList() {
  return sendMode() === "live" || dbUrl() !== DEV_DB_URL;
}

export function serviceAccount() {
  const raw = env("FIREBASE_SERVICE_ACCOUNT", null);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON: " + e.message);
  }
}
