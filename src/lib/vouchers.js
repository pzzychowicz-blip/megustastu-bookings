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
    redemptions: src.redemptions && typeof src.redemptions === "object" ? src.redemptions : {},
    updatedAt: Number(src.updatedAt) || 0,
  };
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
