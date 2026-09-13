// src/lib/modules.js
//
// v18.0.0 phase 4 — the module registry (pure functions, no React, no Firebase).
//
// A MODULE is a feature that a restaurant may not have at all: the gift
// vouchers, the WhatsApp inbox. `settings/admin.modules.{id}.enabled` is the
// switch, and it is the SAME mechanism as multi-tenancy's answer to "restaurant
// B has no WhatsApp" — under project-per-restaurant each tenant has its own
// `settings/admin`, so a per-tenant module set needs no namespacing, no
// tenant-aware rules and no new mechanism. That property is why the switch
// lives here rather than in a build flag or a per-device preference.
//
// ── A MODULE IS NOT A CAPABILITY ────────────────────────────────────────────
// `roles.js` answers "may THIS PERSON do it"; this file answers "does this
// restaurant HAVE it". They compose in one direction only and the order is
// load-bearing: a module that is off hides the surface from everybody including
// an admin, so `moduleOn` is checked FIRST and `can` never runs. Putting them
// the other way round would let a capability grant re-open a feature the
// restaurant switched off.
//
// The two are separate for a reason a merged version could not serve: a
// capability is revoked from one waiter and restored next week, while a module
// being off is a fact about the restaurant. Registering vouchers as an
// eighteenth capability would have made "this restaurant has no vouchers" say
// "nobody here may redeem a voucher" — the same screen, a different sentence,
// and the wrong one to hand a new manager.
//
// ── OFF MEANS EVERY SURFACE, NOT THE ENTRY POINTS ───────────────────────────
// Patryk's call (session 4). Off hides all of it: the Settings tab, the
// booking-form picker, the list chips, the redeem modal, the unsettled banner,
// the printed column and the keyboard route into the modal. The alternative —
// off stops NEW vouchers while existing ones stay redeemable — is defensible
// and was rejected because a half-off module cannot be explained on one line of
// screen, and the tenant story ("restaurant B has no vouchers") is the whole
// argument for the registry existing.
//
// The cost of that choice is real and is paid where it belongs: an open voucher
// is money the restaurant owes, and switching the module off would make that
// liability invisible. So the Admin tab COUNTS the open vouchers and says the
// number before the switch moves (`AdminSettings.jsx`). It refuses nothing —
// an admin who has read the count may still turn it off, and the vouchers are
// untouched in the database, waiting for the switch to come back.

// ── The registry ────────────────────────────────────────────────────────────
// Order is display order in the Admin tab. `defaultEnabled` is what an ABSENT
// node reads as, which is the production state on the day this deploys: the
// features that already shipped stay on, and WhatsApp — which has not shipped
// at all when this lands — is off, so the switch cannot turn on a module whose
// code is not there yet.
export const MODULES = [
  {
    id: "vouchers",
    label: "Gift vouchers",
    defaultEnabled: true,
    blurb: "Issue, redeem and track gift vouchers.",
    // Named on screen so an admin reading the switch knows what disappears
    // rather than discovering it during a service.
    hides: "The Vouchers tab, the voucher picker on a booking, the voucher chips in the list, and the unsettled-vouchers banner.",
  },
  {
    id: "whatsapp",
    label: "WhatsApp inbox",
    defaultEnabled: false,
    blurb: "Take bookings from WhatsApp messages, with the conversation beside them.",
    hides: "The Inbox view and everything WhatsApp writes to.",
  },
];

export const MODULE_IDS = MODULES.map(function (m) { return m.id; });

const BY_ID = {};
MODULES.forEach(function (m) { BY_ID[m.id] = m; });

export function moduleMeta(id) { return BY_ID[id] || null; }

// ── The stored shape ────────────────────────────────────────────────────────
// `{ [id]: { enabled: <boolean> } }` and never a bare boolean, because a module
// will want more than a switch (a display name, a mode) and a shape that has to
// change later is a migration for nothing now.
//
// Every value is resolved through `defaultEnabled`, so a node written before a
// module existed reads that module at its default rather than as off. An id the
// registry does not know is DROPPED: a module removed from the code must not
// leave a switch behind that nothing honours.
export function sanitizeModules(m) {
  const src = m && typeof m === "object" ? m : {};
  const out = {};
  MODULES.forEach(function (mod) {
    const row = src[mod.id];
    const stored = row && typeof row === "object" ? row.enabled : undefined;
    // `=== true` / `=== false` and not truthiness, for the reason
    // `sanitizeAdminSettings` gives about `enforceRoles`: an unexpected value
    // must fall to the DEFAULT, not to whatever JavaScript makes of it. A
    // string "false" read as on would show a module the restaurant switched off.
    out[mod.id] = { enabled: stored === true ? true : stored === false ? false : mod.defaultEnabled };
  });
  return out;
}

export const DEFAULT_MODULES = sanitizeModules(null);

// ── The one gate ────────────────────────────────────────────────────────────
// Takes the sanitized map. An unknown id returns FALSE rather than true: a
// typo'd gate hides a surface, which is visible immediately, instead of leaving
// one permanently open, which is not.
export function moduleOn(modules, id) {
  const row = modules && typeof modules === "object" ? modules[id] : null;
  if (row && typeof row === "object") return row.enabled === true;
  const meta = BY_ID[id];
  return meta ? meta.defaultEnabled === true : false;
}

// Applied to a stored map, so a caller changes one switch without restating the
// others — the same reason `setRole` takes a partial.
export function withModule(modules, id, on) {
  if (!BY_ID[id]) return sanitizeModules(modules);
  const next = Object.assign({}, sanitizeModules(modules));
  next[id] = { enabled: on === true };
  return next;
}

// ── What a module is about to hide ──────────────────────────────────────────
// The sentence the Admin tab shows on the way OFF. Pure, and here rather than
// in `App.jsx`, for the reason v17.8.0 made a rule: a string a person reads
// before deciding something is a decision, and a decision buried in a component
// is unreachable by a test.
//
// /code-review: the first version hardcoded the word "voucher" in every clause,
// in a file whose own header says the registry "knows what modules EXIST, never
// what they hold" — an assertion and its violation eighty lines apart, which is
// the falsely-reassuring-documentation defect this repo hunts. The vocabulary
// is now the CALLER's, because the caller is the only thing that knows what the
// module holds; this owns the shape of the sentence and the number agreement,
// which is what actually went wrong on screen and is what the tests pin.
//
// `noun` is the singular ("voucher"); `plural` defaults to `noun + "s"` so the
// ordinary case stays one argument. `amount` arrives ALREADY FORMATTED, which
// is what keeps this file free of `lib/vouchers.js` without growing a second
// money formatter.
//
// Returns null for "nothing to say", which is the ordinary case: a confirm on
// every switch is a confirm nobody reads.
export function hideWarning(count, formattedAmount, noun, plural) {
  if (!count) return null;
  const one = count === 1;
  const many = plural || (noun ? noun + "s" : "");
  return count + " " + (one ? noun : many) + (one ? " is" : " are")
    + " still open, worth " + formattedAmount
    + ". Switching this off hides " + (one ? "it" : "them")
    + " \u2014 nothing is deleted, and turning it back on brings "
    + (one ? "it" : "them") + " back exactly as " + (one ? "it is" : "they are") + ".";
}
