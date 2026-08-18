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
// v17.4.0: findPhoneOverlaps (bottom of file) needs the interval + duration
// primitives. customers.js has no other imports and booking-logic imports only
// from constants, so this direction stays acyclic.
import { overlaps, toMins, getDur } from "./booking-logic";

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

// ── v17.10.0: the SECOND identity key — `guestId` ────────────────────────────
// A phone number is a verified, self-normalising identity, which is why it has
// been the only one since v16.0.0. But plenty of parties never give one, and
// those guests could never become regulars however often they came back: every
// phone-less booking was its own island, by design (see searchGuestsByName's
// never-merge rule, which exists so two different people called "Maria" are not
// silently fused into one customer with one merged no-show count).
//
// `guestId` is the explicit opt-in that rule was missing. It is minted ONLY when
// a human picks an existing phone-less guest from the name dropdown — i.e. when
// someone who can see both bookings says "this is the same person". Absent that,
// nothing merges and the old behaviour is byte-for-byte intact.
//
// Format is `"g" + <seed booking id>`: derived from data both devices already
// have, so two clients minting concurrently produce the SAME id and converge
// (the same reasoning as the recurring-occurrence ids). It is path-safe for the
// same reason `genId()` is.
//
// identityKey — which key does THIS booking answer to? Phone wins when there is
// one, because it is the stronger claim; a `guestId` is the fallback. Note the
// two are not exclusive: a guest who later supplies a number keeps both, which
// is exactly what makes matchCustomerFor's UNION below the right shape.
export function identityKey(b) {
  if (!b) return null;
  if (hasRealPhone(b.phone)) return normalizePhone(b.phone);
  return b.guestId || null;
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
// v17.10.0: a thin alias over matchCustomerFor below. The NAME and SIGNATURE are
// preserved deliberately — the complementarity contract at the top of this file
// requires the WA module to be able to import this exact symbol on merge.
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
  return matchCustomerFor({ phone: phoneKey }, bookings, excludeBookingId);
}

// matchesIdentity — does THIS booking belong to that identity? The union rule
// above, as one predicate, so the matcher and every caller that has to reproduce
// it (App's deleteCustomer) cannot drift apart. `ident` is {phone, guestId};
// either key hitting is a match.
export function matchesIdentity(b, ident) {
  if (!b) return false;
  const o = ident || {};
  // normalizePhone, NOT hasRealPhone — matchCustomerByPhone's original semantics
  // were "any non-empty normalized key", and every caller already gates on
  // hasRealPhone before asking.
  const key = normalizePhone(o.phone);
  // `guestIds` (plural) as well as `guestId`, because a customer can have
  // ABSORBED more than one guest group — see customerIndex's alias pass. Delete
  // must reach every id the row is showing, or "delete all data" leaves some.
  const gids = Array.isArray(o.guestIds) ? o.guestIds : (o.guestId ? [o.guestId] : []);
  if (key && b.phone && normalizePhone(b.phone) === key) return true;
  return !!(b.guestId && gids.indexOf(b.guestId) !== -1);
}

// matchCustomerFor — v17.10.0. The generalised matcher: same return shape as
// matchCustomerByPhone (which now delegates here, keeping its exact name and
// signature for the WA complementarity contract at the top of this file), but it
// matches on the phone key OR the guestId.
//
// The OR is a UNION, not a fallback, and that is the load-bearing part. A guest
// who books three times without a phone and then gives one on the fourth has
// bookings carrying only a guestId and bookings carrying both; matching either
// key keeps them one person. A "phone if present, else guestId" rule would split
// them at exactly the moment they became easiest to identify.
export function matchCustomerFor(ident, bookings, excludeBookingId) {
  const o = ident || {};
  const key = normalizePhone(o.phone);
  const gid = o.guestId || "";
  if ((!key && !gid) || !Array.isArray(bookings)) return null;
  const matches = bookings.filter(function (b) { return matchesIdentity(b, o); });
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

// customerIndex — build the full identity→customer map from the bookings list.
// One pass; feeds the phone autocomplete and the Settings → Customers tab.
//
// v17.10.0: keyed on `identityKey`, not on the phone alone. A guest who was
// JOINED through the name dropdown has a `guestId` and is therefore a customer
// with a visit count and a no-show record like any other — leaving them out was
// the one place `guestId` did not reach, so the feature could group a guest's
// bookings everywhere EXCEPT the screen that lists customers. A phone-less
// booking with no `guestId` still has no identity and is still skipped, which is
// the never-merge rule (searchGuestsByName) holding exactly where it should.
//
// Each entry:
//   key        — the map key: the normalized phone, else the guestId
//   phone      — the normalized phone, or "" for a guest-id entry
//   guestId    — the guestId, or null for a phone entry
//   rawPhone   — the most recent booking's phone as typed (display; "" for a guest)
//   name       — most recent booking's name
//   visits     — completed bookings (the "regular" measure)
//   noShowCount— bookings flagged no-show (isNoShow)
//   latestDate — most recent booking date
//   bookings   — all of them, sorted by date desc
//
// A consumer that needs a phone must check for one: `phone` is "" on a guest
// entry rather than absent, so string operations on it are safe either way.
// guestPhoneAlias — guestId → the phone it has since been attached to.
//
// v17.10.0 /code-review fix. `identityKey` is "phone if real, else guestId",
// which is exactly the fallback rule matchCustomerFor's comment above calls out
// as splitting a guest "at the moment they became easiest to identify" — and
// customerIndex/noShowMap were keying on it. A guest joined by guestId who later
// gives a number has bookings carrying only the guestId and bookings carrying
// both, so they came out as TWO customers: one with the number, one still
// labelled "No phone · linked guest", each with half the visits, and deleting
// either left the other half's name and notes on the record.
//
// So before keying anything, learn which guest groups have acquired a phone.
// Any booking carrying BOTH keys is the evidence, and the two are then one
// customer under the phone — the stronger claim, as identityKey already says.
//
// The tie-break matters: a guestId seen with two different phones means the join
// was wrong (two people merged, then both gave numbers). Nothing here can tell
// which is right, so it takes the lexicographically smallest — an arbitrary rule,
// but a DETERMINISTIC one, so every device derives the same map from the same
// bookings and no two clients disagree about who a customer is.
function guestPhoneAlias(bookings) {
  const alias = {};
  bookings.forEach(function (b) {
    if (!b || !b.guestId || !hasRealPhone(b.phone)) return;
    const phone = normalizePhone(b.phone);
    if (!alias[b.guestId] || phone < alias[b.guestId]) alias[b.guestId] = phone;
  });
  return alias;
}

export function customerIndex(bookings) {
  const map = {};
  if (!Array.isArray(bookings)) return map;
  const alias = guestPhoneAlias(bookings);
  bookings.forEach(function (b) {
    if (!b) return;
    const phone = hasRealPhone(b.phone) ? normalizePhone(b.phone) : "";
    // An anonymized booking keeps its dates and status for the stats and loses
    // everything else; deleteCustomer clears its guestId, so this only guards
    // against a stray one. A phone it cannot have — anonymizing empties it.
    if (!phone && b.anonymized) return;
    const key = phone || alias[b.guestId] || b.guestId || "";
    if (!key) return;
    if (!map[key]) map[key] = { key: key, phone: key === phone ? phone : (alias[b.guestId] ? key : ""), guestId: null, guestIds: [], rawPhone: "", name: b.name || "", visits: 0, noShowCount: 0, latestDate: "", bookings: [] };
    if (b.guestId && map[key].guestIds.indexOf(b.guestId) === -1) map[key].guestIds.push(b.guestId);
    map[key].bookings.push(b);
  });
  Object.keys(map).forEach(function (key) {
    const c = map[key];
    // `guestId` stays a scalar for the callers that only ever see one; `guestIds`
    // is the truth, and is what delete reaches through.
    c.guestId = c.phone ? null : (c.guestIds[0] || null);
    c.bookings.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
    c.name = c.bookings[0].name || "";
    if (c.phone) c.rawPhone = (c.bookings.find(function (b) { return hasRealPhone(b.phone); }) || c.bookings[0]).phone || "";
    c.latestDate = c.bookings[0].date || "";
    c.visits = c.bookings.filter(function (b) { return b.status === "completed"; }).length;
    c.noShowCount = c.bookings.filter(isNoShow).length;
  });
  return map;
}

// noShowMap — lightweight {identityKey: noShowCount} map for the timeline/
// list repeat-offender markers (one pass, no per-customer sorting — cheaper
// than customerIndex when only the counts are needed).
// v17.10.0: keyed on identityKey rather than the phone alone, so a JOINED
// phone-less repeat offender is flagged too. An unjoined phone-less booking has
// no identity, so it is skipped exactly as before — read this map through
// `noShowMap(bookings)[identityKey(b)] || 0` at every call site.
export function noShowMap(bookings) {
  const map = {};
  if (!Array.isArray(bookings)) return map;
  // Same alias pass as customerIndex (/code-review fix): a guest who later gave
  // a number had their no-shows split across two keys, so the repeat-offender
  // flag — which trips at 2 — never fired even though the booking form's chip,
  // which unions the keys, said 2.
  const alias = guestPhoneAlias(bookings);
  bookings.forEach(function (b) {
    if (!b || !isNoShow(b)) return;
    const key = hasRealPhone(b.phone) ? normalizePhone(b.phone) : (alias[b.guestId] || b.guestId || "");
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  });
  // Every call site reads this as `nsMap[identityKey(b)]`, and identityKey on a
  // phone-LESS booking returns its raw guestId — which is not the key its count
  // now lives under. Mirror the total onto the alias so both spellings resolve
  // without every caller having to learn about aliasing.
  Object.keys(alias).forEach(function (gid) {
    if (map[alias[gid]] != null) map[gid] = map[alias[gid]];
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
    if (!b || b.anonymized) return false; // v17.0.0: anonymized ("Data removed") bookings never match
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
    // v17.10.0: `c.phone` is "" on a guest-id entry, so a digits query simply
    // never matches one — which is right: they have no number to search by.
    const phoneHit = qDigits.length >= 3 && !!c.phone && c.phone.replace(/[^\d]/g, "").indexOf(qDigits) !== -1;
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
//   • phone-LESS guests → ONE row per GUEST, where "guest" means a shared
//                        `guestId` (v17.10.0) and otherwise still means ONE ROW
//                        PER BOOKING.
//
// v17.10.0 — the never-merge rule is unchanged in substance, and it is worth
// being precise about why. Two different people called "Maria" with no phone
// numbers must never collapse into one customer with one merged visit count and
// one merged no-show record; nothing in the data can tell them apart, so the
// only safe default is to keep them separate. What changed is that a HUMAN can
// now say otherwise: picking an existing phone-less guest from this very
// dropdown stamps both bookings with a shared `guestId`, and rows sharing one
// are the only phone-less rows that merge. Merging is opt-in, per guest, by
// someone who could see both bookings.
//
// Row shape (uniform so the dropdown renders both): { key, name, rawPhone, phone,
// latestDate, isPhoneless, guestId, count, latest } where `latest` is the booking
// to Book-Again prefill from and `count` is how many bookings the row represents
// (1 for an unjoined booking — the dropdown shows it only when >1, so a merge is
// visible rather than silent). Sorted most-recent-first, capped at `limit`
// (default 6).
export function searchGuestsByName(bookings, index, query, limit) {
  const max = limit || 6;
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2 || !Array.isArray(bookings)) return [];
  const rows = [];
  // Phone customers (from the phone-keyed index) whose name matches.
  Object.keys(index || {}).forEach(function (key) {
    const c = index[key];
    // v17.10.0: the index now also holds JOINED phone-less guests. This pass is
    // the phone tier; the guest tier is rebuilt from the bookings below (it
    // needs the ungrouped ones too), so taking them here would emit both.
    if (!c.phone) return;
    if (c.name && c.name.toLowerCase().indexOf(q) !== -1) {
      rows.push({ key: "p:" + c.phone, name: c.name, rawPhone: c.rawPhone, phone: c.phone, latestDate: c.latestDate, isPhoneless: false, guestId: null, count: c.bookings.length, latest: c.bookings[0] });
    }
  });
  // Phone-LESS bookings whose name matches. Ones carrying a guestId are grouped
  // into a single row; the rest stay one row each, exactly as before.
  const groups = {};
  const alias = guestPhoneAlias(bookings);
  bookings.forEach(function (b) {
    if (!b || b.anonymized || hasRealPhone(b.phone)) return; // v17.0.0: skip anonymized
    if (!b.name || b.name.toLowerCase().indexOf(q) === -1) return;
    // A guest group that has since acquired a phone IS the phone customer the
    // pass above already emitted (/code-review fix) — offering it again as a
    // separate "no phone" row would show one person twice and let staff pick the
    // weaker half.
    if (b.guestId && alias[b.guestId]) return;
    if (b.guestId) {
      const g = groups[b.guestId] || (groups[b.guestId] = []);
      g.push(b);
      return;
    }
    rows.push({ key: "b:" + b.id, name: b.name, rawPhone: "", phone: null, latestDate: b.date || "", isPhoneless: true, guestId: null, count: 1, latest: b });
  });
  Object.keys(groups).forEach(function (gid) {
    // Most recent first, so `latest` is the booking to prefill from and the row
    // carries the newest name the guest was written under.
    const g = groups[gid].slice().sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
    rows.push({ key: "g:" + gid, name: g[0].name, rawPhone: "", phone: null, latestDate: g[0].date || "", isPhoneless: true, guestId: gid, count: g.length, latest: g[0] });
  });
  rows.sort(function (a, b) { return (b.latestDate || "").localeCompare(a.latestDate || ""); });
  return rows.slice(0, max);
}

// ── Same-phone double-booking detection (v17.4.0) ─────────────────────────────
// Does this customer already have an OVERLAPPING booking on the same date?
// Identity is the normalized phone (the primitive above — one phone-identity
// source), and the interval test is booking-logic's exported `overlaps`, so the
// half-open rule is never re-implemented.
//
// Excluded: the booking being edited (`excludeId`), cancelled and completed
// bookings (a finished earlier visit is not a double-booking), and anything
// without a real phone. Advisory by design — the caller must NOT block a save
// on this: a genuine party does book twice (two tables at once, a party
// splitting), so staff decide.
//
// Returns the conflicting bookings, earliest first.
export function findPhoneOverlaps(bookings, opts) {
  const o = opts || {};
  if (!Array.isArray(bookings) || !hasRealPhone(o.phone) || !o.date || !o.time) return [];
  const key = normalizePhone(o.phone);
  const s = toMins(o.time);
  const e = s + (Number(o.dur) || getDur(Number(o.size) || 2));
  return bookings
    .filter(function (b) {
      if (!b || b.id === o.excludeId || b.date !== o.date) return false;
      if (b.status === "cancelled" || b.status === "completed") return false;
      if (normalizePhone(b.phone) !== key) return false;
      const bs = toMins(b.time);
      return overlaps(s, e, bs, bs + (b.duration || 90));
    })
    .sort(function (a, b) { return toMins(a.time) - toMins(b.time); });
}
