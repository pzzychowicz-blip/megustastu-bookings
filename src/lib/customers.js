// src/lib/customers.js
//
// v16.0.0 — Customer identity layer (pure functions, no React, no DOM).
//
// Bookings are phone-number-keyed: a "customer" is DERIVED from the bookings
// list by normalized phone — there is NO separate customers collection. This
// is deliberate: single source of truth, zero migration, and it matches the
// WhatsApp module's model exactly.
//
// ── COMPLEMENTARITY CONTRACT (WhatsApp module) ────────────────────────────────
// normalizePhone / formatPhone / matchCustomerByPhone were born in the WA
// sandbox's src/lib/whatsapp.js and are ported here VERBATIM (same names, same
// signatures, same semantics). When the WA module merges into this app, its
// whatsapp.js must DELETE its own copies and import them from this file — the
// two features coexist on one phone-identity primitive, never diverge.
// (matchCustomerByPhone here is a strict SUPERSET: it adds noShowCount /
// noShowBookings to the return object; existing WA consumers ignore them.)

// Phone normalisation: strip all non-digits except a single leading +.
// Used for matching customers across bookings (and WA conversations) — the
// same normaliser must run everywhere so keys line up.
export function normalizePhone(p) {
  if (!p) return "";
  const s = String(p).trim();
  const hasPlus = s.charAt(0) === "+";
  const digits = s.replace(/[^\d]/g, "");
  return (hasPlus ? "+" : "") + digits;
}

// Pretty display phone (inserts a space after the country code for readability).
export function formatPhone(p) {
  if (!p) return "";
  const n = normalizePhone(p);
  if (n.length < 4) return n;
  if (n.charAt(0) === "+") return n.slice(0, 3) + " " + n.slice(3);
  return n;
}

// hasRealPhone — a phone field with actual digits (not empty, not the lone "+"
// the phone input auto-inserts on focus). Gate for every phone-keyed feature.
export function hasRealPhone(p) {
  return normalizePhone(p).replace(/\D/g, "").length >= 3;
}

// isNoShow — did this booking end as a no-show?
// Primary signal: the v16.0.0 `noShow` boolean set by doCancelBooking.
// Fallback: the pre-v16 record was only a history entry {action:"no show"} (+
// a notes append) — checking history BACKFILLS all legacy data with zero
// migration. Notes are NOT checked (free text, staff-editable).
export function isNoShow(b) {
  if (!b) return false;
  if (b.noShow === true) return true;
  return Array.isArray(b.history) && b.history.some(function (h) { return h && h.action === "no show"; });
}

// matchCustomerByPhone — look up a customer by phone across the bookings list.
// Returns null if there's no match. Otherwise:
//   name            — most recent booking's name (for display)
//   count           — total bookings matched (all statuses, incl. the linked one)
//   latestDate      — most recent booking date
//   all             — all matched bookings, sorted by date desc
//   regularCount    — bookings that count toward "regular" status: completed AND
//                     not the currently linked booking. Confirmed/cancelled don't
//                     count. Gates the "Regular · X past visits" chip.
//   regularBookings — those bookings, sorted desc by date.
//   noShowCount     — bookings flagged as no-show (isNoShow), excluding the
//                     linked booking. Gates the no-show warning chips (v16.0.0).
//   noShowBookings  — those bookings, sorted desc by date.
// excludeBookingId is the currently-open/linked booking (the form's editId, or
// a WA conversation's acceptedBookingId), excluded so a customer's own current
// booking never counts toward its chips.
export function matchCustomerByPhone(phoneKey, bookings, excludeBookingId) {
  if (!phoneKey || !Array.isArray(bookings)) return null;
  const key = normalizePhone(phoneKey);
  if (!key) return null;
  const matches = bookings.filter(function (b) { return b && b.phone && normalizePhone(b.phone) === key; });
  if (!matches.length) return null;
  const sorted = matches.slice().sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
  const regular = sorted.filter(function (b) { return b.status === "completed" && (!excludeBookingId || b.id !== excludeBookingId); });
  const noShows = sorted.filter(function (b) { return isNoShow(b) && (!excludeBookingId || b.id !== excludeBookingId); });
  return {
    name: sorted[0].name,
    count: matches.length,
    latestDate: sorted[0].date,
    all: sorted,
    regularCount: regular.length,
    regularBookings: regular,
    noShowCount: noShows.length,
    noShowBookings: noShows,
  };
}

// customerIndex — build the full phone→customer map from the bookings list.
// One pass; feeds the phone autocomplete, the timeline/list no-show markers,
// and the Settings → Customers tab. Bookings without a real phone are skipped
// (they simply have no customer identity). Each entry:
//   phone      — the normalized key (also the map key)
//   rawPhone   — the most recent booking's phone as typed (display)
//   name       — most recent booking's name
//   visits     — completed bookings (the "regular" measure)
//   noShowCount— bookings flagged no-show (isNoShow)
//   latestDate — most recent booking date
//   bookings   — all of them, sorted by date desc
export function customerIndex(bookings) {
  const map = {};
  if (!Array.isArray(bookings)) return map;
  bookings.forEach(function (b) {
    if (!b || !hasRealPhone(b.phone)) return;
    const key = normalizePhone(b.phone);
    if (!map[key]) map[key] = { phone: key, rawPhone: b.phone, name: b.name || "", visits: 0, noShowCount: 0, latestDate: "", bookings: [] };
    map[key].bookings.push(b);
  });
  Object.keys(map).forEach(function (key) {
    const c = map[key];
    c.bookings.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
    c.name = c.bookings[0].name || "";
    c.rawPhone = c.bookings[0].phone;
    c.latestDate = c.bookings[0].date || "";
    c.visits = c.bookings.filter(function (b) { return b.status === "completed"; }).length;
    c.noShowCount = c.bookings.filter(isNoShow).length;
  });
  return map;
}

// noShowMap — lightweight {normalizedPhone: noShowCount} map for the timeline/
// list repeat-offender markers (one pass, no per-customer sorting — cheaper
// than customerIndex when only the counts are needed).
export function noShowMap(bookings) {
  const map = {};
  if (!Array.isArray(bookings)) return map;
  bookings.forEach(function (b) {
    if (!b || !hasRealPhone(b.phone) || !isNoShow(b)) return;
    const key = normalizePhone(b.phone);
    map[key] = (map[key] || 0) + 1;
  });
  return map;
}

// searchCustomers — match customers against a typed query.
// Digits in the query → substring match on the normalized phone (so "600" finds
// "+34 600 123 456" no matter the formatting); non-digit text → case-insensitive
// substring match on the name. Both present → either matches. Results sorted by
// most recent visit first, capped at `limit` (default 5, the dropdown size).
export function searchCustomers(index, query, limit) {
  const max = limit || 5;
  const q = String(query || "").trim();
  if (!q) return [];
  const qDigits = q.replace(/[^\d]/g, "");
  const qName = q.toLowerCase();
  const out = [];
  Object.keys(index).forEach(function (key) {
    const c = index[key];
    const phoneHit = qDigits.length >= 3 && c.phone.replace(/[^\d]/g, "").indexOf(qDigits) !== -1;
    const nameHit = qDigits.length < 3 && c.name && c.name.toLowerCase().indexOf(qName) !== -1;
    if (phoneHit || nameHit) out.push(c);
  });
  out.sort(function (a, b) { return (b.latestDate || "").localeCompare(a.latestDate || ""); });
  return out.slice(0, max);
}
