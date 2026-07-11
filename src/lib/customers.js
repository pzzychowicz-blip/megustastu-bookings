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

// searchBookings — match INDIVIDUAL bookings against a typed query (v16.3.0),
// across ALL dates (the global-search panel). Same query semantics as
// searchCustomers: digits (≥3) → phone substring match; non-digit text →
// case-insensitive name substring. Results sorted UPCOMING-first (date ≥ today,
// ascending) then PAST (descending), capped at `limit` (default 30). `todayStr`
// is passed in so the caller controls "today" (all-UTC ISO date string).
export function searchBookings(bookings, query, todayStr, limit) {
  const max = limit || 30;
  const q = String(query || "").trim();
  if (!q || !Array.isArray(bookings)) return [];
  const qDigits = q.replace(/[^\d]/g, "");
  const qName = q.toLowerCase();
  const useDigits = qDigits.length >= 3;
  const out = bookings.filter(function (b) {
    if (!b) return false;
    if (useDigits) return b.phone && normalizePhone(b.phone).replace(/[^\d]/g, "").indexOf(qDigits) !== -1;
    return b.name && b.name.toLowerCase().indexOf(qName) !== -1;
  });
  const today = todayStr || "";
  out.sort(function (a, b) {
    const au = (a.date || "") >= today, bu = (b.date || "") >= today;
    if (au !== bu) return au ? -1 : 1;           // upcoming block before past block
    if (au) return (a.date || "").localeCompare(b.date || "") || (a.time || "").localeCompare(b.time || "");   // upcoming asc
    return (b.date || "").localeCompare(a.date || "") || (b.time || "").localeCompare(a.time || "");            // past desc
  });
  return out.slice(0, max);
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

// searchGuestsByName — the booking-form NAME autocomplete (v16.4.0). Matches
// guests by NAME (case-insensitive substring) and returns a unified, ordered
// list of dropdown rows spanning BOTH identity tiers:
//   • phone customers  → ONE row per phone (a verified single identity, from the
//                        prebuilt phone index) — `isPhoneless:false`.
//   • phone-LESS guests → ONE row PER BOOKING (NO merging) — two different people
//                        sharing a name never collapse into one; each row carries
//                        its own date so duplicates are distinguishable.
// Row shape (uniform so the dropdown renders both): { key, name, rawPhone, phone,
// latestDate, isPhoneless, latest } where `latest` is the booking to Book-Again
// prefill from. Sorted most-recent-first, capped at `limit` (default 6).
export function searchGuestsByName(bookings, index, query, limit) {
  const max = limit || 6;
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2 || !Array.isArray(bookings)) return [];
  const rows = [];
  // Phone customers (from the phone-keyed index) whose name matches.
  Object.keys(index || {}).forEach(function (key) {
    const c = index[key];
    if (c.name && c.name.toLowerCase().indexOf(q) !== -1) {
      rows.push({ key: "p:" + c.phone, name: c.name, rawPhone: c.rawPhone, phone: c.phone, latestDate: c.latestDate, isPhoneless: false, latest: c.bookings[0] });
    }
  });
  // Phone-LESS bookings whose name matches — one row each, never merged.
  bookings.forEach(function (b) {
    if (!b || hasRealPhone(b.phone)) return;
    if (b.name && b.name.toLowerCase().indexOf(q) !== -1) {
      rows.push({ key: "b:" + b.id, name: b.name, rawPhone: "", phone: null, latestDate: b.date || "", isPhoneless: true, latest: b });
    }
  });
  rows.sort(function (a, b) { return (b.latestDate || "").localeCompare(a.latestDate || ""); });
  return rows.slice(0, max);
}
