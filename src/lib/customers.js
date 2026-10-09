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

// Phone normalisation: strip all non-digits, keeping a single + when it comes
// ahead of them (v17.16.3 — "leading" used to mean index 0, which split
// "(+34) 600…" from "+34 600…"; see the note on the function).
// Used for matching customers across bookings (and WA conversations) — the
// same normaliser must run everywhere so keys line up.
// v17.4.0: findPhoneOverlaps (bottom of file) needs the interval + duration
// primitives. customers.js has no other imports and booking-logic imports only
// from constants, so this direction stays acyclic.
// WA sandbox: the explicit ".js" extension is LOAD-BEARING — customers.js is
// pulled into the Node backend chain (whatsapp.js re-exports its phone
// primitives, and api/_lib/inbound-core.js imports whatsapp.js), and Node ESM
// does not resolve extensionless specifiers. Vite is indifferent to it.
import { overlaps, toMins, getDur } from "./booking-logic.js";
import { dialOf } from "./phone-countries.js";
import { isNoShow } from "./booking-fields.js";
import { cleanTagIds, cleanTagEdits, sameTagIds, unionTagIds, editTagIds, tagLabels } from "./tags.js";

export function normalizePhone(p) {
  if (!p) return "";
  const s = String(p).trim();
  const digits = s.replace(/[^\d]/g, "");
  // v17.16.3 (CT-2B-04): the "+" counts wherever it sits AHEAD OF THE DIGITS,
  // not only at index 0. It used to be `s.charAt(0) === "+"`, so
  // "(+34) 600 123 456" normalised to "34600123456" while "+34 600 123 456"
  // gave "+34600123456" — two identities for one person, splitting their
  // visits, no-show count and history, and leaving "Delete customer & all
  // data" reaching only the half you clicked. Every other kind of
  // punctuation was already stripped correctly; only the plus's POSITION was
  // wrong, so a bracketed country code — which is how a lot of people write
  // one — was the whole of the bug.
  //
  // A "+" AFTER a digit is deliberately still ignored: a country-code marker
  // precedes the number, and anything later is something else (an extension,
  // a typo, two numbers in one field). So this only ever ADDS a "+" where the
  // old code dropped one — never removes one — which means it can merge two
  // records that were one customer and can never split a customer in two.
  // That direction is what makes it safe to change a key everything is
  // derived from; it is pinned in tests/customers.test.js.
  const plusAt = s.indexOf("+");
  const firstDigit = s.search(/\d/);
  const hasPlus = plusAt !== -1 && (firstDigit === -1 || plusAt < firstDigit);
  return (hasPlus ? "+" : "") + digits;
}

// Pretty display phone (inserts a space after the country code for readability).
//
// v18.2.0 phase 50 (round 3's C-4): the ONE way a phone is shown, "+34
// 612345678", and the code is the country's REAL calling code.
// It split after two digits whatever the code was, so "+1 212 555 0123" read
// "+12 125550123" and "+353 87 123 4567" "+35 3871234567" — a wrong country
// on screen. `dialOf` (phone-countries.js, the country picker's own table,
// longest code first) finds the code; a number whose code is not in the table
// is shown whole rather than cut in a made-up place, and one stored without a
// code is its digits. The List and the Day sheet printed the stored text raw
// (three shapes on one List screen), and go through this now too.
export function formatPhone(p) {
  if (!p) return "";
  const n = normalizePhone(p);
  if (n.length < 4) return n;
  if (n.charAt(0) !== "+") return n;
  const dial = dialOf(n);
  return dial ? "+" + dial + " " + n.slice(1 + dial.length) : n;
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

// stampGuestSeed — write the newly-minted `guestId` BACK onto the booking it was
// derived from (v17.10.0; moved out of App.jsx by the /code-review pass).
//
// Picking an unjoined phone-less guest from the name dropdown mints a `guestId`
// into the draft and records that guest's booking in `guestSeed`. This is the
// other half: the source booking gets the same id, and the two become one
// customer. It lives here rather than in App because it decides a PERMANENT,
// un-undoable identity link and nothing in the UI can unpick one — CLAUDE.md's
// rule is that logic the restaurant acts on belongs in `lib/` where a test can
// reach it, and the stale-guestId defect this same review found lived in exactly
// this seam.
//
// It is a pure `(list, draft) → list`, called INSIDE doSave's buildNext /
// applyBase, so the source and the new booking ride ONE saveBookings call: the
// v15.5.0 per-booking diff-write patches them together and the per-$id CAS
// covers both. A separate write would be a second thing to fail.
//
// `!b.guestId` is what makes a replay safe — a retry on fresh data finds the
// stamp already there and leaves it alone — and it also means a booking already
// belonging to another group is never silently re-homed.
// v17.16.4 (CT-2B-09): a call that stamps NOTHING returns the array it was
// given. Both early returns above already did; the `.map` did not, so the two
// cases where the pass reaches the list and changes none of it — the seed
// booking already carries a `guestId` (the replay-safety guard on the line
// below, i.e. every retry), or `guestSeed` names a booking no longer in `prev`
// — handed back a fresh array saying "something changed" when nothing had.
// That is the exact shape v17.14.0 removed from `bookingsAfterAction` and made
// a stated contract, in the same save path. Harmless today only because the
// write diff compares CONTENT: `stampGuestSeed` runs inside doSave's
// buildNext/applyBase, whose own `.map`/`.filter` rebuild the array regardless,
// so the identity never reaches `persist`. It is fixed anyway because the next
// caller may gate on identity — which is what the contract is for — and because
// a helper that cannot answer "did I do anything" makes that caller impossible
// to write correctly. `stamped` is a flag rather than a content compare because
// this pass KNOWS structurally whether it wrote: there is nothing to diff.
export function stampGuestSeed(list, f) {
  if (!Array.isArray(list) || !f || !f.guestSeed || !f.guestId) return list;
  var stamped = false;
  var out = list.map(function (b) {
    if (!b || b.id !== f.guestSeed || b.guestId) return b;
    stamped = true;
    return Object.assign({}, b, { guestId: f.guestId });
  });
  return stamped ? out : list;
}

// resolveGuestId — which guest group does the booking being SAVED belong to?
// v17.16.6 (CT-2B-08). `stampGuestSeed` above is the other half of one decision
// and it only ever answers half of it: it refuses to re-home a seed that already
// carries an id, which is right, and then nothing reconsiders the id the DRAFT is
// carrying. So the two halves could disagree.
//
// The sequence. Picking an unjoined phone-less guest from the name dropdown mints
// `guestId = "g" + <that booking's id>` into the draft and records the booking in
// `guestSeed` (BookingFormModal). Between that moment and Save, another device can
// join the same guest — through a DIFFERENT booking of theirs, which is the only
// way the ids differ, since the mint is deterministic in the seed's id. The seed
// now carries `"g"+<other id>`; `stampGuestSeed` correctly leaves it alone; and
// the new booking was still written with the id minted at pick time. It lands in a
// group of ONE, beside the group the operator meant to join, and **nothing on
// screen distinguishes that from success** — which is the whole reason this is
// worth a function rather than a comment.
//
// Resolving against the seed's LIVE state is what closes it, and it has to happen
// where `prev` is: inside doSave's `buildNext`, not on the `nb` object built once
// above it. That also makes a held/retried write correct for free — the replay
// re-reads a `prev` that may have acquired the id since the first attempt.
//
// The seed WINS on principle, not for convenience: it is the existing group, and
// this booking is the newcomer asking to be let in. Adopting in the other
// direction would re-home a booking already joined to somebody, which is exactly
// what `stampGuestSeed`'s `!b.guestId` guard exists to prevent.
//
// No seed (`bookAgain` on a booking that already had an id; an ordinary phone
// booking; an edit, where `openEdit` sets `guestSeed: null`) means there is
// nothing to reconcile against and the draft's own value stands. A seed that is
// no longer in `list` — deleted meanwhile — is the same case: the mint stands
// because there is no group left to join.
export function resolveGuestId(list, f) {
  if (!f) return null;
  if (!f.guestId || !f.guestSeed) return f.guestId || null;
  var seed = (Array.isArray(list) ? list : []).find(function (b) {
    return b && b.id === f.guestSeed;
  });
  return (seed && seed.guestId) ? seed.guestId : f.guestId;
}

// isNoShow lives in booking-fields.js (v18.3.5), so booking-logic.js can ask it
// too; re-exported here, where its callers import it.
export { isNoShow };

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
  // v17.16.5 (CT-2B-05): a booking carrying its OWN real phone is never reached
  // through a guestId. `customerIndex` keys on the phone FIRST, so such a
  // booking is already displayed as a different customer with a different
  // number — and the guestId union made deleting either row anonymise both.
  // The list said two people and the delete acted on one, which is the whole of
  // the defect: a wrong join is invisible, so the operator has no way to know
  // that "Delete customer & all data" on Ana is about to take Bea's record too.
  //
  // What this does NOT do is protect the phone-LESS bookings in the group, and
  // that is the deliberate half. For a CORRECT join they are the same person and
  // "all data" has to mean all of it; for a wrong one they stay visible on the
  // row, under a name a human can read, which is the case somebody can still
  // catch. The alternative — matching only a booking's own key — would leave a
  // genuinely phone-less guest's earlier bookings behind with their name and
  // notes intact, breaking the promise on every correct join to guard against
  // the rare wrong one.
  //
  // `hasRealPhone`, not `b.phone`: the form seeds the field with the dial
  // prefix, so "+34" means no phone rather than a different one, and reading it
  // as different would exclude bookings that belong to the customer.
  //
  // **This predicate is not only the delete's** (/code-review). `matchCustomerFor`
  // below filters with it, so the same exclusion decides the booking form's
  // "Regular · N past visits" and no-show chips: after a mis-join those counts
  // stop including a booking that carries a different real number. That is the
  // RIGHT answer and the one `customerIndex` and `noShowMap` already give — both
  // key a booking with its own phone under that phone — so the three now agree
  // where before the chips and the delete were the two that did not. It is
  // written down because the change was designed as a delete-scope fix, and the
  // next person editing this for a delete-scope reason would otherwise move what
  // the form asserts about a customer without knowing it.
  if (hasRealPhone(b.phone) && key && normalizePhone(b.phone) !== key) return false;
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

// DEFAULT_REGULAR_MIN — completed visits a customer needs before the chip calls
// them a Regular. Lives HERE, in the customer-identity layer, because that is
// what it describes; settings/general's seed imports it rather than restating 2
// (useGeneralSettings.js), as does the booking form's prop default. Keep it in
// this file and not in the hook: customers.js is also imported by the Node API
// side via whatsapp.js, which must never pull in firebase.
export const DEFAULT_REGULAR_MIN = 2;

// regularChipLabel — the text of the green/teal "Regular · N past visits" chip.
// ONE implementation because the chip renders in two places: the booking form
// (BookingFormModal) and the WA conversation header (ConversationView). They had
// drifted — the WA copy printed "Regular · " at ANY count, ignoring the
// settings/general `regularMin` threshold the form respects — so the same
// customer could read differently in the two panes. Callers add their own ▸/▾.
export function regularChipLabel(count, regularMin) {
  const n = count || 0;
  const plural = n === 1 ? " past visit" : " past visits";
  return (n >= (regularMin || DEFAULT_REGULAR_MIN) ? "Regular · " : "") + n + plural;
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

// ── v18.5.0: GUEST TAGS ──────────────────────────────────────────────────────
// A guest tag (an allergy, VIP) is about the PERSON, and a person in this app is
// derived from their bookings, with no record of their own. So their tags are
// held the way their visits and no-shows are: on bookings.
//
// THE MODEL. A booking may carry a STATEMENT of its guest's tags: `guestTags`
// (ids, see lib/tags.js) and `guestTagsAt` (when it was made, ms). The
// customer's tags are the NEWEST statement among their bookings. Nearly every
// booking makes none (`guestTagsAt: 0`), so changing a guest's tags writes ONE
// booking, and a new booking for a known guest shows their tags without holding
// any.
//
// Why a stamp and not "copy the tags onto every booking": a copy has no answer
// when two copies disagree (a device offline, a week's standing bookings made by
// the generator), and it rewrites every booking a regular has on each change.
//
// "Their bookings" is the customer as `customerIndex` and `noShowMap` file it:
// a booking's own real phone, else the phone its guest group has since acquired
// (`guestPhoneAlias`), else its `guestId`. A booking that is nobody's (no
// phone, not joined) is its own guest: its tags are its own statement.

// The key a booking's CUSTOMER is filed under; "" for a booking that is nobody's.
// `known` is the list's alias map when the caller has already built it, so the
// pass over every booking is made once.
function customerKeyFn(bookings, known) {
  const alias = known || guestPhoneAlias(Array.isArray(bookings) ? bookings : []);
  return function (b) {
    if (!b) return "";
    if (hasRealPhone(b.phone)) return normalizePhone(b.phone);
    // customerIndex's rule: an anonymised booking is nobody's.
    if (b.anonymized) return "";
    return alias[b.guestId] || b.guestId || "";
  };
}

function states(b) { return !!b && Number(b.guestTagsAt) > 0; }

// Is statement `a` newer than `b`? The id breaks a tie, so every device picks
// the same one from the same bookings.
function newerStatement(a, b) {
  const x = Number(a.guestTagsAt), y = Number(b.guestTagsAt);
  return x > y || (x === y && String(a.id) > String(b.id));
}

function newestStatement(list, keyOf, key) {
  let top = null;
  list.forEach(function (b) {
    if (!states(b) || keyOf(b) !== key) return;
    if (!top || newerStatement(b, top)) top = b;
  });
  return top;
}

// guestTagMap — {customer key: tag ids}, one pass, for every surface that
// shows a booking's guest tags. Read it through `guestTagsOf(b, map)`, never by
// hand: like `noShowMap`, each total is mirrored onto the guest ids folded into
// a phone, and a booking that is nobody's is not in it at all.
export function guestTagMap(bookings) {
  const map = {};
  if (!Array.isArray(bookings)) return map;
  const alias = guestPhoneAlias(bookings);
  const keyOf = customerKeyFn(bookings, alias);
  const top = {};
  bookings.forEach(function (b) {
    if (!states(b)) return;
    const key = keyOf(b);
    if (!key) return;
    if (!top[key] || newerStatement(b, top[key])) top[key] = b;
  });
  Object.keys(top).forEach(function (key) { map[key] = cleanTagIds(top[key].guestTags); });
  Object.keys(alias).forEach(function (gid) {
    if (map[alias[gid]] != null) map[gid] = map[alias[gid]];
  });
  return map;
}

// guestTagsOf — the guest tags to show for booking `b`: its customer's, or its
// own statement when it is nobody's.
export function guestTagsOf(b, map) {
  if (!b) return [];
  const anon = b.anonymized && !hasRealPhone(b.phone);
  const key = anon ? null : identityKey(b);
  if (key) return (map && map[key]) || [];
  return states(b) ? cleanTagIds(b.guestTags) : [];
}

// guestTagBase — the guest tags a form on booking `id` (null: a new booking)
// STARTS from, before what was tapped in it: what `editTagIds` is applied to,
// on screen and at Save, so the two cannot disagree. `ident` is the draft's
// identity as the save will write it: `{ phone, guestId, guestSeed }`.
//
//   • a new booking: the tags of the customer the draft names, or none;
//   • an edit that keeps its guest: that guest's tags;
//   • an edit that MOVES the booking to another guest (the phone was changed):
//     the tags it had, plus the tags of the customer it is joining. Nothing lit
//     goes dark because a number was corrected, and what a known customer
//     already has is added where it can be seen and tapped off.
//
// "Joining" leaves out the bookings that come along with it (a guest group
// that follows the booking to its new phone): their statements are older
// versions of the tags it already has, and adding them back would undo a
// removal.
export function guestTagBase(list, id, ident) {
  const all = Array.isArray(list) ? list : [];
  const o = ident || {};
  const orig = id == null ? null : (all.find(function (b) { return b && b.id === id; }) || null);
  const own = orig ? guestTagsOf(orig, guestTagMap(all)) : [];
  // The booking as the save will file it, making no statement of its own.
  const silent = Object.assign({}, orig, { id: orig ? orig.id : "\u0000draft", phone: o.phone || "", guestId: o.guestId || null, guestTags: [], guestTagsAt: 0 });
  const joined = stampGuestSeed(all, o).filter(function (b) { return !b || !orig || b.id !== orig.id; }).concat([silent]);
  const keyNew = customerKeyFn(joined), kNew = keyNew(silent);
  if (!kNew) return own;
  const keyOld = customerKeyFn(all), kOld = orig ? keyOld(orig) : "";
  let top = null;
  joined.forEach(function (b) {
    if (b === silent || !states(b) || keyNew(b) !== kNew) return;
    if (kOld && keyOld(b) === kOld) return;
    if (!top || newerStatement(b, top)) top = b;
  });
  return unionTagIds(own, top ? top.guestTags : []);
}

// guestTagsChange — would these edits change anything? The history line's
// "guest tags updated" asks it, at Save.
export function guestTagsChange(list, id, ident, edits) {
  if (!cleanTagEdits(edits).length) return false;
  const base = guestTagBase(list, id, ident);
  return !sameTagIds(editTagIds(base, edits), base);
}

// rehomeGuestTags — booking `id` is LEAVING its customer: deleted (`after` no
// longer has it), or moved to another guest. If it held the customer's newest
// statement, the customer would fall back to an older one, or to none: tags
// taken off would come back and tags put on would go. So the statement is
// handed to the most recent booking of each group it leaves behind, stamp and
// all. Returns `after` itself when there is nothing to hand over.
//
// "Each group": the leaving booking can be the only thing joining a guest group
// to a phone (it carried both keys), and without it they are two customers.
// The booking itself keeps its statement; `saveGuestTags` decides what it says
// under its new guest.
export function rehomeGuestTags(before, after, id) {
  if (!Array.isArray(before) || !Array.isArray(after)) return after;
  const x = before.find(function (b) { return b && b.id === id; });
  if (!states(x)) return after;
  const keyB = customerKeyFn(before), k = keyB(x);
  if (!k) return after;
  const holder = newestStatement(before, keyB, k);
  if (!holder || holder.id !== id) return after;
  const wasWith = {};
  before.forEach(function (b) { if (b && b.id !== id && keyB(b) === k) wasWith[b.id] = true; });
  const keyA = customerKeyFn(after);
  const xa = after.find(function (b) { return b && b.id === id; });
  const kx = xa ? keyA(xa) : "";
  const heirs = {};
  after.forEach(function (b) {
    if (!b || !wasWith[b.id]) return;
    const kb = keyA(b);
    if (!kb || (kx && kb === kx)) return;
    const h = heirs[kb];
    if (!h || (b.date || "") > (h.date || "") || ((b.date || "") === (h.date || "") && String(b.id) > String(h.id))) heirs[kb] = b;
  });
  const heirIds = {};
  Object.keys(heirs).forEach(function (kb) { heirIds[heirs[kb].id] = true; });
  if (!Object.keys(heirIds).length) return after;
  const tags = cleanTagIds(x.guestTags), at = Number(x.guestTagsAt);
  return after.map(function (b) {
    return b && heirIds[b.id] ? Object.assign({}, b, { guestTags: tags, guestTagsAt: at }) : b;
  });
}

function enteredIdentity(b) {
  return (hasRealPhone(b.phone) ? normalizePhone(b.phone) : "") + "\u001f" + (b.guestId || "");
}

// saveGuestTags — what a booking form's save does to guest tags. `prev` is the
// list before the save, `cand` the list with booking `id` written as the save
// writes it (its phone and guestId final, a joined seed stamped), `edits` what
// was tapped in the form, `seedId` the draft's `guestSeed`.
//
// The customer the booking now belongs to ends up with `guestTagBase` + the
// edits, which is what the form showed. It writes the booking's own statement,
// and only when that changes what the guest has; a stamp is always above the
// one it replaces, whatever this device's clock says, or a slow clock's change
// would be saved and never seen. Returns `cand` itself when nothing moves.
//
// The first branch is the common save, and it is the slow path's answer
// reached without the slow path: nothing was tapped, and the booking is new
// (a new booking states nothing by itself) or kept its guest.
export function saveGuestTags(prev, cand, id, edits, seedId, now) {
  if (!Array.isArray(prev) || !Array.isArray(cand)) return cand;
  const row = cand.find(function (b) { return b && b.id === id; });
  if (!row) return cand;
  const orig = prev.find(function (b) { return b && b.id === id; });
  if (!cleanTagEdits(edits).length && !seedId && (!orig || enteredIdentity(orig) === enteredIdentity(row))) return cand;
  const base = guestTagBase(prev, id, { phone: row.phone, guestId: row.guestId, guestSeed: seedId });
  const want = editTagIds(base, edits);
  const out = rehomeGuestTags(prev, cand, id);
  const keyOf = customerKeyFn(out), k = keyOf(row);
  const top = k ? newestStatement(out, keyOf, k) : (states(row) ? row : null);
  if (sameTagIds(top ? top.guestTags : [], want)) return out;
  const at = Math.max(Number(now) || 0, (top ? Number(top.guestTagsAt) : 0) + 1);
  return out.map(function (b) {
    return b && b.id === id ? Object.assign({}, b, { guestTags: want, guestTagsAt: at }) : b;
  });
}

// bookingTags — the tags to SHOW for booking `b`, as labels in the list's
// order: `{ guest, occasion }`. `map` is `guestTagMap(bookings)`, `list` the tag
// list. The one read behind every surface, so a card, a block, the printed
// sheet and the seat note cannot disagree about what a booking is tagged.
export function bookingTags(b, map, list) {
  return {
    guest: tagLabels(list, "guest", guestTagsOf(b, map)),
    occasion: tagLabels(list, "occasion", cleanTagIds(b && b.tags)),
  };
}

// The same as one line of text, guest tags first: "Allergy, VIP · Birthday".
// "" when the booking has none.
export function tagLine(t) {
  if (!t) return "";
  return [t.guest, t.occasion].filter(function (x) { return x && x.length; })
    .map(function (x) { return x.join(", "); }).join(" · ");
}

// setCustomerTags — a tap on a customer's tag in Settings → Customers. `key` is
// the customer's key in `customerIndex`, `edits` the tap (`["+g-vip"]`), `entry`
// the history entry to add (made once, at the tap). A transform of `prev`, so a
// held write replays on fresh data and applies the tap to the tags as they are
// by then.
//
// The statement is written where the customer's newest one already is, so a
// customer does not collect one statement per tap; a customer with none gets it
// on their most recent booking. That booking's history says "guest tags
// updated", the words the form's save uses. Returns `prev` itself when the tap
// changes nothing or the customer has no bookings left.
export function setCustomerTags(prev, key, edits, now, entry) {
  if (!Array.isArray(prev) || !key) return prev;
  const keyOf = customerKeyFn(prev);
  const theirs = prev.filter(function (b) { return b && keyOf(b) === key; });
  if (!theirs.length) return prev;
  const top = newestStatement(theirs, keyOf, key);
  const base = top ? top.guestTags : [];
  const want = editTagIds(base, edits);
  if (sameTagIds(base, want)) return prev;
  let holder = top;
  if (!holder) {
    theirs.forEach(function (b) {
      if (!holder || (b.date || "") > (holder.date || "") || ((b.date || "") === (holder.date || "") && String(b.id) > String(holder.id))) holder = b;
    });
  }
  const at = Math.max(Number(now) || 0, (top ? Number(top.guestTagsAt) : 0) + 1);
  return prev.map(function (b) {
    if (!b || b.id !== holder.id) return b;
    const h = Array.isArray(b.history) ? b.history : [];
    return Object.assign({}, b, { guestTags: want, guestTagsAt: at, history: entry ? h.concat([entry]) : h });
  });
}

// The words that entry carries, the form's own (`BOOKING_FIELDS`' clause).
export const GUEST_TAGS_UPDATED = "guest tags updated";

// customerTagTap — the tap as the transform `saveBookings` takes. The clock is
// read HERE, once, so the transform is a pure function of `prev` and every
// replay of it stamps the same time (the stamp rule keeps that above whatever
// is there by then).
export function customerTagTap(key, edit, entry) {
  const now = Date.now();
  return function (prev) { return setCustomerTags(prev, key, [edit], now, entry); };
}

// ── v18.5.0: what "Delete customer" leaves of a booking ──────────────────────
// Moved here from App's `deleteCustomer` when tags gave it three more fields:
// which fields are personal is a decision a test should be able to read
// (`tests/guest-tags.test.js` holds every row of `BOOKING_FIELDS` to "wiped" or
// "kept, because"). The booking stays for statistics (covers, the day and range
// stats, the phone-less no-show tile) under the name "Data removed"; `noShow`
// is kept (Patryk, v17.0.0). `guestId` goes because it is the only thing still
// binding the anonymised bookings into a customer. Guest tags go with the guest
// (an allergy is the most personal thing here), and occasion tags too (Patryk,
// 2026-10-08): nothing counts them, and a birthday on a known date is a fact
// about the person.
export function anonymizeBooking(b) {
  return Object.assign({}, b, { name: "Data removed", phone: "", notes: "", history: [], guestId: null, anonymized: true, tags: [], guestTags: [], guestTagsAt: 0 });
}

// searchBookings — match INDIVIDUAL bookings against a typed query (v16.3.0),
// across ALL dates (the global-search panel). Same query semantics as
// searchCustomers: digits (≥3) → phone substring match; non-digit text →
// case-insensitive name substring. Results sorted UPCOMING-first (date ≥ today,
// ascending) then PAST (descending), capped at `limit` (default 30). `todayStr`
// is passed in so the caller controls "today" (all-UTC ISO date string).
// v18.5.1: with `tags` (`{ map, list }`: `guestTagMap(bookings)` and the tag
// list) a text query of 3+ characters ALSO matches a booking carrying a tag
// whose name contains it, read as it is shown (`bookingTags`): "allerg" finds
// every booking of every guest with Allergy. Three, as for digits: two letters
// are in too many tag names to mean one. Without `tags` nothing changes.
export function searchBookings(bookings, query, todayStr, limit, tags) {
  const max = limit || 30;
  const q = String(query || "").trim();
  if (!q || !Array.isArray(bookings)) return [];
  const qDigits = q.replace(/[^\d]/g, "");
  const qName = q.toLowerCase();
  const useDigits = qDigits.length >= 3;
  const out = bookings.filter(function (b) {
    if (!b || b.anonymized) return false; // v17.0.0: anonymized ("Data removed") bookings never match
    if (useDigits) return b.phone && normalizePhone(b.phone).replace(/[^\d]/g, "").indexOf(qDigits) !== -1;
    if (b.name && b.name.toLowerCase().indexOf(qName) !== -1) return true;
    return matchedTagLabels(b, q, tags).length > 0;
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

// matchedTagLabels — the names of booking `b`'s tags that contain the query,
// guest tags first: what Find a booking writes under a result's name, so "ann"
// tells an Ann from an Anniversary (Patryk, 2026-10-09: only the MATCHING
// tags, and also when the name matched too). [] for a digit query, for fewer
// than three characters, and without `tags` — the same rule the search itself
// matches by, because it IS that rule: `searchBookings` calls this.
export function matchedTagLabels(b, query, tags) {
  const q = String(query || "").trim();
  const qName = q.toLowerCase();
  if (!b || !tags || qName.length < 3 || q.replace(/[^\d]/g, "").length >= 3) return [];
  const t = bookingTags(b, tags.map, tags.list);
  return t.guest.concat(t.occasion).filter(function (label) { return label.toLowerCase().indexOf(qName) !== -1; });
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
