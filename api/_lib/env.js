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
//   GEMINI_MODEL             Model id; default "gemini-3.5-flash-lite" (the
//                            default is gemini.js's DEFAULT_MODEL, with why;
//                            confirm availability in AI Studio or /dev/models
//                            on the local harness).
//   WA_LLM_MODE              "live" | "mock"  (default mock — no network).
//   WA_SEND_MODE             "live" | "mock"  (default mock — no Graph calls).
//   META_VERIFY_TOKEN        Webhook GET-verification shared secret (we choose
//                            it; pasted into the Meta app config at ship time).
//   META_APP_SECRET          Meta app secret for X-Hub-Signature-256 HMAC.
//   META_WA_TOKEN            Cloud API bearer token (live send only).
//   META_PHONE_NUMBER_ID     The restaurant number's Cloud API id (live send).
//                            v18.9.0: also the number guard's first answer — a
//                            webhook change for another number is ignored
//                            (_lib/coexist-core.js, numberIsOurs).
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

// The Gemini model the backend calls (v18.9.2), as ONE function. It was three
// copies of `env("GEMINI_MODEL", DEFAULT_MODEL)` in _lib/gemini.js, and the Admin
// tab now shows it (api/wa-config.js): a fourth copy there could drift from what
// runs, the defect CT-WA-07 found in the modes. HERE rather than in gemini.js
// (/code-review): wa-config would otherwise import gemini.js and with it
// src/lib/whatsapp.js and the booking-logic chain, to read one variable, and a
// break anywhere in that chain would 500 the endpoint api/CLAUDE.md names as
// the cheapest health check. Why the default is 3.5 Flash-Lite: gemini.js.
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
// Trimmed (/code-review): the id goes into the request URL, and a value pasted
// into Vercel with a trailing newline 404s every live parse while the Admin tab,
// where whitespace is invisible, shows a name that looks right. Blank after the
// trim is unset, as env() already treats "".
export function geminiModel() { return String(env("GEMINI_MODEL", "")).trim() || DEFAULT_MODEL; }

// Whether a parse really CALLS Gemini (v18.9.2 /code-review): live mode AND a
// key. Live with no key falls back to the regex mock (liveParse in gemini.js),
// so "live" alone overstates it, the CT-WA-07 shape again. The parse log's `ms`
// and the Admin tab's model both ask this, not llmMode().
export function geminiCalled() { return llmMode() === "live" && Boolean(env("GEMINI_API_KEY", null)); }
export function allowUnsigned() { return env("WA_ALLOW_UNSIGNED", "") === "1"; }

// ── The simulator's kill switch (v18.0.0 phase 5b) ───────────────────────────
// Vercel deploys `api/` WHOLESALE. There is no build-time way to keep the three
// wa-sim-* handlers out of a production deployment the way `WA_SANDBOX` keeps
// WaSimulator out of the client bundle — so a RUNTIME gate is the only mechanism
// available, and being the only one is why it must be fail-closed and must be
// each handler's FIRST statement.
//
// Fail-closed: an ABSENT variable is disabled. Only the sandbox Vercel project
// sets WA_SIM_ENABLED=1, and production never has to remember to unset anything
// — which is the direction that survives someone copying an env var list.
//
// FIRST statement, before the method check and before staff auth, because the
// gate's answer must be indistinguishable from "no such endpoint". Checked after
// the method check, a GET would return 405 and confirm the handler exists; after
// auth, a 401 would do the same. 404 says nothing.
export function simEnabled() { return env("WA_SIM_ENABLED", "") === "1"; }

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
    // `cause` keeps the parser's own error on the one thrown (eslint 10's
    // `preserve-caught-error`); the message already quotes it for the log line.
    throw new Error("FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON: " + e.message, { cause: e });
  }
}
