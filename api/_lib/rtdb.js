// api/_lib/rtdb.js
//
// WhatsApp backend — Firebase Realtime Database access via firebase-admin.
//
// Init-once pattern: serverless containers are reused between invocations, so
// the Admin app is cached at module scope (re-init throws "app already exists").
// The database URL comes from env.dbUrl(), which DEFAULTS TO THE DEV PROJECT —
// production is opt-in via an explicit WA_DB_URL, mirroring the firebase.js
// DEV/PROD split on the client (sandbox safety first).
//
// WRITE SHAPE — keyed, not arrays (the production schema from the Phase 1a
// design, §7): conversations/{phoneKey} is an object per conversation;
// messages/{phoneKey}/{msgId} is an object per message. Per-key update()/
// child-set() writes are concurrency-safe between this backend and the client
// app (two writers can't clobber each other's records the way whole-node array
// set() can). The client's onValue listeners are shape-tolerant and dedup, so
// they read this shape as-is.
//
// RTDB key constraint: keys may not contain . # $ [ ] /. Meta message ids
// ("wamid.HBg…") contain dots → sanitizeKey() maps them to "_" for use as the
// msgId path segment; the raw wamid is preserved in the message body as
// providerMsgId.
//
// PHONE KEYS GO THROUGH sanitizeKey TOO, at every path-building site below.
// A well-formed one ("+34600…") is already a valid RTDB key — "+" is allowed —
// and that is exactly why this was skipped, and exactly why it should not have
// been: the value arrives from a webhook payload and from request bodies, so
// "well-formed" is an assumption about a remote party, not a property of the
// data. An unsanitized "/" is the one that matters, because it does not fail —
// it silently RE-TARGETS the write to another path. Sanitizing at the boundary
// rather than in the callers is the point: there are seven of these, and a rule
// that has to be remembered seven times is one that will be forgotten once.

// firebase-admin v14 ships the MODULAR API — the legacy namespaced surface
// (admin.credential.cert / admin.database() / admin.auth() / admin.apps) is
// gone, so import the pieces from their sub-paths.
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getAuth } from "firebase-admin/auth";
import { dbUrl, serviceAccount, staffEmails, requireStaffAllowList } from "./env.js";

let cachedApp = null;
let cachedDb = null;

// Init-once: reuse the app across warm serverless invocations and across this
// module's getDb()/verifyStaffToken() callers.
function ensureApp() {
  if (cachedApp) return cachedApp;
  const sa = serviceAccount();
  if (!sa) {
    const err = new Error("FIREBASE_SERVICE_ACCOUNT is not configured — backend cannot reach the database. Paste the DEV service-account JSON (one line) into .env.local.");
    err.code = "NO_SERVICE_ACCOUNT";
    throw err;
  }
  const existing = getApps();
  cachedApp = existing.length ? existing[0] : initializeApp({ credential: cert(sa), databaseURL: dbUrl() });
  return cachedApp;
}

export function getDb() {
  if (cachedDb) return cachedDb;
  cachedDb = getDatabase(ensureApp());
  return cachedDb;
}

// ── The staff access DECISION, as a pure function ────────────────────────────
// Split out of verifyStaffToken so it can be tested at all. The token exchange
// needs firebase-admin and a live project; the decision needs neither, and the
// decision is the part that matters — it is what stands between a stranger with
// a valid Firebase account and a backend that spends Gemini budget and, in live
// mode, sends from the restaurant's own number.
//
// This is the same rule the repo already applies to `placeWaitlist` and
// `presenceState`: logic that decides something the restaurant acts on does not
// live where a test cannot reach it.
//
// Throws with a `code` (consumed by staffAuthError below) or returns `decoded`.
export function assertStaffAllowed(decoded) {
  const allowed = staffEmails();

  if (!allowed.length) {
    if (requireStaffAllowList()) {
      // Fails CLOSED, and fails per-REQUEST rather than at boot: a misconfigured
      // live backend must not serve one request.
      const err = new Error("WA_STAFF_EMAILS is not configured. It is required whenever WA_SEND_MODE=live or WA_DB_URL points off the DEV database.");
      err.code = "NO_STAFF_ALLOWLIST";
      throw err;
    }
    return decoded;              // sandbox: any signed-in account
  }

  const email = String((decoded && decoded.email) || "").trim().toLowerCase();
  if (!email || !allowed.includes(email)) {
    const err = new Error("Not authorised: this account is not on the WhatsApp staff allow-list.");
    err.code = "NOT_STAFF";
    throw err;
  }

  // Checked SEPARATELY from membership, and with its own message, because the
  // two failures need opposite fixes and one of them is a ship-day trap: an
  // account created in the Firebase console has `emailVerified: false`, the
  // allow-list is only enforced once WA_SEND_MODE=live, so the first time this
  // fires is the day it matters most — and "not on the allow-list" would be a
  // lie about an address the operator can SEE on the list.
  //
  // The check itself stays: with signup open, an address on the list that has
  // no account yet could be self-registered by anyone, and email verification
  // is the only thing that proves the registrant owns that inbox.
  if (decoded.email_verified === false) {
    const err = new Error("Not authorised: " + email + " is on the staff allow-list but its email address is not verified. Verify it in the Firebase console (Authentication → the user → send a verification email), or clear the unverified account.");
    err.code = "EMAIL_UNVERIFIED";
    throw err;
  }
  return decoded;
}

// Verify a staff Firebase ID token (the client's auth.currentUser.getIdToken()).
// Returns the decoded token ({ email, uid, … }) or throws.
//
// Two checks, not one. `verifyIdToken` answers "is this a valid token for this
// Firebase project", which is NOT the same question as "is this staff": these
// endpoints grant abilities the client security rules do not — live Gemini
// calls billed to us, live sends from the restaurant's number — and Firebase
// email/password signup is on by default. The second check is
// `assertStaffAllowed` above; see env.js for WA_STAFF_EMAILS.
export async function verifyStaffToken(idToken) {
  return assertStaffAllowed(await getAuth(ensureApp()).verifyIdToken(idToken));
}

// The HTTP mapping for what verifyStaffToken can throw, in ONE place. It was
// five verbatim catch blocks across the five gated endpoints, which is the
// condition that produces the next disagreement — and it had already produced
// the beginnings of one, since two of the five carried the explanatory comment
// and three did not.
//
// The distinctions it makes are the point:
//   503 — the SERVER is misconfigured. No service account (cannot verify any
//         token) or, now, a live/non-DEV backend with no staff allow-list.
//         Telling staff "invalid token" for these sends them to debug their own
//         login for a fault that is not theirs.
//   403 — the token is fine and the ACCOUNT is not allowed, either because it
//         is not on the list or because its email is unverified. Distinct from
//         401 because re-authenticating can never fix either one; the two carry
//         different MESSAGES because they need opposite fixes.
//   401 — everything else: absent, expired or malformed token.
export function staffAuthError(e) {
  const code = e && e.code;
  if (code === "NO_SERVICE_ACCOUNT" || code === "NO_STAFF_ALLOWLIST") {
    return { status: 503, error: e.message };
  }
  if (code === "NOT_STAFF" || code === "EMAIL_UNVERIFIED") return { status: 403, error: e.message };
  return { status: 401, error: "invalid token" };
}

export function sanitizeKey(s) {
  return String(s).replace(/[.#$/[\]]/g, "_");
}

// ── Conversations ─────────────────────────────────────────────────────────────
export async function getConversation(phoneKey) {
  const snap = await getDb().ref("conversations/" + sanitizeKey(phoneKey)).get();
  return snap.exists() ? snap.val() : null;
}

// update() semantics — only the supplied fields change; concurrent writers to
// other fields/conversations are untouched. Setting a field to null deletes it.
export async function upsertConversation(phoneKey, patch) {
  await getDb().ref("conversations/" + sanitizeKey(phoneKey)).update(patch);
}

// ── Messages ──────────────────────────────────────────────────────────────────
// Child-set at messages/{phoneKey}/{msg.id}. Using the (sanitized) wamid as the
// msgId makes Meta webhook retries IDEMPOTENT: re-processing the same delivery
// writes the same record to the same path — no duplicate bubbles.
export async function appendMessage(phoneKey, msg) {
  await getDb().ref("messages/" + sanitizeKey(phoneKey) + "/" + sanitizeKey(msg.id)).set(msg);
}

// readMessages(phoneKey, limit) — the conversation's most recent messages,
// oldest-first, for the manual re-check (api/wa-recheck). Reads the whole keyed
// node then slices: RTDB's orderByChild("ts") would need an index rule, and a
// conversation is a handful of messages, so sorting in memory is the cheaper
// trade. Reads BOTH storage shapes for the same reason the client listener does
// (pre-migration array data).
export async function readMessages(phoneKey, limit) {
  const snap = await getDb().ref("messages/" + sanitizeKey(phoneKey)).get();
  if (!snap.exists()) return [];
  const val = snap.val() || {};
  const list = Array.isArray(val) ? val.filter(Boolean) : Object.values(val);
  list.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return limit > 0 ? list.slice(-limit) : list;
}

export async function messageExists(phoneKey, msgId) {
  const snap = await getDb().ref("messages/" + sanitizeKey(phoneKey) + "/" + sanitizeKey(msgId)).get();
  return snap.exists();
}

// Delivery/read receipts: find the message whose providerMsgId matches the
// wamid from a statuses[] callback and update its status field in place.
export async function updateMessageStatusByWamid(phoneKey, wamid, status) {
  const node = await getDb().ref("messages/" + sanitizeKey(phoneKey)).get();
  if (!node.exists()) return false;
  const all = node.val() || {};
  for (const key of Object.keys(all)) {
    const m = all[key];
    if (m && m.providerMsgId === wamid) {
      await getDb().ref("messages/" + sanitizeKey(phoneKey) + "/" + key + "/status").set(status);
      return true;
    }
  }
  return false;
}

// ── Settings (read-only, for the LLM prompt constraints) ─────────────────────
// v15 schema: settings/operatingHours holds per-day {open,close} (weekHours).
// Returned as-is; gemini.js folds it into the prompt. Null when unset.
export async function readOperatingHours() {
  try {
    const snap = await getDb().ref("settings/operatingHours").get();
    return snap.exists() ? snap.val() : null;
  } catch {
    return null; // prompt falls back to the default hours line
  }
}
