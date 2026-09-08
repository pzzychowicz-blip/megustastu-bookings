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
// ── EXTRAS ADD, DENIES REMOVE ───────────────────────────────────────────────
// v18.0.0 phase 3 shipped with extras only, on the argument that a level should
// be a FLOOR so "what can this person do?" is never a subtraction the reader
// has to hold in their head. Patryk's call reversed it: **an admin must be able
// to switch off a default too.** A level that cannot be reduced is not a
// default, it is a minimum, and a restaurant's actual answer to "this one
// person should not be moving tables" was previously "invent a fourth level".
//
// So a row carries TWO maps and they are mutually exclusive by construction:
// `extras/{cap}` grants what the level does not, `denies/{cap}` removes what
// the level does. Which one a tick writes is decided by the level, never by the
// caller — `setCapability` in useRoles.js — so the two can never both be set
// for one capability and "why can't this person do X?" has exactly one answer.
//
// A deny is scoped to the ENFORCEMENT FLAG like everything else: with
// `enforceRoles` off the app behaves exactly as it did before roles existed,
// and a stored deny does nothing until the flag goes on. Off means off.
//
// ── WHAT THE RULES ENFORCE, AND WHAT THEY DO NOT ────────────────────────────
// Seven capabilities are enforced server-side, because for those the predicate
// is clean: `settingsAdmin` (the `/roles`, `/invites` and `settings/admin`
// nodes), `settingsWrite` / `hoursEdit` / `layoutEdit` (the `settings/*` nodes,
// split four ways), `reminderManage` and `recurringManage` (their own
// collections) and `bookingDelete`
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
  // ── Service — what a shift needs ──────────────────────────────────────────
  { id: "bookingCreate",  group: "service", label: "Take bookings",        blurb: "Add a booking or a walk-in." },
  { id: "bookingEdit",    group: "service", label: "Edit bookings",        blurb: "Change a booking's name, size, time or notes." },
  { id: "bookingStatus",  group: "service", label: "Change status",        blurb: "Confirm, seat, complete or cancel a booking." },
  { id: "bookingAssign",  group: "service", label: "Move tables",          blurb: "Assign or drag a booking to another table." },
  { id: "tableBlock",     group: "service", label: "Block tables",         blurb: "Take a table out of service for a period." },
  { id: "waitlistManage", group: "service", label: "Manage the waitlist",  blurb: "Add, book or remove a waiting party." },

  // ── Money ─────────────────────────────────────────────────────────────────
  { id: "voucherRedeem",  group: "money",   label: "Redeem vouchers",      blurb: "Use a voucher against a booking." },
  { id: "voucherIssue",   group: "money",   label: "Issue vouchers",       blurb: "Create a new gift voucher." },
  { id: "voucherVoid",    group: "money",   label: "Void vouchers",        blurb: "Take a voucher out of use." },

  // ── Configuration — what the restaurant IS ────────────────────────────────
  // v18.0.0 phase 3, Patryk's call: `settingsWrite` was ONE capability covering
  // "hours, layout, defaults and reminders", which is four decisions of very
  // different weight behind one tick. Reminders are a shift tool; the floor
  // plan rewrites the world the optimiser places bookings in; standing bookings
  // create real bookings weeks ahead on their own. Each is its own row now, and
  // each keeps `manager` as its floor, so the split changes nobody's access on
  // the day it ships — it only makes the access separable afterwards.
  { id: "reminderManage",  group: "config", label: "Manage reminders",         blurb: "Create and edit the reminders staff see during a service.", enforced: true },
  { id: "recurringManage", group: "config", label: "Manage standing bookings", blurb: "Bookings that repeat every week, generated ahead automatically.", enforced: true },
  { id: "hoursEdit",       group: "config", label: "Change opening hours",     blurb: "Opening and closing times, closed days, and the shift split.", enforced: true },
  { id: "layoutEdit",      group: "config", label: "Change the floor plan",    blurb: "Tables, zones, joins, combos and the optimiser's priorities.", enforced: true },
  { id: "settingsWrite",   group: "config", label: "Change settings",          blurb: "Booking defaults, the optimiser cutoff and general options.", enforced: true },

  // ── Data and access — what cannot be taken back ───────────────────────────
  { id: "bookingDelete",  group: "data",    label: "Delete bookings",      blurb: "Remove a booking and its record entirely.", enforced: true },
  { id: "customerDelete", group: "data",    label: "Delete customer data", blurb: "Erase a guest's personal details." },
  // The one capability in this group with NO rule behind it, and the list says
  // so rather than implying otherwise: the backup is built client-side out of
  // reads, and `.read` is `auth != null` at the root. Gating it server-side
  // would mean restructuring every read in the app, which is a different
  // project; hiding the button covers the real threat and no more.
  { id: "dataExport",     group: "data",    label: "Export the data",      blurb: "Download every booking, customer and phone number as a file." },
  { id: "settingsAdmin",  group: "data",    label: "Administer the app",   blurb: "This tab: people, roles and modules.", enforced: true },
];

// The grid's section headings, in render order. A thirteen-row grid read fine
// as one block; eighteen does not, and the groups are the honest reading of
// what a tick actually costs — a shift tool, money, the restaurant's own
// configuration, or something that cannot be taken back.
export const CAP_GROUPS = [
  { id: "service", label: "Service" },
  { id: "money",   label: "Money" },
  { id: "config",  label: "Configuration" },
  { id: "data",    label: "Data and access" },
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
// The five capabilities split out of `settingsWrite` in v18.0.0 phase 3 join at
// the level they already had inside it, which is what makes the split a
// REFACTOR of the permission model rather than a change to anybody's access.
const MANAGER = STAFF.concat([
  "bookingDelete", "voucherIssue", "voucherVoid",
  "reminderManage", "recurringManage", "hoursEdit", "layoutEdit",
  "settingsWrite", "dataExport",
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

// ── The capabilities a person can actually LACK ─────────────────────────────
// It was the COMPLEMENT OF THE STAFF FLOOR, and that reasoning was sound while
// extras could only add: every account held at least `ROLE_GRANTS.staff` by
// construction, so a gate on `bookingStatus` was a branch that could never run.
//
// **Denies removed the floor.** An admin can now switch off any capability for
// any one person, so every capability in the list can genuinely be absent and
// every one of them needs a gate. This is therefore just `CAP_IDS` — kept as
// its own name because `tests/roles.test.js` asserts every member has a gate,
// and that assertion is what turned "the revocation feature" from a tick that
// changes a stored flag into a tick that changes what the app lets you do.
//
// The seven that used to be un-lackable are exactly the seven that gained gates
// in the same commit: take, edit, status, move, block, waitlist, redeem.
export const GATED_CAPS = CAP_IDS.slice();

// The capability's own label, lower-cased for the middle of a sentence — the
// refusal a person actually reads ("You don't have permission to delete
// bookings."). One source with `CAPABILITIES`, so the panel and the refusal
// cannot come to call the same capability two different things.
export function capLabel(id) {
  const c = CAPABILITIES.find(function (x) { return x.id === id; });
  return c ? c.label.toLowerCase() : "do that";
}

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
  // FIRST, and deliberately above the deny: with enforcement off the app is
  // byte-for-byte what it was before roles existed, and a deny stored while
  // experimenting must not leak out through a flag that is switched off.
  if (!enforceRoles && !ALWAYS_ENFORCED[cap]) return true;
  const e = entry || {};
  // A deny beats everything below it. `setCapability` never writes both a deny
  // and an extra for one capability, so this ordering is a guard rather than a
  // policy — but it has to BE one of the two, and refusing is the safe half.
  if (e.denies && e.denies[cap] === true) return false;
  const grants = ROLE_GRANTS[effectiveRole(e.role)] || {};
  if (grants[cap]) return true;
  return !!(e.extras && e.extras[cap] === true);
}

// What the grid draws in a person's own column, as one word. Exported so the
// glyph, the screen-reader text and the toggle all read one function instead of
// three ladders that agree today.
export function capState(entry, cap) {
  const e = entry || {};
  if (e.denies && e.denies[cap] === true) return "denied";
  const grants = ROLE_GRANTS[effectiveRole(e.role)] || {};
  if (grants[cap]) return "level";
  if (e.extras && e.extras[cap] === true) return "extra";
  return "none";
}

// Does the LEVEL grant this, ignoring both maps? The one question that decides
// whether a tick writes a deny or an extra.
export function levelGrants(role, cap) {
  const grants = ROLE_GRANTS[effectiveRole(role)] || {};
  return !!grants[cap];
}

// Does this row grant `settingsAdmin` by ANY route — level or extra? The
// no-self-demotion rule and the panel both turn on this exact question, and
// asking it in one place is what keeps them from drifting apart.
export function isAdminEntry(entry) {
  const e = entry || {};
  // The deny is checked FIRST and that is what keeps the last-admin invariant
  // intact after v18.0.0 phase 3's revocation: without it an admin could strip
  // their own `settingsAdmin` by writing a deny instead of by changing their
  // level, and `wouldRemoveOwnAdmin` — which asks this exact question of the
  // old and new rows — would have seen no change at all.
  if (e.denies && e.denies.settingsAdmin === true) return false;
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
    extras: sanitizeCaps(src.extras),
    denies: sanitizeCaps(src.denies),
    addedAt: Number(src.addedAt) || 0,
    addedBy: typeof src.addedBy === "string" ? src.addedBy : "",
    updatedAt: Number(src.updatedAt) || 0,
  };
}

// Only KNOWN capability ids, only `true`, and the keys SORTED. All three
// matter, and it is shared by BOTH maps: an unknown id would be a capability
// nothing can ever check, and `false` is not how a revocation is spelt — a deny
// is `denies/{cap}: true`, a PRESENT key, so that the rules can test it with
// `.val() !== true` without having to tell "absent" from "false". The sort is the
// write-path requirement `sortedLedger` exists for one file over: `contentKey`
// is a key-order-sensitive `JSON.stringify` compare, so an unsorted object read
// back could differ from the one just written, the diff would report a change
// that is not one, and the hook would write on every snapshot.
function sanitizeCaps(x) {
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
    extras: sanitizeCaps(src.extras),
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
    extras: sanitizeCaps(i.extras),
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
      // BOTH maps, though the grid reads `entry` rather than these two. A row
      // model carrying half of a fact is how a future consumer comes to believe
      // extras are the whole answer — which is exactly what they were until
      // three days ago.
      extras: r.extras,
      denies: r.denies,
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
        // An invitation says "come in at this level" and carries no denies —
        // the fine-tuning happens on the row once that person exists.
        role: i.role, extras: i.extras, denies: {}, entry: null, invite: i,
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
