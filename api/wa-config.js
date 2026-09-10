// api/wa-config.js
//
// "Which server-side keys are configured?" — answered as a BOOLEAN PER KEY and
// never as a value. v18.0.0 phase 5, moved here from phase 4 because
// `api/_lib/env.js` already reads every one of these and a second env reader
// would have been a duplicate for the WhatsApp merge to reconcile.
//
// ── Why booleans, and why that is not paranoia ───────────────────────────────
// The Admin tab's Integrations section exists to say these keys are NOT in the
// database, because everyone who can sign in can read the whole database. An
// endpoint that returned a value — even a masked one, even four characters of a
// suffix — would put the thing back in reach of the people that sentence is
// about, through a different door. So this handler cannot leak a secret by
// mistake: it never holds one. `set` is the ONLY shape it can produce, and
// `Boolean(env(k, null))` is the whole of it.
//
// ── Why staff-auth rather than open ──────────────────────────────────────────
// "Which of the restaurant's integrations are unconfigured" is a map of where
// this deployment is soft, and it is exactly what somebody probing would like.
// It is behind the same `verifyStaffToken` + allow-list as /api/wa-send and
// /api/wa-recheck, so it costs nothing extra to gate.
//
// ── The key list lives HERE ──────────────────────────────────────────────────
// The client renders its own labels and groups (INTEGRATION_KEYS in
// AdminSettings.jsx) and asks this endpoint only the question a browser cannot
// answer. That is the split that keeps the two from being one list in two
// places: presentation there, fact here. A key the client asks about and this
// endpoint does not know comes back absent, and the client shows "unknown"
// rather than inventing a "no" — an unrecognised key is a question this
// deployment cannot answer, which is different from a key that is not set.

import { env, llmMode, sendMode } from "./_lib/env.js";
import { verifyStaffToken, staffAuthError } from "./_lib/rtdb.js";

// Every key `api/_lib/env.js` reads, plus the two the harness/sandbox use. Kept
// as a flat list rather than grouped, for the reason in the header: the grouping
// is a presentation decision and belongs with the labels.
const KEYS = [
  "META_WA_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PHONE_NUMBER_ID",
  "GEMINI_API_KEY", "GEMINI_MODEL",
  "FIREBASE_SERVICE_ACCOUNT", "WA_DB_URL",
  "WA_STAFF_EMAILS", "TENANT_WA_CONTEXT",
];

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }

  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) { res.status(401).json({ error: "missing token" }); return; }
  try {
    await verifyStaffToken(idToken);
  } catch (e) {
    const f = staffAuthError(e);
    res.status(f.status).json({ error: f.error });
    return;
  }

  const set = {};
  // `env(k, null)` returns the fallback for BOTH undefined and "", so a variable
  // present-but-blank reads as unset — which is what it behaves like everywhere
  // else in this backend, and the answer a reader of the Admin tab wants.
  for (const k of KEYS) set[k] = Boolean(env(k, null));

  // The two MODES are not keys and are reported separately, because "GEMINI_API_KEY
  // is set" and "the LLM is actually being called" are different facts and the
  // second is the one that spends money. Values, not booleans: these are the
  // strings "mock"/"live" and neither is a secret.
  //
  // v18.0.0 phase 6 (CT-WA-07): the EFFECTIVE mode, through the same accessors
  // the backend runs on — not `env("WA_LLM_MODE", "mock")`, the raw string.
  // `llmMode()`/`sendMode()` compare `=== "live"` exactly, so `"LIVE"`, `"Live"`,
  // `"live "`, `"true"` and `"1"` all mean MOCK; measured, each of them used to
  // display as itself in the Admin tab while the backend was mocking. The
  // direction is what makes it worth a fix rather than a note — it read as more
  // capable than it was, on the value this handler's own header calls the one
  // that spends money, so an operator who typed `LIVE` would have believed the
  // LLM was running.
  res.status(200).json({
    set,
    modes: { llm: llmMode(), send: sendMode() },
  });
}
