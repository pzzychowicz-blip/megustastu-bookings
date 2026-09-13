// src/lib/activity.js — v18.0.0 session 8 (item 1)
//
// What the activity log SAYS about a write. Pure, and therefore testable: the
// v17.8.0 rule is that logic deciding something the restaurant acts on does not
// live in a `useEffect`, and "what happened, and who to" is exactly that — the
// log is the screen somebody opens when they want to know who cancelled a
// table.
//
// This module produces ENTRY BODIES. `at`, `uid` and `email` are added by
// `hooks/useActivityLog.js`, because only it has the auth context and the
// server sentinel — and because the rules require all three to be the server's
// answer rather than this module's (see database.rules.README.md, "/activity").
//
// ── NAMES ARE NOT STORED ─────────────────────────────────────────────────────
// A guest's name never enters an entry's `text`. At log time each touched
// booking's name becomes a `{b:<id>}` TOKEN, and the viewer resolves tokens
// against the live bookings list. Three things fall out of that, and the third
// is the reason it is done this way:
//
//   1. An anonymised booking reads "Data removed" in the log automatically,
//      with no pass over the log at all — because the log never held the name.
//   2. A renamed booking reads correctly in its own history.
//   3. Erasure is a property of the SHAPE rather than a migration. The only
//      entries carrying a name are the ones whose booking is DELETED and so has
//      no row to resolve against, and those carry `subject` + `guestKey` — one
//      indexed field to find them by, one field to redact.
//
// ── WHAT IS DELIBERATELY NOT LOGGED ──────────────────────────────────────────
// The per-minute overstay extension. A seated party's `duration` is rewritten
// every tick by `syncLiveDurations`, and a log that records that records
// nothing else legibly. It is skipped BY CONSTRUCTION rather than by a special
// case: a duration-only change touches neither a booking's `history` nor its
// `tables`, and those two are the only things this module reads.

// The kinds, and they are closed: `database.rules.json` validates `kind`
// against this exact list, so adding one here without adding it there produces
// a write the server refuses. The rules file cannot read this constant (the
// forced duplication this repo records for `ROLE_GRANTS`), so
// `tests/activity.test.js` asserts the two agree rather than trusting them to.
// The ONE identity rule in the app, imported rather than restated — see
// `guestKeyOf` below for what restating it cost. `customers.js` imports only
// `booking-logic.js`, so this is a one-way edge and no cycle.
import { dayRangeMs } from "./day";
import { identityKey } from "./customers.js";

export const ACTIVITY_KINDS = [
  "booking", "voucher", "table", "waitlist", "reminder", "standing",
  "settings", "people", "session", "data",
];

// 365 days. The SAME number is in the prune rule in `database.rules.json`, and
// for the same unavoidable reason — a rule cannot read a JS constant. The test
// reads both and compares, so a change here that is not made there fails the
// build rather than producing a prune the server refuses.
export const PRUNE_AFTER_MS = 31536000000;

// ── Tokens ───────────────────────────────────────────────────────────────────

export function bookingToken(id) { return "{b:" + id + "}"; }

// Replace each booking's NAME in `text` with its token. Plain string splitting,
// never a RegExp: a guest name is free text and can contain `(`, `.`, `+` and
// every other metacharacter, and building a pattern out of one is how a log
// entry throws while recording a booking that saved perfectly well.
//
// LONGEST NAME FIRST, which matters whenever one name is a prefix of another
// ("Ana" and "Ana María" on the same write): shortest-first would tokenise the
// prefix and leave " María" stranded beside a token.
export function tokenizeNames(text, list) {
  let out = String(text == null ? "" : text);
  const named = (Array.isArray(list) ? list : [])
    .filter(function (b) { return b && b.id && b.name; })
    .slice()
    .sort(function (a, b) { return String(b.name).length - String(a.name).length; });
  named.forEach(function (b) {
    out = out.split(b.name).join(bookingToken(b.id));
  });
  return out;
}

// The viewer's half. `byId` is a map of the LIVE bookings, so a token whose
// booking is gone resolves through `fallback` — which the caller supplies from
// the entry's own `subject.name` when it has one, and which is otherwise the
// honest "a deleted booking" rather than a raw id nobody can read.
export function renderText(text, byId, fallback) {
  const src = String(text == null ? "" : text);
  const map = byId || {};
  return src.replace(/\{b:([^}]*)\}/g, function (_m, id) {
    const b = map[id];
    if (b && b.name) return b.name;
    return fallback || "a deleted booking";
  });
}

// ── Bookings ─────────────────────────────────────────────────────────────────

function byIdMap(list) {
  const m = {};
  (Array.isArray(list) ? list : []).forEach(function (b) { if (b && b.id) m[b.id] = b; });
  return m;
}

function sameTables(a, b) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// One write in, the entries it deserves out.
//
// The RULE for what earns an entry is "did this write append to a booking's
// own history", because the log is meant to read like booking history — that is
// what was asked for, and it means the log and the per-booking History popup
// can never tell two different stories about the same change.
//
// Two things have no history entry and still matter, so they are handled
// explicitly: a DELETION (the booking is gone, so there is nothing left to
// append to) and a TABLE MOVE made by the optimiser (nobody typed it, so
// nothing wrote a history entry). The second is summarised as ONE Automatic
// entry per write rather than one per booking — a reshuffle touching five
// bookings is one event, and five rows would bury the thing a person did.
export function bookingWriteEntries(prev, computed, ctx) {
  const opts = ctx || {};
  const before = byIdMap(prev);
  const after = byIdMap(computed);
  const entries = [];

  // Deletions first, so a write that both deletes and edits reads in the order
  // it happened to the person watching.
  Object.keys(before).forEach(function (id) {
    if (after[id]) return;
    const b = before[id];
    entries.push(clean({
      kind: "booking",
      text: "deleted " + bookingToken(id) + (b.date ? " · " + b.date + (b.time ? " " + b.time : "") : ""),
      bookings: keyed([id]),
      // The ONLY entry shape that carries a name, and only because there is no
      // longer a booking to resolve its token against. `guestKey` is what
      // "Delete customer & all data" finds it by.
      subject: subjectOf(b),
      guestKey: guestKeyOf(b) || undefined,
      auto: opts.auto === true ? true : undefined,
    }));
  });

  let moved = 0;
  Object.keys(after).forEach(function (id) {
    const now = after[id];
    const was = before[id];
    const grew = appendedHistory(was, now);
    grew.forEach(function (h) {
      entries.push(clean({
        kind: "booking",
        text: tokenizeNames(h.action, [now]),
        bookings: keyed([id]),
        auto: opts.auto === true ? true : undefined,
      }));
    });
    // A table change with no history entry behind it is the optimiser, the
    // reconciler or a drag that did not record itself. Counted, never named:
    // see the summary below.
    if (was && !grew.length && !sameTables(was.tables, now.tables)) moved++;
  });

  if (moved > 0) {
    entries.push({
      kind: "booking",
      auto: true,
      text: moved === 1 ? "1 booking re-placed" : moved + " bookings re-placed",
    });
  }
  return entries;
}

function appendedHistory(was, now) {
  const oldLen = was && Array.isArray(was.history) ? was.history.length : 0;
  const list = now && Array.isArray(now.history) ? now.history : [];
  // A SHORTER history is not an append — it is an undo, an anonymisation, or a
  // booking arriving from another device with less of it. Treating it as an
  // append would emit the whole list.
  if (list.length <= oldLen) return [];
  return list.slice(oldLen).filter(function (h) { return h && h.action; });
}

function subjectOf(b) {
  return {
    name: b.name || "",
    date: b.date || "",
    time: b.scheduledTime || b.time || "",
    size: Number(b.size) || 0,
  };
}

// The identity "Delete customer & all data" searches by — and it is
// `identityKey` ITSELF, not a local re-statement of it.
//
// The first version WAS a re-statement: it returned `b.phone` verbatim if the
// string held six or more digits, else the `guestId`. That disagreed with the
// app's real identity rule in two independent ways, and both make erasure MISS:
//
//   • `identityKey` stores the NORMALISED phone. A booking saved as
//     "+34 600 111 222" was filed under the punctuated string while
//     `deleteCustomer` searches by `normalizePhone(...)` — no match.
//   • `hasRealPhone`'s floor is THREE digits, not six. For a 3-to-5 digit
//     number the two functions disagree about which key even applies: this one
//     files under `guestId` while the search looks under the phone.
//
// A missed erasure is indistinguishable from a successful one — nothing appears
// on screen either way — so the only safe version is the one that cannot drift
// from what the search uses. "" when the booking has neither key, which is a
// booking nobody can ask to have erased.
function guestKeyOf(b) {
  return identityKey(b) || "";
}

function keyed(ids) {
  const m = {};
  ids.forEach(function (id) { m[id] = true; });
  return m;
}

// Drop every key whose value is `undefined`, because an ABSENT key and a key
// holding `undefined` are the same thing in JavaScript and emphatically not the
// same thing to Firebase: `set`/`push` THROWS on an undefined property. Without
// this, every human-originated entry — which is to say every entry with no
// `auto` flag — would throw inside the writer, be swallowed by `emitActivity`'s
// try/catch exactly as that catch is designed to do, and vanish. The safety net
// would hide the bug instead of surfacing it, which is the worst pairing there
// is, so the shape is fixed here where it is built rather than defended against
// downstream. It also matches the rules: `auto` validates `=== true`, and RTDB
// simply has no key for an absent one.
function clean(o) {
  const out = {};
  Object.keys(o).forEach(function (k) { if (o[k] !== undefined) out[k] = o[k]; });
  return out;
}

// ── Vouchers ─────────────────────────────────────────────────────────────────
//
// Money, so every transition is named rather than summarised. The five are the
// five things that can happen to a voucher, and `remaining` is deliberately NOT
// one of them: it is RECOMPUTED from the ledger (`useVouchers`' own rule), so
// logging it would record an arithmetic consequence as if it were an action.
export function voucherWriteEntries(prev, computed, ctx) {
  const opts = ctx || {};
  const before = {};
  (Array.isArray(prev) ? prev : []).forEach(function (v) { if (v && v.code) before[v.code] = v; });
  const entries = [];
  const mark = opts.auto === true ? true : undefined;

  (Array.isArray(computed) ? computed : []).forEach(function (v) {
    if (!v || !v.code) return;
    const was = before[v.code];
    if (!was) {
      entries.push(clean({ kind: "voucher", auto: mark, text: "issued voucher " + v.code }));
      return;
    }
    if (was.status !== "void" && v.status === "void") {
      entries.push(clean({ kind: "voucher", auto: mark, text: "voided voucher " + v.code }));
    }
    if (was.status === "void" && v.status !== "void") {
      entries.push(clean({ kind: "voucher", auto: mark, text: "reinstated voucher " + v.code }));
    }
    newKeys(was.redemptions, v.redemptions).forEach(function (bid) {
      const r = v.redemptions[bid];
      entries.push(clean({
        kind: "voucher", auto: mark,
        text: "redeemed " + amount(r && r.amount) + " of voucher " + v.code + " against " + bookingToken(bid),
        bookings: keyed([bid]),
      }));
    });
    newKeys(was.reversals, v.reversals).forEach(function (rid) {
      const r = v.reversals[rid];
      const bid = r && r.bookingId;
      entries.push(clean({
        kind: "voucher", auto: mark,
        text: "restored " + amount(r && r.amount) + " to voucher " + v.code +
          (bid ? " from " + bookingToken(bid) : ""),
        bookings: bid ? keyed([bid]) : undefined,
      }));
    });
  });
  return entries;
}

function amount(n) {
  const v = Number(n);
  return (isFinite(v) ? v : 0) + "";
}

function newKeys(was, now) {
  const old = was || {};
  return Object.keys(now || {}).filter(function (k) { return !(k in old); });
}

// ── Settings and the other whole-node collections ────────────────────────────
//
// WHICH NODE, and WHICH KEYS — never the values. A settings node holds the
// restaurant's configuration, and a log that printed the old and new value of
// every field would be a second copy of the settings screen, in a place nobody
// can edit. The keys are enough to answer "who changed the opening hours".
//
// Returns NULL when nothing actually differs, which is the case that must not
// produce an entry: `writeWithRev` is called on every save whether or not the
// user changed anything, so an unconditional entry would log a row every time
// somebody opened a settings tab and pressed save.
export function settingsWriteEntry(path, prev, next, ctx) {
  const opts = ctx || {};
  const auto = opts.auto === true ? true : undefined;
  const kind = kindForPath(path);
  const label = NODE_LABEL[path] || path;

  // ── A LIST node is not a settings object, and a key diff lies about it ─────
  // `waitlist`, `reminders`, `roles`, `invites` and the standing rules are
  // ARRAYS. A shallow key diff over an array compares INDICES, so it produces
  // "changed the waitlist · 0, 2" — positions nobody can see — and inserting one
  // entry at the front renumbers everything after it and reports the whole list
  // as changed. The honest statement about a list is how long it is.
  if (Array.isArray(prev) || Array.isArray(next)) {
    const a = Array.isArray(prev) ? prev.length : 0;
    const b = Array.isArray(next) ? next.length : 0;
    if (a === b && same(prev, next)) return null;
    if (a === b) return clean({ kind: kind, auto: auto, text: "changed " + label });
    return clean({
      kind: kind, auto: auto,
      text: (b > a ? "added to " : "removed from ") + label + " · " + a + " → " + b,
    });
  }

  const keys = changedKeys(prev, next);
  if (!keys.length) return null;
  return clean({
    kind: kind,
    auto: auto,
    text: "changed " + label + " · " + keys.join(", "),
  });
}

// The node's name as a person would say it. A path is a fallback, not a label:
// "changed settings/bookingDefaults" is the database talking to itself.
const NODE_LABEL = {
  "settings/operatingHours": "opening hours",
  "settings/dayShifts": "the shift split",
  "settings/optimizer": "the optimiser settings",
  "settings/layout": "the floor plan",
  "settings/bookingDefaults": "the booking defaults",
  "settings/general": "the general settings",
  "settings/voucherDefaults": "the voucher defaults",
  "settings/whatsapp": "the WhatsApp settings",
  "settings/admin": "the admin settings",
  "tableBlocks": "table blocks",
  "waitlist": "the waitlist",
  "reminders": "the reminders",
  "recurring": "the standing bookings",
  "templates": "the WhatsApp templates",
  "roles": "people and roles",
  "invites": "invitations",
};

function kindForPath(path) {
  if (path === "tableBlocks") return "table";
  if (path === "waitlist") return "waitlist";
  if (path === "reminders") return "reminder";
  if (path === "recurring") return "standing";
  if (path === "roles" || path === "invites") return "people";
  return "settings";
}

// A shallow key diff, which is the right depth for these nodes: they are flat
// records of scalars plus the odd array, and a DEEP diff of `settings/layout`
// would name `tables[3].capacity` at a person who wants to read "the floor
// plan". An array or object child compares by JSON, so a reordering counts —
// deliberately, since reordering the priorities IS the change there.
export function changedKeys(prev, next) {
  const a = prev && typeof prev === "object" ? prev : {};
  const b = next && typeof next === "object" ? next : {};
  const seen = {};
  const out = [];
  Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
    if (seen[k]) return;
    seen[k] = true;
    // `v` is the schema version every one of these nodes carries. It moves on a
    // migration rather than on an edit, and naming it in the log would put a
    // word nobody recognises at the front of an otherwise readable list.
    if (k === "v") return;
    if (!same(a[k], b[k])) out.push(k);
  });
  return out.sort();
}

function same(x, y) {
  if (x === y) return true;
  if (x == null && y == null) return true;
  if (typeof x === "object" || typeof y === "object") {
    try { return JSON.stringify(x) === JSON.stringify(y); } catch { return false; }
  }
  return false;
}

// ── The prune ────────────────────────────────────────────────────────────────
//
// The client half of the rule. Both exist on purpose: the rule is what makes it
// TRUE (a client cannot delete a recent entry however it is asked to), and this
// is what makes the app ASK only for what will be allowed — a prune that sent a
// too-young entry would produce a permission error on every open of the log.
export function isPrunable(entry, now) {
  // `entry && Number(entry.at)` is the version this shipped as for one run, and
  // it votes to DELETE a null entry: the `&&` short-circuits to `null`,
  // `Number(null)` is 0 so `isFinite` says yes, and `null < now - a year`
  // coerces to `0 < …` — true. Exactly the trap `lib/clamp.js` records, where
  // `null` and `""` are not absent because `Number()` makes both 0. Caught by
  // the test below rather than in review, which is why that test names the case
  // instead of only the happy path.
  if (!entry || typeof entry !== "object") return false;
  const at = Number(entry.at);
  if (!Number.isFinite(at) || at <= 0) return false;
  return at < now - PRUNE_AFTER_MS;
}


// ── The feed's WINDOW (v18.0.0 session 11) ───────────────────────────────────
//
// Two date strings in, the query's bounds out. It lives here rather than inline
// in App for the reason at the top of this file: it decides WHAT THE APP ASKS
// the database, and a thing that lands `startAt(NaN)` on the one Firebase query
// in the codebase should not also be the only place it can be tested.
//
// The whole design is in the return shape:
//
//   from / to   ms bounds, or NULL for "no bound this side". Null is the
//               resting state of both fields and means the whole log — it is
//               NOT an error, which is the distinction `useActivityFeed` then
//               has to keep, since `Number.isFinite(null)` is false and a
//               finiteness check alone would withhold the default view.
//   badDay      something was typed that is not a date. `isReadableDate`
//               accepts "2026-8-3" and "Sep 13 2026", both of which are NaN
//               once "T00:00:00" is appended — which is the whole reason
//               `dayRangeMs` exists rather than the arithmetic being inline.
//   backwards   a range that ends before it starts. Not a crash: the query
//               would simply return nothing, and that is the point — nothing
//               looks exactly like a quiet week, so the caller is given the
//               difference to say out loud.
//   ok          whether to run the query at all. `badDay` is the half that
//               MUST withhold it (NaN bounds throw inside an effect, and the
//               boundary answers a throw by unmounting the app); `backwards`
//               is withheld because there is nothing to ask.
//
// A ONE-DAY window is simply the two fields holding the same date — the FROM
// field contributing that day's first ms and the TO field its last — so "one
// day" is a position of this control rather than a mode beside it.
export function activityWindow(fromDay, toDay) {
  const a = fromDay ? dayRangeMs(fromDay) : null;
  const b = toDay ? dayRangeMs(toDay) : null;
  const badDay = (!!fromDay && !a) || (!!toDay && !b);
  const from = a ? a.from : null;
  const to = b ? b.to : null;
  const backwards = from != null && to != null && from > to;
  return { from: from, to: to, badDay: badDay, backwards: backwards, ok: !badDay && !backwards };
}
