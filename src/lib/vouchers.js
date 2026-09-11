// src/lib/vouchers.js
//
// v18.0.0 phase 1 — the voucher model (pure functions, no React, no Firebase).
//
// Gift vouchers are the app's 8th persisted collection, `/vouchers/{CODE}`, and
// the CODE is the child KEY — so "a given number exists at most once" is a
// property of the storage rather than a check somebody has to remember. Two
// devices issuing the same number race on one path and the rules refuse the
// second (`baseUpdatedAt === 0` is only accepted when no child exists).
//
// The model, settled in the plan: the NUMBER is unique forever, the MONEY
// carries over. A voucher can be attached to a later booking until it hits zero
// or expires.
//
// ── A NUMBER IS NEVER RELEASED ───────────────────────────────────────────────
// Three mechanisms, and all three are needed because each covers a case the
// others do not:
//
//   1. `generateCode(existing)` takes the set of codes already in use and
//      retries on collision. The set is free — the child key IS the code, so
//      the loaded voucher list contains every code that has ever existed. This
//      is deliberately NOT a probabilistic argument: with manual codes in play
//      a pre-printed book may use short or sequential numbers, so the
//      exclusion is explicit.
//   2. A voucher is VOIDED, never deleted. `status: "void"` keeps the child,
//      and therefore the key, and therefore the number, occupied forever.
//      There is no delete action on a voucher anywhere in the UI and that is a
//      hard rule, not an omission — a delete would free the number and
//      silently break mechanism 1.
//   3. The create-only rule is the server-side backstop, so a duplicate is
//      refused by the database whatever the client believes.
//
// ── THE ALPHABET IS A PROPERTY OF GENERATION, NOT OF ACCEPTANCE ──────────────
// v18.0.0, Patryk-confirmed, and it is a correction to the plan's own wording.
// The plan's §1.3 said to "strip everything outside the alphabet" on input —
// the 31-char set below, which drops 0/O and 1/I/L so a code read out over the
// phone cannot be mis-transcribed. Correct for a GENERATED code and destructive
// for a MANUAL one, which is the new requirement: a pre-printed voucher book
// contains whatever it contains. Measured against that wording before it was
// changed:
//
//     "0001234"  ->  "234"          four characters silently deleted
//     "LOT-1001" ->  "T"            one character survives out of seven
//     "1234"     ->  "234"          ...which COLLIDES with "0001234"
//
// A collision there is not cosmetic: two different printed vouchers resolve to
// one child key, so the second one's create is refused as a duplicate and staff
// simply cannot issue it. So `normalizeCode` keeps every alphanumeric and the
// unambiguous alphabet governs `generateCode` alone.

// ── Constants ────────────────────────────────────────────────────────────────

// Generation alphabet: 31 characters, deliberately missing 0/O and 1/I/L so a
// generated code survives being read out over the phone. Every character is a
// legal RTDB key character (the illegal set is `.` `#` `$` `[` `]` `/`).
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Generated codes are 8 characters — 31^8 ≈ 8.5e11, rendered as "ABCD-2345".
export const CODE_LENGTH = 8;

// Manual codes come from a printed book, so the bounds are usability bounds and
// not a format. The floor keeps a stray keystroke from becoming a voucher; the
// ceiling is far under RTDB's 768-byte key limit and longer than any real
// voucher number. A code outside them is REFUSED, never truncated — truncating
// is what manufactures the collision described above.
export const MANUAL_CODE_MIN = 3;
export const MANUAL_CODE_MAX = 32;

// How many times `generateCode` re-rolls before giving up. See its note.
const GENERATE_TRIES = 50;

// ── Code handling ────────────────────────────────────────────────────────────

// The one normaliser: used by the generator's collision check, by the manual
// entry field, and by every redemption lookup — the `normalizePhone` precedent
// in customers.js. Uppercases and drops everything that is not alphanumeric, so
// "abcd 2345", "ABCD-2345" and "ABCD2345" all resolve to one child, which is
// the property the plan actually wanted.
export function normalizeCode(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Is this something we are willing to store as a child key? Distinct from "is
// it taken" — a caller needs to tell a malformed number from a duplicate one,
// because staff can act on the difference.
export function isValidCode(code) {
  const c = normalizeCode(code);
  return c.length >= MANUAL_CODE_MIN && c.length <= MANUAL_CODE_MAX;
}

// Display only — the hyphen is never stored and never looked up.
//
// Only an exactly-CODE_LENGTH code is grouped, and that is the honest rule
// rather than a lazy one: we hyphenate the shape we generate, and we show a
// manual code exactly as it was typed. Re-grouping "LOT1001" into "LOT1-001"
// would print something that does not match the physical voucher in the
// customer's hand.
export function formatCode(code) {
  const c = normalizeCode(code);
  if (c.length !== CODE_LENGTH) return c;
  return c.slice(0, 4) + "-" + c.slice(4);
}

// Pick a code that is not already in use.
//
// `existing` is anything with a membership test — a Set, an array, or an object
// keyed by code (the loaded `/vouchers` node itself). `rnd` is injectable so the
// collision path is testable rather than merely believed; it defaults to
// Math.random.
//
// Returns `null` when every try collided. That cannot happen by chance at this
// scale, which is exactly why it must not be an exception the UI never catches:
// if it ever fires, something is wrong with `existing` (a caller passing the
// whole database, say), and a null the issue form reports is recoverable where a
// throw mid-render is not.
export function generateCode(existing, rnd) {
  const taken = codeSet(existing);
  const r = typeof rnd === "function" ? rnd : Math.random;
  for (let t = 0; t < GENERATE_TRIES; t++) {
    let out = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET.charAt(Math.floor(r() * CODE_ALPHABET.length));
    }
    if (!taken.has(out)) return out;
  }
  return null;
}

// Normalise whatever shape the caller has into a Set of codes. An array of
// voucher objects, an array of strings, a Set, or the keyed node — all four
// reach here, because the collision set is "every code that has ever existed"
// and different call sites hold it differently.
export function codeSet(existing) {
  const out = new Set();
  if (!existing) return out;
  const add = (v) => {
    const c = normalizeCode(typeof v === "string" ? v : v && v.code);
    if (c) out.add(c);
  };
  if (existing instanceof Set || Array.isArray(existing)) existing.forEach(add);
  else if (typeof existing === "object") {
    Object.keys(existing).forEach((k) => {
      // The KEY is authoritative — a stored row's `code` field is an echo and
      // may be missing on a row written by something other than this app.
      const c = normalizeCode(k);
      if (c) out.add(c);
      add(existing[k]);
    });
  }
  return out;
}

// ── Money ────────────────────────────────────────────────────────────────────

// `deposit`'s clamp idiom (v16.3.0): survives a string, a null, a NaN and a
// negative in one expression, which is why that field's `>= 0` rule predicate
// has never had to fire.
export function clampMoney(x) {
  return Math.max(0, Number(x) || 0);
}

export function valueOf(v) {
  return clampMoney(v && v.value);
}

export function remainingOf(v) {
  return clampMoney(v && v.remaining);
}

// What the ledger says was actually spent. Derived rather than stored, so it
// can never disagree with the entries it is a total of.
export function redeemedTotal(v) {
  const led = v && v.redemptions;
  if (!led || typeof led !== "object") return 0;
  return Object.keys(led).reduce((s, k) => s + clampMoney(led[k] && led[k].amount), 0);
}

// ── Expiry ───────────────────────────────────────────────────────────────────

// Seed an expiry `months` after `issuedAt`. `months <= 0` means never — the
// setting's "never" position — and returns null.
//
// Two details that are decisions rather than arithmetic:
//
//   * The result is the END of the target day (23:59:59.999 local). A voucher
//     sold at 21:00 and given 12 months is usable for the whole of its last
//     day, which is what a customer holding it would assume.
//   * A day-of-month that does not exist in the target month is CLAMPED back to
//     that month's last day, not overflowed. Jan 31 + 1 month is Feb 28, not
//     Mar 3 — `Date.setMonth` alone gives the latter, and silently handing out
//     two extra days on a legal instrument is not a rounding error worth
//     inheriting.
export function expiryFrom(issuedAt, months) {
  const m = Math.floor(Number(months) || 0);
  if (m <= 0) return null;
  const base = Number(issuedAt) || Date.now();
  const d = new Date(base);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + m);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isExpired(v, now) {
  const e = v && v.expiresAt;
  if (e === null || e === undefined || e === "") return false; // never expires
  const t = Number(e);
  if (!isFinite(t)) return false;
  return (Number(now) || Date.now()) > t;
}

// ── State ────────────────────────────────────────────────────────────────────

// One of "void" | "spent" | "expired" | "open".
//
// The ORDER is the meaning. `void` wins over everything — a voided voucher is
// void whatever its balance says. `spent` beats `expired` because spent is
// terminal and is the more useful thing to read: money that was used is a
// different story from money that ran out of time, and a voucher can be both.
export function voucherState(v, now) {
  if (!v) return "void";
  if (v.status === "void") return "void";
  if (remainingOf(v) <= 0) return "spent";
  if (isExpired(v, now)) return "expired";
  return "open";
}

// Has this booking already been settled against this voucher?
export function isRedeemedBy(v, bookingId) {
  if (!v || !bookingId) return false;
  const led = v.redemptions;
  return !!(led && typeof led === "object" && led[bookingId]);
}

// May this voucher be attached to this booking?
//
// The one non-obvious branch is the second: a booking that ALREADY has a ledger
// entry against this voucher keeps its link even once the balance is zero.
// Without it, editing a booking that spent the last of a voucher would be told
// "this voucher is spent" and made to drop a link that records something that
// really happened.
export function canAttach(v, bookingId, now) {
  if (!v) return false;
  if (isRedeemedBy(v, bookingId)) return true;
  return voucherState(v, now) === "open";
}

// The half `canAttach` structurally cannot answer.
//
// "Never attached to two live bookings at once" is a constraint over the
// BOOKINGS list — the attachment lives on the booking (`booking.voucherCode`),
// while the voucher only records what has been REDEEMED. So it needs the
// bookings, and no amount of looking at the voucher will do.
//
// Terminal bookings do not count: a cancelled or completed booking's voucher
// link is a record of what happened, not a live claim on the balance.
export function attachedElsewhere(bookings, code, bookingId) {
  const c = normalizeCode(code);
  if (!c || !Array.isArray(bookings)) return null;
  const other = bookings.find(
    (b) =>
      b &&
      b.id !== bookingId &&
      normalizeCode(b.voucherCode) === c &&
      b.status !== "cancelled" &&
      b.status !== "completed"
  );
  return other || null;
}

// A booking carrying a voucher that was never redeemed — the UNSETTLED state.
//
// It exists because the close-time auto-complete flips every still-seated
// booking to `completed` with nobody present, and must never redeem: there is
// no human to answer "fully or partially?". So the booking completes, the
// voucher stays open, and this is what the notification strip reads to tell
// staff to settle it next service. Same shape as v17.16.12's `seatingClosed`
// gate — a status path that runs without a person needs its own answer.
export function isUnsettled(booking, voucherByCode) {
  if (!booking || booking.status !== "completed") return false;
  const c = normalizeCode(booking.voucherCode);
  if (!c) return false;
  const v = voucherByCode && voucherByCode[c];
  if (!v) return false;
  return !isRedeemedBy(v, booking.id);
}

// ── Read sanitisation ────────────────────────────────────────────────────────

// The `sanitize` shape from booking-logic.js, one collection over: every gap a
// stored row can have is filled here, once, so no consumer has to guard.
//
// `key` is the RTDB child key and is the IDENTITY OF LAST RESORT — v17.16.13's
// lesson, where mapping `Object.values` threw the key away and a row whose
// stored value carried no `id` was minted a new one on every read, growing the
// node by one booking per pass. The key is authoritative here for the stronger
// reason that the key IS the code.
//
// `remaining` absent seeds from `value`, which is what a freshly issued voucher
// has. The alternative — treating it as 0 — would read a row written by
// anything but this app (a console edit, a rules probe) as already spent, and
// silently swallow a customer's balance.
export function sanitizeVoucher(v, key) {
  const src = v && typeof v === "object" ? v : {};
  const code = normalizeCode(key || src.code);
  const value = clampMoney(src.value);
  const hasRemaining = src.remaining !== undefined && src.remaining !== null && src.remaining !== "";
  return {
    code,
    value,
    remaining: hasRemaining ? clampMoney(src.remaining) : value,
    notes: typeof src.notes === "string" ? src.notes : "",
    status: src.status === "void" ? "void" : "open",
    // Where this number came from, permanently. A written-once field, so its
    // rule predicate carries the grandfather clause like every other format
    // check (v17.16.11).
    origin: src.origin === "manual" ? "manual" : "generated",
    issuedAt: Number(src.issuedAt) || 0,
    issuedBy: typeof src.issuedBy === "string" ? src.issuedBy : "",
    expiresAt:
      src.expiresAt === null || src.expiresAt === undefined || src.expiresAt === ""
        ? null
        : Number(src.expiresAt) || null,
    redemptions: sortedLedger(src.redemptions),
    // v18.0.0 session 8 (item 5a) — THE SILENT TRAP. This function is a
    // WHITELIST: a field missing from it is deleted by the next voucher write,
    // with no error anywhere. Without this line the reversal trail would be
    // erased by the next unrelated edit to the same voucher — the `UNDO_FIELDS`
    // failure shape, one collection over. Sorted for `sortedLedger`'s reason:
    // `contentKey` is a key-order-sensitive `JSON.stringify` compare.
    reversals: sortedReversals(src.reversals),
    updatedAt: Number(src.updatedAt) || 0,
  };
}
// The reversals map's own normaliser. A different field set from `sortedLedger`
// — it records BOTH ends of the redemption's life (who took it and when, who
// gave it back and when), which is the whole point of keeping it.
function sortedReversals(rev) {
  if (!rev || typeof rev !== "object") return {};
  const out = {};
  Object.keys(rev).sort().forEach((k) => {
    const e = rev[k];
    if (!e || typeof e !== "object") return;
    out[k] = {
      bookingId: typeof e.bookingId === "string" ? e.bookingId : "",
      amount: clampMoney(e.amount),
      redeemedAt: Number(e.redeemedAt) || 0,
      redeemedBy: typeof e.redeemedBy === "string" ? e.redeemedBy : "",
      reversedAt: Number(e.reversedAt) || 0,
      reversedBy: typeof e.reversedBy === "string" ? e.reversedBy : "",
    };
  });
  return out;
}

// The ledger's keys are SORTED, and that is a write-path requirement rather than
// tidiness. `write-path.js`'s `contentKey` is a `JSON.stringify` compare, which
// is key-ORDER sensitive — the same trap `flatReminder` exists for. RTDB returns
// a child object's keys in its own order and a local spread returns them in
// insertion order, so without this the same ledger read back could differ from
// the one just written, the diff would report a change that is not one, and the
// hook would write on every snapshot.
function sortedLedger(led) {
  if (!led || typeof led !== "object") return {};
  const out = {};
  Object.keys(led).sort().forEach((k) => {
    const e = led[k];
    if (!e || typeof e !== "object") return;
    out[k] = { amount: clampMoney(e.amount), at: Number(e.at) || 0, by: typeof e.by === "string" ? e.by : "" };
  });
  return out;
}

// The node is a keyed object; this walks ENTRIES so each row keeps its key.
export function sanitizeVouchers(node) {
  if (!node || typeof node !== "object") return [];
  return Object.entries(node)
    .map(([k, v]) => sanitizeVoucher(v, k))
    .filter((v) => v.code);
}

// Code -> voucher, for the lookups every consumer actually wants.
export function voucherIndex(vouchers) {
  const out = {};
  (Array.isArray(vouchers) ? vouchers : []).forEach((v) => {
    if (v && v.code) out[v.code] = v;
  });
  return out;
}

// ── Mutations ────────────────────────────────────────────────────────────────
//
// These live here rather than in `useVouchers.js` for the reason v17.8.0 set
// out when `placeWaitlist` and `presenceState` were extracted: logic that
// decides something the restaurant acts on does not live in a hook. This is
// money. The hook keeps its subscription, its refs and its setState; every
// decision below is pure and tested.

// May this number be issued, and under which origin?
//
// `taken` is every code that has ever existed (see `codeSet`). The three
// refusals are DISTINCT on purpose — "that is not a usable number" and "that
// number is already in use" are different failures and staff can act on the
// difference. The duplicate check here is the fast, specific message; the
// create-only rule is the guarantee, and a second device can still win the race
// between them.
export function validateIssue({ code, value, taken }) {
  const amount = clampMoney(value);
  if (amount <= 0) return { ok: false, error: "Enter an amount above zero." };
  const set = taken instanceof Set ? taken : codeSet(taken);

  const typed = normalizeCode(code);
  if (typed) {
    if (!isValidCode(typed)) {
      return {
        ok: false,
        error: "A voucher number needs " + MANUAL_CODE_MIN + "–" + MANUAL_CODE_MAX + " letters or digits.",
      };
    }
    if (set.has(typed)) return { ok: false, error: "That number is already in use." };
    return { ok: true, code: typed, origin: "manual", value: amount };
  }

  const gen = generateCode(set);
  if (!gen) return { ok: false, error: "Couldn't find a free number. Please try again." };
  return { ok: true, code: gen, origin: "generated", value: amount };
}

// Record a redemption against a booking.
//
// Two properties make this idempotent by construction, and both are needed:
// the ledger is keyed by BOOKING, so a replay writes the same child; and
// `remaining` is RECOMPUTED from `value - redeemedTotal(ledger)` rather than
// decremented, so applying it twice gives the same answer where a decrement
// would not. It also means the balance can never silently disagree with the
// entries it is supposed to be a total of.
export function applyRedemption(v, bookingId, amount, at, by) {
  if (!v || !bookingId) return v;
  const led = Object.assign({}, v.redemptions);
  led[bookingId] = { amount: clampMoney(amount), at: Number(at) || Date.now(), by: by || "" };
  return sanitizeVoucher(
    Object.assign({}, v, { redemptions: led, remaining: clampMoney(valueOf(v) - redeemedTotal({ redemptions: led })) }),
    v.code
  );
}

// The exact inverse — the booking was completed by mistake, or reopened.
//
// ── v18.0.0 session 8 (item 5a, ROADMAP): it MOVES the entry, never drops it ──
// `applyRedemption` stamps `by: <email>` on every ledger entry; this deleted the
// entry and recorded nothing, so a balance could be restored with no mark on the
// money record itself. The trail was not absent — the booking's own `history`
// carries the status change, and a restore only ever happens behind the
// walk-back prompt — but `/vouchers` has NO BACKUPS and is the one place
// somebody looks when the numbers disagree.
//
// Keyed `<bookingId>_<reversedAt>` rather than by booking, so redeem → reverse →
// redeem → reverse keeps BOTH. `remaining` stays derived from the ledger, so
// nothing about the balance moves; this is a record beside it, not a second
// source of truth for it.
export function removeRedemption(v, bookingId, at, by) {
  if (!v || !bookingId || !isRedeemedBy(v, bookingId)) return v;
  const led = Object.assign({}, v.redemptions);
  const gone = led[bookingId] || {};
  delete led[bookingId];
  const when = Number(at) || Date.now();
  const rev = Object.assign({}, v.reversals);
  rev[bookingId + "_" + when] = {
    bookingId,
    amount: clampMoney(gone.amount),
    redeemedAt: Number(gone.at) || 0,
    redeemedBy: typeof gone.by === "string" ? gone.by : "",
    reversedAt: when,
    reversedBy: typeof by === "string" ? by : "",
  };
  return sanitizeVoucher(
    Object.assign({}, v, {
      redemptions: led,
      reversals: rev,
      remaining: clampMoney(valueOf(v) - redeemedTotal({ redemptions: led })),
    }),
    v.code
  );
}

// How much of this bill the voucher can actually cover — the number the redeem
// modal offers as "fully". Never more than the balance, never negative.
export function redeemableAmount(v, requested) {
  return Math.min(remainingOf(v), clampMoney(requested));
}

// Why this voucher cannot be attached, or "" if it can. One function so the
// message and the decision cannot drift, and so each refusal is DISTINCT —
// "spent", "expired" and "on another booking" are different problems with
// different fixes, and collapsing them into "can't use that voucher" would tell
// staff nothing they can act on.
export function attachRefusal(v, code, bookings, bookingId, now) {
  if (!v) return "No voucher with that number.";
  if (isRedeemedBy(v, bookingId)) return "";           // already settled here — keep it
  const st = voucherState(v, now);
  if (st === "void") return "That voucher has been voided.";
  if (st === "spent") return "That voucher has no balance left.";
  if (st === "expired") return "That voucher has expired.";
  const other = attachedElsewhere(bookings, code, bookingId);
  if (other) return "That voucher is already on " + (other.name || "another booking") + " on " + other.date + ".";
  return "";
}

// ── v18.0.0 session 8 (items 2b, 7): a guest's vouchers follow them ──────────
// Patryk: *"vouchers must follow the guest who is being booked again and suggest
// adding a voucher if the voucher has not been fully redeemed."*
//
// It takes the guest's BOOKINGS rather than a customer or an identity, so this
// module keeps importing nothing: the caller builds that list with
// `matchesIdentity` (customers.js), which keeps ONE identity rule in the app
// rather than a second one growing here.
//
// What comes back is every code that guest has used whose voucher is still
// `open` and is not already on another LIVE booking — `attachedElsewhere`'s
// one-live-booking rule, so a suggestion can never create the conflict the
// picker would refuse a moment later. Newest use first, because the voucher
// somebody is holding is almost always the one from the last visit.
//
// `unsettled` rides along rather than being filtered out: a visit that completed
// carrying a voucher with no ledger entry is money the restaurant has NOT
// recorded, and the right answer is to say so beside the suggestion, not to hide
// the voucher from the person who could settle it.
export function guestOpenVouchers(guestBookings, vouchersByCode, bookings, now, excludeId) {
  const seen = {};
  const out = [];
  (Array.isArray(guestBookings) ? guestBookings : [])
    .filter((b) => b && b.id !== excludeId && normalizeCode(b.voucherCode))
    .slice()
    .sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || "")) ||
      String(b.time || "").localeCompare(String(a.time || "")))
    .forEach((b) => {
      const code = normalizeCode(b.voucherCode);
      if (seen[code]) return;
      seen[code] = true;
      const v = vouchersByCode && vouchersByCode[code];
      if (!v) return;
      if (voucherState(v, now) !== "open") return;
      if (attachedElsewhere(bookings, code, excludeId)) return;
      out.push({
        code,
        voucher: v,
        remaining: remainingOf(v),
        from: b,
        unsettled: isUnsettled(b, vouchersByCode),
      });
    });
  return out;
}

// Vouchers matching a typed query, for the booking form's suggestion dropdown.
//
// It lives here rather than in the picker for `searchCustomers`'s reason: the
// booking form's other two search fields are backed by pure functions in
// `customers.js`, and a third search implemented inline in a component would be
// the one nothing can test.
//
// **Only OPEN vouchers are offered.** A dropdown is a list of things you can
// pick, and picking a void, spent or expired voucher is refused by
// `attachRefusal` a moment later — so offering them is offering a dead end.
// Typing such a number by hand still reaches the specific refusal message,
// which is where that distinction belongs.
//
// An EMPTY query lists them all (newest first) rather than nothing: unlike a
// name or a phone, staff usually hold the physical voucher and may not know
// what to type, and the list is naturally small.
// `now` is a PARAMETER, not a `Date.now()` inside — /code-review v18.0.0. The
// picker freezes one at mount and passes it to `attachRefusal`; a second clock
// read in here made the render impure and let the two disagree at an expiry
// boundary, so a voucher could be listed and then refused on pick, or hidden
// from the list yet attachable by typing. Every other predicate in this file
// already takes `now` for the same reason.
export function searchVouchers(vouchers, query, limit, now) {
  const q = normalizeCode(query);
  const raw = String(query || "").trim().toUpperCase();
  const cap = limit || 20;
  return (Array.isArray(vouchers) ? vouchers : [])
    .filter(function (v) { return voucherState(v, now) === "open"; })
    .filter(function (v) {
      if (!raw) return true;
      // The code is matched NORMALISED, so "abcd 2345" finds ABCD2345 — the
      // same property the attach field itself has. The note is matched on the
      // raw text, because a note is prose and normalising it would strip the
      // spaces out of "Birthday gift".
      return (q && v.code.includes(q)) || (v.notes || "").toUpperCase().includes(raw);
    })
    .sort(function (a, b) { return (b.issuedAt || 0) - (a.issuedAt || 0); })
    .slice(0, cap);
}

// ── One money formatter ─────────────────────────────────────────────────────
// v18.0.0 phase 4. It was a private helper in `VouchersSettings.jsx` and the
// Admin tab's module warning needed the second copy — which is the point at
// which a formatter stops being a local detail. Two call sites rounding money
// differently is a class of defect nothing in this repo can see: `check:style`
// reads literals, the contrast registry reads pairs, and neither can see a
// shape. `currency` comes from `settings/general`; vouchers add no second
// source for it.
export function money(n, currency) {
  return (Math.round(n * 100) / 100) + " " + currency;
}
