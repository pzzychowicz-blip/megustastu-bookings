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
import { dbUrl, serviceAccount } from "./env.js";

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

// Verify a staff Firebase ID token (the client's auth.currentUser.getIdToken()).
// Returns the decoded token ({ email, uid, … }) or throws.
export async function verifyStaffToken(idToken) {
  return getAuth(ensureApp()).verifyIdToken(idToken);
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
