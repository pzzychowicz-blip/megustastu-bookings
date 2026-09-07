// src/lib/roles.js
//
// v18.0.0 phase 3 — the roles model (pure functions, no React, no Firebase).
//
// Three levels — `staff`, `manager`, `admin` — plus per-person EXTRAS that add
// a single capability on top of a level. `/roles/{uid}` is the 9th persisted
// collection and `/invites/{inviteId}` the 10th.
//
// ── THE UI ASKS `can("bookingDelete")`, NEVER `role === "admin"` ─────────────
// That is the whole reason this file exists. A `role === "admin"` test written
// at a call site is a fourth copy of the role map that nothing can see, and it
// cannot honour an extra — so the person an admin deliberately granted
// `bookingDelete` to would still find the button hidden, while the server
// happily accepted their write. Every gate in the app goes through `can`.
//
// ── THE ROLE MAP IS A CONSTANT IN CODE, NOT DATA ────────────────────────────
// `ROLE_GRANTS` is reviewed in a diff, covered by the tests below, and readable
// in one place. It is deliberately NOT editable from the Admin tab: a mis-tick
// in an editable matrix costs every user on that level at once, with no diff
// and no test to catch it, whereas a mis-tick in the extras grid costs one
// person one capability. The grid an admin actually sees writes only
// `/roles/{uid}/extras/{cap}`.
//
// ── EXTRAS ARE ADDITIVE ONLY ────────────────────────────────────────────────
// They grant; they never revoke. So a level is always a FLOOR, and "what can
// this person do?" is answerable as *their level, plus what is highlighted on
// their row* — never as a subtraction the reader has to hold in their head. A
// cell that is granted by the level is therefore un-untickable BY
// CONSTRUCTION: there is nothing to write, not a disabled attribute.
//
// ── WHAT THE RULES ENFORCE, AND WHAT THEY DO NOT ────────────────────────────
// Three capabilities are enforced server-side, because for those the predicate
// is clean: `settingsAdmin` (the `/roles`, `/invites` and `settings/admin`
// nodes), `settingsWrite` (every other `settings/*` node) and `bookingDelete`
// (a delete on `bookings/$bid` — which works only because `.write` IS evaluated
// for a delete, the v17.16.7 finding). `RULE_ENFORCED` below names them, and
// `tests/rules/database-rules.test.js` asserts the rules and this file agree
// rather than trusting that they do.
//
// **Everything else is UI-only, and this file says so rather than implying
// otherwise.** Per-field status transitions ("staff may set `seated` but not
// `cancelled`") would need an old-vs-new comparison on the hottest rule in the
// app for a benefit the client-side gate already delivers against the real
// threat, which is a member of staff tapping the wrong thing. A permission
// model that claims more than it enforces is exactly the falsely-reassuring
// documentation this repo's crash tests hunt for, so the Admin tab prints the
// distinction on screen too.

// ── Capabilities ────────────────────────────────────────────────────────────
// Single camelCase tokens, and that is forced twice over: `extras` must be an
// OBJECT because rules cannot search an array, and an RTDB key may not contain
// a `.`, so `booking.delete` is unstorable.
//
// `label` is what the grid's row header shows; `blurb` is the one-line
// explanation under it. `enforced` marks the three the server also refuses —
// it is rendered in the panel, because the honest version of this screen tells
// you which promises are guarantees.
export const CAPABILITIES = [
  { id: "bookingCreate",  label: "Take bookings",        blurb: "Add a booking or a walk-in." },
  { id: "bookingEdit",    label: "Edit bookings",        blurb: "Change a booking's name, size, time or notes." },
  { id: "bookingStatus",  label: "Change status",        blurb: "Confirm, seat, complete or cancel a booking." },
  { id: "bookingAssign",  label: "Move tables",          blurb: "Assign or drag a booking to another table." },
  { id: "tableBlock",     label: "Block tables",         blurb: "Take a table out of service for a period." },
  { id: "waitlistManage", label: "Manage the waitlist",  blurb: "Add, book or remove a waiting party." },
  { id: "voucherRedeem",  label: "Redeem vouchers",      blurb: "Use a voucher against a booking." },
  { id: "bookingDelete",  label: "Delete bookings",      blurb: "Remove a booking and its record entirely.", enforced: true },
  { id: "voucherIssue",   label: "Issue vouchers",       blurb: "Create a new gift voucher." },
  { id: "voucherVoid",    label: "Void vouchers",        blurb: "Take a voucher out of use." },
  { id: "settingsWrite",  label: "Change settings",      blurb: "Hours, layout, defaults and reminders.", enforced: true },
  { id: "customerDelete", label: "Delete customer data", blurb: "Erase a guest's personal details." },
  { id: "settingsAdmin",  label: "Administer the app",   blurb: "This tab: people, roles and modules.", enforced: true },
];

export const CAP_IDS = CAPABILITIES.map(function (c) { return c.id; });

// ── The three levels ────────────────────────────────────────────────────────
// Patryk's call, v18.0.0: staff run a service, a manager owns money and
// configuration. Staff can do everything a shift needs — take, edit, seat,
// move, block, waitlist, redeem — and cannot do the things a wrong tap cannot
// undo.
export const ROLES = ["staff", "manager", "admin"];

const STAFF = [
  "bookingCreate", "bookingEdit", "bookingStatus", "bookingAssign",
  "tableBlock", "waitlistManage", "voucherRedeem",
];
const MANAGER = STAFF.concat([
  "bookingDelete", "voucherIssue", "voucherVoid", "settingsWrite",
]);
const ADMIN = MANAGER.concat(["customerDelete", "settingsAdmin"]);

function grantSet(list) {
  const m = {};
  list.forEach(function (c) { m[c] = true; });
  return m;
}

// role -> { capId: true }. Frozen because a level's grants are a constant, and
// a consumer that mutated one would change what every other consumer sees.
export const ROLE_GRANTS = Object.freeze({
  staff:   Object.freeze(grantSet(STAFF)),
  manager: Object.freeze(grantSet(MANAGER)),
  admin:   Object.freeze(grantSet(ADMIN)),
});

// The three the server refuses too — derived from CAPABILITIES rather than
// re-typed, so the panel's badge and the rules sweep read one fact.
export const RULE_ENFORCED = Object.freeze(grantSet(
  CAPABILITIES.filter(function (c) { return c.enforced; }).map(function (c) { return c.id; })
));

// ── An absent role reads as `staff` ─────────────────────────────────────────
// Both an account with no `/roles` row at all and a self-registered stub whose
// `role` is still `null`. Useful on a first shift, harmless until an admin says
// otherwise — and it is the only reading that lets `enforceRoles` be flipped on
// without stranding an account nobody has got to yet.
export function effectiveRole(role) {
  return ROLES.indexOf(role) >= 0 ? role : "staff";
}

// ── `settingsAdmin` is NOT governed by the enforcement flag ─────────────────
// The flag exists so the rules deploy is rolling-safe: `bookings` and
// `settings/*` carry live traffic from accounts that have no `/roles` row, and
// a rule that simply REQUIRED one would stop every device the moment it
// deployed. `/roles`, `/invites` and `settings/admin` are new in v18.0.0 and
// carry no pre-existing traffic at all, so gating them hard costs nothing and
// they are admin-only from the first deploy, flag or no flag.
//
// The client must therefore ask the SAME question the rule asks, or the UI
// promises a write the server refuses — which is the disagreement this whole
// phase is supposed to avoid. Hence: with the flag off, every capability is
// granted EXCEPT this one.
export const ALWAYS_ENFORCED = Object.freeze({ settingsAdmin: true });

// ── The one gate ────────────────────────────────────────────────────────────
// `entry` is a sanitized `/roles/{uid}` row or null (no row at all).
export function can(entry, cap, enforceRoles) {
  if (!enforceRoles && !ALWAYS_ENFORCED[cap]) return true;
  const e = entry || {};
  const grants = ROLE_GRANTS[effectiveRole(e.role)] || {};
  if (grants[cap]) return true;
  return !!(e.extras && e.extras[cap] === true);
}

// Does this row grant `settingsAdmin` by ANY route — level or extra? The
// no-self-demotion rule and the panel both turn on this exact question, and
// asking it in one place is what keeps them from drifting apart.
export function isAdminEntry(entry) {
  const e = entry || {};
  if (e.role === "admin") return true;
  return !!(e.extras && e.extras.settingsAdmin === true);
}

// ── Sanitize ────────────────────────────────────────────────────────────────
// The `uid` is the child KEY, and it is the row's identity of last resort — the
// v17.16.13 lesson one collection over, where mapping `Object.values` threw the
// key away and a row carrying no `id` field was minted a fresh one on every
// read, so the write-diff saw a create and the node grew by one row per pass.
// A row that states its own uid keeps it; only a row written by something else
// (the console bootstrap step, an Admin-SDK write) reaches the key arm.
export function sanitizeRole(r, key) {
  const src = r && typeof r === "object" ? r : {};
  const uid = String(src.uid || key || "");
  return {
    uid,
    email: typeof src.email === "string" ? src.email : "",
    name: typeof src.name === "string" ? src.name : "",
    // `null` is MEANINGFUL: a self-registered stub that no admin has given a
    // level yet. Coercing it to "staff" here would make the panel unable to
    // show "invited, not yet applied", which is the whole of the invite flow.
    role: ROLES.indexOf(src.role) >= 0 ? src.role : null,
    extras: sanitizeExtras(src.extras),
    addedAt: Number(src.addedAt) || 0,
    addedBy: typeof src.addedBy === "string" ? src.addedBy : "",
    updatedAt: Number(src.updatedAt) || 0,
  };
}

// Only KNOWN capability ids, only `true`, and the keys SORTED. All three
// matter. An unknown id would be a capability nothing can ever check, `false`
// would be a revocation the additive model does not have, and the sort is the
// write-path requirement `sortedLedger` exists for one file over: `contentKey`
// is a key-order-sensitive `JSON.stringify` compare, so an unsorted object read
// back could differ from the one just written, the diff would report a change
// that is not one, and the hook would write on every snapshot.
function sanitizeExtras(x) {
  if (!x || typeof x !== "object") return {};
  const out = {};
  Object.keys(x).sort().forEach(function (k) {
    if (CAP_IDS.indexOf(k) < 0) return;
    if (x[k] === true) out[k] = true;
  });
  return out;
}

export function sanitizeRoles(node) {
  if (!node || typeof node !== "object") return [];
  return Object.entries(node)
    .map(function (kv) { return sanitizeRole(kv[1], kv[0]); })
    .filter(function (r) { return r.uid; });
}

export function sanitizeInvite(i, key) {
  const src = i && typeof i === "object" ? i : {};
  return {
    id: String(src.id || key || ""),
    // Lower-cased, because this is a MATCH KEY: the panel pairs an invite with
    // a self-registered row by email, and Firebase Auth does not promise the
    // case a person typed at sign-up.
    email: normalizeEmail(src.email),
    role: ROLES.indexOf(src.role) >= 0 ? src.role : "staff",
    extras: sanitizeExtras(src.extras),
    createdAt: Number(src.createdAt) || 0,
    createdBy: typeof src.createdBy === "string" ? src.createdBy : "",
    updatedAt: Number(src.updatedAt) || 0,
  };
}

export function sanitizeInvites(node) {
  if (!node || typeof node !== "object") return [];
  return Object.entries(node)
    .map(function (kv) { return sanitizeInvite(kv[1], kv[0]); })
    .filter(function (i) { return i.id && i.email; });
}

export function normalizeEmail(e) {
  return typeof e === "string" ? e.trim().toLowerCase() : "";
}

// ── The last-admin invariant ────────────────────────────────────────────────
// Patryk's call, v18.0.0, against a maintained admin-count node: **an admin may
// not strip their OWN `settingsAdmin`.**
//
// That is not the literal wording the plan used ("refuse a write that would
// leave /roles with no admin") because RTDB rules cannot count children —
// there is no `numChildren()` — so the literal version needs a counter node,
// which is a second piece of state that can drift and whose repair needs the
// Firebase console. That is the exact state the guard exists to avoid.
//
// The invariant is DERIVED instead, and it is the same guarantee: only an
// account holding `settingsAdmin` may write `/roles` at all, and it cannot
// remove its own — so the set of admins shrinks only when one admin demotes
// ANOTHER, and the demoter still holds it. The set can therefore never reach
// zero. One clause, no new state, and the panel disables exactly what the rule
// refuses instead of approximating it.
//
// The cost, stated on screen: an admin who wants to step down asks another
// admin to do it.
export function wouldRemoveOwnAdmin(writerUid, targetUid, oldEntry, newEntry) {
  if (writerUid !== targetUid) return false;
  if (!isAdminEntry(oldEntry)) return false;
  return !isAdminEntry(newEntry);
}

// ── The invite flow ─────────────────────────────────────────────────────────
// An invitation cannot be claimed automatically, and the reason is a property
// of RTDB rather than a shortcut: a rule would have to look up an invitation BY
// the signing-in user's email, and rules do no string manipulation, cannot
// query, and an email cannot be a key (it contains a `.`). So the user
// self-registers a stub with `role: null`, the panel pairs it with the open
// invitation, and an admin applies it in one tap.
//
// The alternative — letting a user write their own `role` and validating it
// later — is a self-service promotion hole. A serverless claim function or a
// custom claim would close it properly; neither is worth building for a team
// that gains a person a few times a year, and both stay available.
export function matchInvite(invites, email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  return (invites || []).find(function (i) { return i.email === e; }) || null;
}

// What an admin's one tap writes onto the stub. Returns the FIELDS to merge,
// not a whole row, so the caller's sanitize owns the shape.
export function applyInviteFields(invite) {
  const i = invite || {};
  return {
    role: ROLES.indexOf(i.role) >= 0 ? i.role : "staff",
    extras: sanitizeExtras(i.extras),
  };
}

// ── The panel's row model ───────────────────────────────────────────────────
// Every `/roles` row, plus every open invitation that has NOT yet been matched
// by one — an invited person who has never signed in has no uid, so they exist
// only as an invitation and would otherwise be invisible on the screen whose
// job is "who can use this app".
//
// Sorted by LEVEL and then by name — never by anything that changes on its own,
// so the list cannot reorder under the reader while they are pointing at a row:
// admins first, then managers, then staff, then unapplied stubs, then pending
// invitations.
//
// The plan listed a `lastSeenAt` on each row and this deliberately has none.
// Once a stub exists, `roles/$uid` is admin-only — that is the whole of the
// no-self-promotion rule — so a person can never stamp their own, and nothing
// else is in a position to. It would have been a field written once as `0` and
// never again: an unreferenced write path reading as a supported feature, which
// is the same thing phase 1's review removed from `useVouchers`. The question it
// was for is answered better and for free anyway — a row EXISTS only because
// that person has signed in at least once, and `/presence` already says who is
// connected right now.
export function userRows(roles, invites) {
  const rows = (roles || []).map(function (r) {
    return {
      kind: "user",
      uid: r.uid,
      email: r.email,
      name: r.name,
      role: r.role,
      extras: r.extras,
      entry: r,
      // An invitation matching this row is an OFFER, not a state: it is shown
      // on the row with an Apply control and does not change what they can do
      // until an admin taps it.
      invite: matchInvite(invites, r.email),
    };
  });
  const claimed = {};
  rows.forEach(function (r) { if (r.email) claimed[r.email] = true; });
  const pending = (invites || [])
    .filter(function (i) { return !claimed[i.email]; })
    .map(function (i) {
      return {
        kind: "invite",
        uid: null, inviteId: i.id, email: i.email, name: "",
        role: i.role, extras: i.extras, entry: null, invite: i,
      };
    });
  return rows.concat(pending).sort(rowOrder);
}

const GROUP = { admin: 0, manager: 1, staff: 2 };

function rowOrder(a, b) {
  const ga = a.kind === "invite" ? 4 : (a.role === null ? 3 : GROUP[a.role]);
  const gb = b.kind === "invite" ? 4 : (b.role === null ? 3 : GROUP[b.role]);
  if (ga !== gb) return ga - gb;
  return displayName(a).localeCompare(displayName(b));
}

export function displayName(row) {
  const r = row || {};
  return r.name || r.email || r.uid || "";
}
