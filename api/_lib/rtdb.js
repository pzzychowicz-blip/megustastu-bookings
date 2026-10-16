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
import { statusWins } from "../../src/lib/whatsapp.js";
import { isAdminEntry, sanitizeRole } from "../../src/lib/roles.js";

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

// ── The admin gate (v18.9.0, api/wa-onboard.js) ─────────────────────────────
// Connecting the restaurant's number to MGT is an admin's act. The answer is
// the CLIENT's own question: `isAdminEntry` on the account's `/roles` row,
// exactly what useRoles asks for `isAdmin`, so the server can neither let
// through an account the app treats as staff nor refuse one it shows the
// Connect link to. `settingsAdmin` is never governed by the enforcement flag
// (`ALWAYS_ENFORCED`, roles.js), so the flag is not read: with it off, a
// non-admin account still is not an admin. Asked AFTER verifyStaffToken.
//
// A read that FAILS is not a refusal (/code-review): it reached
// staffAuthError's default, so an admin was told "invalid token" and sent to
// sign in again, which cannot help when the database did not answer. It is
// `ROLES_UNREADABLE`, a 503 that says to try again.
export async function assertWaAdmin(decoded) {
  const uid = decoded && typeof decoded.uid === "string" ? decoded.uid : "";
  let snap = null;
  if (uid) {
    try {
      snap = await getDb().ref("roles/" + sanitizeKey(uid)).get();
    } catch (e) {
      console.error("[wa] the account's role could not be read:", e && e.message);
      const err = new Error("Could not check your role just now: try again in a moment.");
      err.code = "ROLES_UNREADABLE";
      throw err;
    }
  }
  const entry = snap && snap.exists() ? sanitizeRole(snap.val(), uid) : null;
  if (!isAdminEntry(entry)) {
    const err = new Error("Not authorised: only an admin can connect the WhatsApp Business app.");
    err.code = "NOT_ADMIN";
    throw err;
  }
  return decoded;
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
//         login for a fault that is not theirs. v18.9.0: or the account's role
//         could not be read (assertWaAdmin), for the same reason.
//   403 — the token is fine and the ACCOUNT is not allowed, either because it
//         is not on the list or because its email is unverified. Distinct from
//         401 because re-authenticating can never fix either one; the two carry
//         different MESSAGES because they need opposite fixes. v18.9.0: or
//         because the endpoint is an admin's and the account is not one
//         (assertWaAdmin).
//   401 — everything else: absent, expired or malformed token.
export function staffAuthError(e) {
  const code = e && e.code;
  if (code === "NO_SERVICE_ACCOUNT" || code === "NO_STAFF_ALLOWLIST" || code === "ROLES_UNREADABLE") {
    return { status: 503, error: e.message };
  }
  if (code === "NOT_STAFF" || code === "EMAIL_UNVERIFIED" || code === "NOT_ADMIN") return { status: 403, error: e.message };
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

// v18.8.0: one stored message, or null — what api/wa-media.js reads a media id
// from, so the id is never one a browser supplied.
export async function getMessage(phoneKey, msgId) {
  const snap = await getDb().ref("messages/" + sanitizeKey(phoneKey) + "/" + sanitizeKey(msgId)).get();
  return snap.exists() ? snap.val() : null;
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
      // v18.0.0 phase 6 (CT-WA-05): receipts can arrive out of order, so a write
      // has to BEAT what is stored rather than simply replace it. Returning true
      // on a refused downgrade is deliberate — the callback was handled, and
      // counting it as a miss would make the webhook's `statuses` tally lie.
      if (!statusWins(status, m.status)) return true;
      await getDb().ref("messages/" + sanitizeKey(phoneKey) + "/" + key + "/status").set(status);
      return true;
    }
  }
  return false;
}

// v18.9.0: the stored message a customer's edit or delete is about, as
// `{ key, msg }`, or null. Its own wamid is the key of every message the
// webhook stored (one get); a message sent FROM MGT is keyed by its own id and
// carries the wamid as `providerMsgId`, which needs the thread read (the
// receipts above do the same).
export async function findMessageByWamid(phoneKey, wamid) {
  const key = sanitizeKey(wamid);
  const direct = await getMessage(phoneKey, key);
  if (direct) return { key, msg: direct };
  const node = await getDb().ref("messages/" + sanitizeKey(phoneKey)).get();
  if (!node.exists()) return null;
  const all = node.val() || {};
  for (const k of Object.keys(all)) {
    if (all[k] && all[k].providerMsgId === wamid) return { key: k, msg: all[k] };
  }
  return null;
}

// v18.9.0: patch one stored message in place (update() semantics, null deletes
// a field) — an edit's new text, a delete's empty one.
export async function updateMessage(phoneKey, key, patch) {
  await getDb().ref("messages/" + sanitizeKey(phoneKey) + "/" + sanitizeKey(key)).update(patch);
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

// ── The Business-app link (v18.9.0) ──────────────────────────────────────────
// `waLink` is the record of the restaurant number's coexistence connection:
// which WABA and phone-number id Embedded Signup connected, when the contact and
// history syncs ran, and the last account event Meta sent. Only this module
// writes it — the rules give a browser no `.write` on it at all, by design (a
// browser that could write `phoneNumberId` could open the number guard to a
// number of its choosing). Null when the number has never been connected.
export async function readWaLink() {
  const snap = await getDb().ref("waLink").get();
  return snap.exists() ? snap.val() || null : null;
}

// Stamps `waLink/<path>` with `value` unless something is already there, and
// resolves true when this call wrote it — "the first contact sync landed" is a
// moment, and a later webhook must not move it.
export async function stampWaLinkOnce(path, value) {
  let wrote = false;
  const r = await getDb().ref("waLink/" + path).transaction(function (cur) {
    if (cur != null) { wrote = false; return undefined; }
    wrote = true;
    return value;
  });
  return !!(r && r.committed && wrote);
}

// Updates `waLink`'s own fields (update() semantics: null deletes a field).
// The keys are this code's (`linkAfterEvent`), never a webhook's.
export async function updateWaLink(patch) {
  await getDb().ref("waLink").update(patch);
}

// Rewrites `waLink/<path>` through `fn(current)` in a transaction, so two
// webhooks landing together each build on the other (history progress).
export async function transactWaLink(path, fn) {
  await getDb().ref("waLink/" + path).transaction(function (cur) { return fn(cur); });
}

// Removes `waLink` when the sandbox's simulator made it (`sim: true`) and
// resolves whether it did. A transaction that asks of what is stored, so a
// real connection recorded a moment earlier is never what "Forget" deletes.
// Only api/_lib/sim-events.js calls it.
export async function removeSimWaLink() {
  let removed = false;
  await getDb().ref("waLink").transaction(function (cur) {
    removed = !!(cur && cur.sim === true);
    return removed ? null : undefined;
  });
  return removed;
}

// ── An imported chat (v18.9.0, history) ─────────────────────────────────────
// One thread in ONE multi-path update at the root: its new messages, each
// whole under its own key, and its conversation's fields one path each, so
// nothing else in the conversation is replaced. The paths are built here, at
// the sanitising boundary, and only under `messages/<key>/` and
// `conversations/<key>/`: the Admin SDK bypasses the rules, and a root update
// is the one write that could reach anything.
export async function writeImportedThread(phoneKey, records, convPatch) {
  const k = sanitizeKey(phoneKey);
  const patch = {};
  (records || []).forEach(function (m) { patch["messages/" + k + "/" + sanitizeKey(m.id)] = m; });
  Object.keys(convPatch || {}).forEach(function (f) { patch["conversations/" + k + "/" + f] = convPatch[f]; });
  if (Object.keys(patch).length) await getDb().ref().update(patch);
}

// ── The phone's address book (v18.9.0) ──────────────────────────────────────
// `waContacts/<phoneKey>` = `{ name, first?, at }` (src/lib/wa-coexist.js
// decides it). Read per key, for the keys one webhook names, so a delivery
// costs what it carries rather than the size of the address book.
export async function readWaContactsFor(phoneKeys) {
  const out = {};
  await Promise.all(phoneKeys.map(async function (k) {
    const snap = await getDb().ref("waContacts/" + sanitizeKey(k)).get();
    if (snap.exists()) out[k] = snap.val();
  }));
  return out;
}
// One per-key update: a key set to null is deleted. Never the whole node — the
// Admin SDK bypasses the rules, so this is the only limit on what it replaces.
export async function updateWaContacts(patch) {
  const safe = {};
  Object.keys(patch).forEach(function (k) { safe[sanitizeKey(k)] = patch[k]; });
  if (Object.keys(safe).length) await getDb().ref("waContacts").update(safe);
}

// ── Retention (v18.8.0 phase 7, api/wa-prune.js) ─────────────────────────────
// What the nightly prune reads and deletes. Deletes go PER KEY (a conversation)
// and PER MESSAGE (a multi-path update of nulls under one conversation), never
// a whole-node wipe: firebase-admin bypasses the rules, so nothing but this
// code stands between the prune and every thread at once.

// The stored setting, raw: the caller normalises it (`retentionDaysOf`, the
// same function the Admin tab reads it through).
export async function readWaRetentionDays() {
  const snap = await getDb().ref("settings/admin/waRetentionDays").get();
  return snap.exists() ? snap.val() : null;
}

export async function readAllConversations() {
  const snap = await getDb().ref("conversations").get();
  return snap.exists() ? snap.val() || {} : {};
}

// One conversation's messages as stored, keyed by their child keys (an array
// node's keys are its indices, which delete the same way).
export async function readMessageNode(phoneKey) {
  const snap = await getDb().ref("messages/" + sanitizeKey(phoneKey)).get();
  return snap.exists() ? snap.val() || {} : {};
}

// One conversation's messages older than `before` (ms), keyed like
// readMessageNode, for a thread the prune is NOT deleting (/code-review). A
// query on `ts`, indexed in database.rules.json (`messages/$phoneKey`), so a
// regular customer's thread costs the night only its old messages rather than
// its whole history. A message with no `ts` comes too (null sorts first); a
// `ts` that is a string does not (strings sort after numbers). The caller
// filters either way. Both measured on the emulator through firebase-admin.
//
// **A `get()` on a query the rules do not index is REFUSED** ("Index not
// defined"), not filtered for the SDK as a listener's is: measured on the
// emulator. So until the rules carrying the index are published, the thread is
// read whole, as before it, and the deploy order does not matter.
let warnedNoIndex = false;
export async function readOldMessages(phoneKey, before) {
  const node = getDb().ref("messages/" + sanitizeKey(phoneKey));
  let snap;
  try {
    snap = await node.orderByChild("ts").endAt(before - 1).get();
  } catch (e) {
    if (!/index not defined/i.test(String(e && e.message))) throw e;
    if (!warnedNoIndex) {
      warnedNoIndex = true;
      console.warn("[wa-prune] messages/$phoneKey has no .indexOn ts yet (publish database.rules.json); reading threads whole");
    }
    snap = await node.get();
  }
  return snap.exists() ? snap.val() || {} : {};
}

// Deletes the conversation only if `stillOld(stored)` holds at the moment of
// the write, so a message that arrived after the prune read the list keeps its
// thread. Resolves true when it was deleted.
export async function removeConversationIf(phoneKey, stillOld) {
  let decided = false;
  const r = await getDb().ref("conversations/" + sanitizeKey(phoneKey)).transaction(function (cur) {
    // The first call may see null (nothing cached yet); returning it asks the
    // server, which re-runs this with what is stored.
    if (cur == null) { decided = false; return cur; }
    decided = stillOld(cur);
    return decided ? null : undefined; // undefined aborts: leave it as it is
  });
  return !!(r && r.committed && decided);
}

// Deletes the listed messages of one conversation in one write.
export async function removeMessages(phoneKey, ids) {
  if (!ids.length) return;
  const patch = {};
  ids.forEach(function (id) { patch[id] = null; });
  await getDb().ref("messages/" + sanitizeKey(phoneKey)).update(patch);
}
