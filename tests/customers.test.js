// tests/customers.test.js
//
// Safety-net for src/lib/customers.js — the phone-identity layer (customers are
// DERIVED from bookings by normalized phone; there is no customers collection).
// Added in the /engineering:tech-debt Phase 3 (test harness). Locks in the
// no-merge rules for phone-less guests and the anonymized-booking exclusions.

import { describe, it, expect } from "vitest";
import {
  normalizePhone, formatPhone, hasRealPhone, isNoShow,
  matchCustomerByPhone, matchCustomerFor, matchesIdentity, identityKey, customerIndex, noShowMap, stampGuestSeed,
  searchBookings, searchCustomers, searchGuestsByName, findPhoneOverlaps,
} from "../src/lib/customers.js";

function bk(o) {
  return Object.assign({ id: "id" + Math.random().toString(36).slice(2, 7),
    name: "", phone: "", date: "2099-01-01", status: "confirmed" }, o);
}

describe("normalizePhone / formatPhone / hasRealPhone", () => {
  it("normalize strips formatting, keeps a single leading +", () => {
    expect(normalizePhone("+34 600 123 456")).toBe("+34600123456");
    expect(normalizePhone("600-123-456")).toBe("600123456");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("+")).toBe("+");
  });
  // CT-2B-04 (v17.16.3): the "+" counts wherever it sits ahead of the digits.
  // Before this, only index 0 counted, so a bracketed country code produced a
  // DIFFERENT identity from the same number written without brackets — one
  // person as two customers, with visits, no-show count and history split
  // between them.
  it("keeps the + when punctuation precedes it (a bracketed country code)", () => {
    expect(normalizePhone("(+34) 600 123 456")).toBe("+34600123456");
    expect(normalizePhone("[+34] 600-123-456")).toBe("+34600123456");
    expect(normalizePhone("tel: +34 600 123 456")).toBe("+34600123456");
    // …and the same number written plainly still agrees with it, which is the
    // whole point — these are one customer.
    expect(normalizePhone("(+34) 600 123 456")).toBe(normalizePhone("+34 600 123 456"));
  });
  it("ignores a + that FOLLOWS a digit, and never removes one", () => {
    // A country-code marker precedes the number; a later "+" is an extension,
    // a typo, or two numbers in one field — not a reason to re-key anybody.
    expect(normalizePhone("600 123 456+2")).toBe("6001234562");
    expect(normalizePhone("600123456")).toBe("600123456");
  });
  it("can only ever ADD a +, never drop one (the merge-not-split property)", () => {
    // This is what makes it safe to change a key every customer identity is
    // derived from: the fix can fuse two records that were always one person,
    // and cannot split one person into two. Old rule = charAt(0) === "+".
    const cases = [
      "+34600123456", "(+34) 600 123 456", "600123456", "", "+", "  +34 600  ",
      "600+123", "tel: +34 600", "0034600123456", "+++34600",
    ];
    for (const c of cases) {
      const oldHadPlus = String(c).trim().charAt(0) === "+";
      const nowHasPlus = normalizePhone(c).charAt(0) === "+";
      expect(!oldHadPlus || nowHasPlus).toBe(true);
      // digits are untouched by the change
      expect(normalizePhone(c).replace(/\D/g, "")).toBe(String(c).replace(/\D/g, ""));
    }
  });
  it("format inserts a space after the country code", () => {
    expect(formatPhone("+34600123456")).toBe("+34 600123456");
    expect(formatPhone("")).toBe("");
  });
  it("hasRealPhone needs ≥3 digits (not empty, not a lone +)", () => {
    expect(hasRealPhone("+34600123456")).toBe(true);
    expect(hasRealPhone("+")).toBe(false);
    expect(hasRealPhone("12")).toBe(false);
    expect(hasRealPhone("123")).toBe(true);
    expect(hasRealPhone("")).toBe(false);
  });
});

describe("isNoShow", () => {
  it("true for the flag OR a legacy history entry", () => {
    expect(isNoShow({ noShow: true })).toBe(true);
    expect(isNoShow({ history: [{ action: "no show" }] })).toBe(true);
    expect(isNoShow({ status: "cancelled" })).toBe(false);
    expect(isNoShow({})).toBe(false);
    expect(isNoShow(null)).toBe(false);
  });
});

describe("matchCustomerByPhone", () => {
  const b1 = bk({ phone: "+34600111222", name: "Ann", date: "2099-01-01", status: "completed" });
  const b2 = bk({ phone: "+34 600 111 222", name: "Annie", date: "2099-02-01", status: "confirmed" });
  const b3 = bk({ phone: "+34600111222", name: "Ann", date: "2099-03-01", status: "cancelled", noShow: true });
  const all = [b1, b2, b3];

  it("aggregates across formatting variants of the same number", () => {
    const c = matchCustomerByPhone("+34600111222", all);
    expect(c.count).toBe(3);
    expect(c.name).toBe("Ann");           // most-recent booking (b3)
    expect(c.latestDate).toBe("2099-03-01");
    expect(c.regularCount).toBe(1);       // completed only (b1)
    expect(c.noShowCount).toBe(1);        // b3
  });
  it("excludes the linked booking from regular/no-show counts", () => {
    expect(matchCustomerByPhone("+34600111222", all, b1.id).regularCount).toBe(0);
  });
  it("returns null when nothing matches", () => {
    expect(matchCustomerByPhone("+34999999999", all)).toBe(null);
    expect(matchCustomerByPhone("", all)).toBe(null);
  });
});

describe("customerIndex / noShowMap", () => {
  const bks = [
    bk({ phone: "+34600111222", name: "Ann", date: "2099-01-01", status: "completed" }),
    bk({ phone: "+34600111222", name: "Ann", date: "2099-03-01", status: "cancelled", noShow: true }),
    bk({ phone: "", name: "NoPhone", date: "2099-01-01" }), // skipped — no real phone
  ];
  it("indexes phone-bearing bookings only, with visit + no-show counts", () => {
    const idx = customerIndex(bks);
    expect(Object.keys(idx)).toEqual(["+34600111222"]);
    expect(idx["+34600111222"].visits).toBe(1);      // completed
    expect(idx["+34600111222"].noShowCount).toBe(1);
    expect(idx["+34600111222"].name).toBe("Ann");
  });
  it("noShowMap counts no-shows per phone", () => {
    expect(noShowMap(bks)).toEqual({ "+34600111222": 1 });
  });

  // ── v17.10.0: the index is keyed on identityKey, not on the phone ──────────
  // Everything above still passes unchanged, which is the shape of the change:
  // a phone customer is exactly what it was, and a JOINED phone-less guest is
  // now a customer too. Without this, `guestId` reached every screen except the
  // one that lists customers.
  it("gives a JOINED phone-less guest an entry of their own", () => {
    const list = [
      bk({ id: "g1", phone: "", name: "Anna", date: "2099-01-01", status: "completed", guestId: "gg1" }),
      bk({ id: "g2", phone: "", name: "Anna", date: "2099-05-01", status: "cancelled", noShow: true, guestId: "gg1" }),
      bk({ id: "s1", phone: "", name: "Anna", date: "2099-06-01" }),   // same NAME, never joined
    ];
    const idx = customerIndex(list);
    expect(Object.keys(idx)).toEqual(["gg1"]);          // the stranger has no identity
    const c = idx.gg1;
    expect(c.key).toBe("gg1");
    expect(c.guestId).toBe("gg1");
    expect(c.phone).toBe("");                            // "" not undefined — callers do string work on it
    expect(c.bookings).toHaveLength(2);
    expect(c.visits).toBe(1);
    expect(c.noShowCount).toBe(1);
    expect(c.latestDate).toBe("2099-05-01");
  });

  // /code-review fix: a guest who LATER gives a number stays ONE customer.
  // Keying on identityKey alone ("phone if real, else guestId") split them —
  // two rows, half the visits each, and "delete all data" cleaning only one
  // half — which is precisely the failure matchCustomerFor's comment warns
  // about. customerIndex learns the guestId→phone alias first.
  it("folds a guest group into the phone it later acquired", () => {
    const list = [
      bk({ id: "a", phone: "", name: "Ann", date: "2099-01-01", status: "completed", guestId: "gA" }),
      bk({ id: "b", phone: "", name: "Ann", date: "2099-02-01", status: "completed", guestId: "gA" }),
      bk({ id: "c", phone: "+34600111222", name: "Ann", date: "2099-03-01", status: "completed", guestId: "gA" }),
    ];
    const idx = customerIndex(list);
    expect(Object.keys(idx)).toEqual(["+34600111222"]);      // ONE customer, not two
    const c = idx["+34600111222"];
    expect(c.visits).toBe(3);                                 // not 1 and 2
    expect(c.guestIds).toEqual(["gA"]);                       // delete reaches the guest half
    expect(c.guestId).toBe(null);                             // a phone entry, so the scalar is null
    expect(c.rawPhone).toBe("+34600111222");                  // never "" from the phone-less newest
  });

  it("splits no-shows nowhere — the repeat-offender flag sees the whole tally", () => {
    const list = [
      bk({ id: "a", phone: "", name: "Ann", date: "2099-01-01", noShow: true, guestId: "gA" }),
      bk({ id: "b", phone: "+34600111222", name: "Ann", date: "2099-03-01", noShow: true, guestId: "gA" }),
    ];
    const map = noShowMap(list);
    // Both spellings of the identity resolve to the same total, so the call
    // sites' `nsMap[identityKey(b)]` is right for either booking.
    expect(map["+34600111222"]).toBe(2);
    expect(map.gA).toBe(2);
    expect(customerIndex(list)["+34600111222"].noShowCount).toBe(2);
  });

  it("picks the alias deterministically when a guestId carries two phones", () => {
    // A wrong join, later disambiguated by both parties giving numbers. Nothing
    // can tell which is right; what matters is that every device agrees.
    const list = [
      bk({ id: "a", phone: "+34600999888", name: "Ann", date: "2099-01-01", guestId: "gA" }),
      bk({ id: "b", phone: "+34600111222", name: "Ann", date: "2099-02-01", guestId: "gA" }),
      bk({ id: "c", phone: "", name: "Ann", date: "2099-03-01", guestId: "gA" }),
    ];
    const fwd = customerIndex(list);
    const rev = customerIndex(list.slice().reverse());
    expect(Object.keys(fwd).sort()).toEqual(Object.keys(rev).sort());
    expect(fwd["+34600111222"].bookings.map((b) => b.id).sort()).toEqual(["b", "c"]);
  });

  it("does not offer an aliased guest as a separate phone-less dropdown row", () => {
    const list = [
      bk({ id: "a", phone: "", name: "Ann", date: "2099-01-01", guestId: "gA" }),
      bk({ id: "b", phone: "+34600111222", name: "Ann", date: "2099-02-01", guestId: "gA" }),
    ];
    const rows = searchGuestsByName(list, customerIndex(list), "ann");
    expect(rows).toHaveLength(1);
    expect(rows[0].isPhoneless).toBe(false);
  });

  it("never indexes an anonymized booking, even with a stray guestId", () => {
    // deleteCustomer clears guestId, so this is a guard rather than a case — but
    // an anonymized booking reappearing as a customer called "Data removed" is
    // exactly the failure that would make the delete look like it did nothing.
    const list = [bk({ id: "x", phone: "", name: "Data removed", date: "2099-01-01", guestId: "gX", anonymized: true })];
    expect(Object.keys(customerIndex(list))).toEqual([]);
  });

  it("searchCustomers finds a guest by NAME and never by digits", () => {
    const list = [
      bk({ id: "g1", phone: "", name: "Anna", date: "2099-01-01", guestId: "gg1" }),
      bk({ id: "p1", phone: "+34600111222", name: "Bob", date: "2099-01-01" }),
    ];
    const idx = customerIndex(list);
    expect(searchCustomers(idx, "anna").map((c) => c.key)).toEqual(["gg1"]);
    expect(searchCustomers(idx, "600").map((c) => c.key)).toEqual(["+34600111222"]);
  });
});

describe("matchesIdentity", () => {
  it("is a union — either key hitting is a match", () => {
    const ident = { phone: "+34600111222", guestId: "gA" };
    expect(matchesIdentity(bk({ phone: "+34 600 111 222" }), ident)).toBe(true);   // phone, any formatting
    expect(matchesIdentity(bk({ phone: "", guestId: "gA" }), ident)).toBe(true);   // guestId only
    expect(matchesIdentity(bk({ phone: "+34600999888" }), ident)).toBe(false);
    expect(matchesIdentity(null, ident)).toBe(false);
    expect(matchesIdentity(bk({ phone: "+34600111222" }), null)).toBe(false);
  });
  it("accepts guestIds (plural) — what a merged customer row deletes through", () => {
    const ident = { phone: "+34600111222", guestIds: ["gA", "gB"] };
    expect(matchesIdentity(bk({ phone: "", guestId: "gB" }), ident)).toBe(true);
    expect(matchesIdentity(bk({ phone: "", guestId: "gC" }), ident)).toBe(false);
    expect(matchesIdentity(bk({ phone: "", guestId: null }), { phone: "", guestIds: [] })).toBe(false);
  });
  // v17.16.5 (CT-2B-05). The scenario, end to end: Ana books with a phone and
  // picks a phone-less "Bea" from the name dropdown, minting one guestId across
  // both. `guestPhoneAlias` then folds Bea's group onto Ana's number, so Bea's
  // phone-less bookings appear under Ana. That is the mis-join. The part this
  // fixes is a booking of Bea's that carries her OWN number: the index shows it
  // as a separate customer, and the delete used to take it anyway.
  it("never reaches a booking through a guestId when it carries a different real phone", () => {
    const ident = { phone: "+34600111222", guestIds: ["gA"] };
    const beaOwnNumber = bk({ phone: "+34600999888", guestId: "gA" });
    expect(matchesIdentity(beaOwnNumber, ident)).toBe(false);
    // Deliberately still reached — for a CORRECT join these ARE the customer,
    // and "all data" has to mean all of it.
    expect(matchesIdentity(bk({ phone: "", guestId: "gA" }), ident)).toBe(true);
    // The dial prefix is not a phone: the form seeds the field with it, so
    // reading "+34" as a different number would exclude the customer's own
    // bookings from their own delete.
    expect(matchesIdentity(bk({ phone: "+34", guestId: "gA" }), ident)).toBe(true);
    // Same number, any formatting, is the customer — the phone branch above
    // already matched, and this must not fall into the new exclusion.
    expect(matchesIdentity(bk({ phone: "+34 600 111 222", guestId: "gA" }), ident)).toBe(true);
  });
  it("the exclusion needs a phone on BOTH sides to bite", () => {
    // A row keyed by guestId alone (no booking in the group has a number) must
    // keep reaching its bookings — there is no key to differ from.
    const ident = { phone: "", guestIds: ["gA"] };
    expect(matchesIdentity(bk({ phone: "+34600999888", guestId: "gA" }), ident)).toBe(true);
  });
  it("does not treat an absent guestId as a wildcard", () => {
    // Both sides missing the key must not match — the trap that would fuse every
    // phone-less booking into one customer.
    expect(matchesIdentity(bk({ phone: "", guestId: null }), { phone: "", guestId: null })).toBe(false);
  });
});

describe("searchBookings", () => {
  const bks = [
    bk({ id: "p", phone: "+34600111222", name: "Ann", date: "2099-01-01" }),   // past
    bk({ id: "f", phone: "+34600111222", name: "Annie", date: "2099-03-01" }), // upcoming
    bk({ id: "anon", phone: "", name: "Data removed", date: "2099-03-05", anonymized: true }),
  ];
  it("digit query (≥3) matches phone; upcoming sorts before past", () => {
    const r = searchBookings(bks, "111", "2099-02-15");
    expect(r.map((b) => b.id)).toEqual(["f", "p"]);
  });
  it("text query matches name; anonymized never matches", () => {
    const r = searchBookings(bks, "ann", "2099-02-15");
    expect(r.map((b) => b.id)).toEqual(["f", "p"]);
    expect(searchBookings(bks, "removed", "2099-02-15")).toEqual([]);
  });
});

describe("searchCustomers", () => {
  const idx = customerIndex([
    bk({ phone: "+34600111222", name: "Ann", date: "2099-03-01" }),
    bk({ phone: "+34700333444", name: "Bob", date: "2099-02-01" }),
  ]);
  it("matches by phone digits or name text", () => {
    expect(searchCustomers(idx, "111").map((c) => c.name)).toEqual(["Ann"]);
    expect(searchCustomers(idx, "bob").map((c) => c.name)).toEqual(["Bob"]);
    expect(searchCustomers(idx, "")).toEqual([]);
  });
});

describe("searchGuestsByName (no-merge rule)", () => {
  const withPhone = bk({ phone: "+34600111222", name: "Ann Smith", date: "2099-03-01" });
  const noPhone1 = bk({ id: "np1", phone: "", name: "Anna", date: "2099-01-01" });
  const noPhone2 = bk({ id: "np2", phone: "", name: "Annette", date: "2099-02-01" });
  const anon = bk({ id: "anon", phone: "", name: "Anon", date: "2099-04-01", anonymized: true });
  const bks = [withPhone, noPhone1, noPhone2, anon];
  const idx = customerIndex(bks);

  it("phone customers collapse to one row; phone-less guests get one row EACH", () => {
    const rows = searchGuestsByName(bks, idx, "an");
    const phoneRows = rows.filter((r) => !r.isPhoneless);
    const phonelessRows = rows.filter((r) => r.isPhoneless);
    expect(phoneRows).toHaveLength(1);
    expect(phoneRows[0].phone).toBe("+34600111222");
    // two distinct phone-less guests are never merged, and anonymized is skipped
    expect(phonelessRows.map((r) => r.name).sort()).toEqual(["Anna", "Annette"]);
    expect(rows.find((r) => r.name === "Anon")).toBeUndefined();
  });
  it("requires a query of at least 2 chars", () => {
    expect(searchGuestsByName(bks, idx, "a")).toEqual([]);
  });

  // v17.10.0: the ONE way phone-less guests merge — a shared guestId, which is
  // only ever written when a human picks one of them from this dropdown. The
  // test above still passes unchanged, which is the point: nothing merges by
  // accident.
  it("phone-less bookings sharing a guestId collapse into ONE row", () => {
    const j1 = bk({ id: "j1", phone: "", name: "Anna", date: "2099-01-01", guestId: "gj1" });
    const j2 = bk({ id: "j2", phone: "", name: "Anna", date: "2099-05-01", guestId: "gj1" });
    const stranger = bk({ id: "j3", phone: "", name: "Anna", date: "2099-06-01" }); // same NAME, no join
    const list = [j1, j2, stranger];
    const rows = searchGuestsByName(list, customerIndex(list), "ann");
    expect(rows).toHaveLength(2);                       // the joined pair + the stranger
    const joined = rows.find((r) => r.guestId === "gj1");
    expect(joined.count).toBe(2);
    expect(joined.latestDate).toBe("2099-05-01");       // newest first
    expect(joined.latest.id).toBe("j2");                // prefill from the newest
    // the un-joined same-name guest stays a row of its own — the never-merge rule
    expect(rows.find((r) => r.guestId === null).latest.id).toBe("j3");
  });
});

// ── v17.10.0: the second identity key ─────────────────────────────────────────
describe("identityKey / matchCustomerFor (guestId)", () => {
  it("identityKey prefers a real phone and falls back to guestId", () => {
    expect(identityKey({ phone: "+34600111222", guestId: "gx" })).toBe("+34600111222");
    expect(identityKey({ phone: "", guestId: "gx" })).toBe("gx");
    expect(identityKey({ phone: "+", guestId: "gx" })).toBe("gx");   // the lone "+" is not a phone
    expect(identityKey({ phone: "", guestId: null })).toBe(null);
    expect(identityKey(null)).toBe(null);
  });

  it("matches on guestId alone", () => {
    const a = bk({ id: "a", phone: "", name: "Ana", date: "2099-01-01", status: "completed", guestId: "gA" });
    const b = bk({ id: "b", phone: "", name: "Ana", date: "2099-02-01", status: "completed", guestId: "gA" });
    const other = bk({ id: "c", phone: "", name: "Ana", date: "2099-03-01", status: "completed" });
    const m = matchCustomerFor({ guestId: "gA" }, [a, b, other]);
    expect(m.count).toBe(2);
    expect(m.regularCount).toBe(2);
    expect(m.all.map((x) => x.id)).toEqual(["b", "a"]);   // date desc
  });

  // The union, not a fallback: a guest who books three times with no phone and
  // then gives one must stay ONE person, not split at the moment they became
  // easiest to identify.
  it("unions the phone and guestId matches", () => {
    const early = bk({ id: "e", phone: "", date: "2099-01-01", status: "completed", guestId: "gU" });
    const later = bk({ id: "l", phone: "+34600999888", date: "2099-02-01", status: "completed", guestId: "gU" });
    const m = matchCustomerFor({ phone: "+34600999888", guestId: "gU" }, [early, later]);
    expect(m.count).toBe(2);
    expect(m.regularCount).toBe(2);
  });

  it("excludeBookingId still drops the linked booking from the counts", () => {
    const a = bk({ id: "a", phone: "", date: "2099-01-01", status: "completed", guestId: "gA" });
    const b = bk({ id: "b", phone: "", date: "2099-02-01", status: "completed", guestId: "gA" });
    expect(matchCustomerFor({ guestId: "gA" }, [a, b], "b").regularCount).toBe(1);
  });

  it("returns null when neither key is supplied", () => {
    expect(matchCustomerFor({}, [bk({ guestId: "gA" })])).toBe(null);
    expect(matchCustomerFor(null, [])).toBe(null);
  });

  // matchCustomerByPhone is a thin alias now — the WA complementarity contract
  // depends on this exact symbol, so its behaviour is pinned here.
  it("matchCustomerByPhone still ignores guestId-only bookings", () => {
    const withPhone = bk({ id: "p", phone: "+34600111222", status: "completed" });
    const guestOnly = bk({ id: "g", phone: "", status: "completed", guestId: "gZ" });
    const m = matchCustomerByPhone("+34600111222", [withPhone, guestOnly]);
    expect(m.count).toBe(1);
    expect(matchCustomerByPhone("", [withPhone])).toBe(null);
  });

  it("noShowMap counts a joined phone-less offender, and skips an unjoined one", () => {
    const n1 = bk({ id: "n1", phone: "", noShow: true, guestId: "gN" });
    const n2 = bk({ id: "n2", phone: "", noShow: true, guestId: "gN" });
    const loose = bk({ id: "n3", phone: "", noShow: true });
    const map = noShowMap([n1, n2, loose]);
    expect(map.gN).toBe(2);
    expect(Object.keys(map)).toEqual(["gN"]);   // the unjoined booking has no identity
  });
});

// ── v17.4.0: same-phone double-booking rule ───────────────────────────────────
// Extracted from BookingFormModal so the rule is testable. Advisory only — the
// caller must never block a save on it (a real party does book twice).
describe("findPhoneOverlaps", () => {
  const P = "+34600111222";
  const existing = bk({ id: "x", phone: P, date: "2099-01-01", time: "19:30", size: 2, duration: 90 }); // 19:30–21:00

  it("flags an overlapping booking for the same phone", () => {
    const r = findPhoneOverlaps([existing], { phone: P, date: "2099-01-01", time: "20:00", size: 2 });
    expect(r.map((b) => b.id)).toEqual(["x"]);
  });

  it("is half-open: touching at the boundary is NOT an overlap", () => {
    // existing ends 21:00; a 21:00 start must not flag
    expect(findPhoneOverlaps([existing], { phone: P, date: "2099-01-01", time: "21:00", size: 2 })).toEqual([]);
    // one minute inside does flag
    expect(findPhoneOverlaps([existing], { phone: P, date: "2099-01-01", time: "20:59", size: 2 })).toHaveLength(1);
  });

  it("matches across phone FORMATTING variants", () => {
    const r = findPhoneOverlaps([existing], { phone: "+34 600 111 222", date: "2099-01-01", time: "20:00", size: 2 });
    expect(r).toHaveLength(1);
  });

  it("ignores a different phone, a different date, and the edited booking", () => {
    const opts = { phone: P, date: "2099-01-01", time: "20:00", size: 2 };
    expect(findPhoneOverlaps([existing], { ...opts, phone: "+34600999888" })).toEqual([]);
    expect(findPhoneOverlaps([existing], { ...opts, date: "2099-01-02" })).toEqual([]);
    expect(findPhoneOverlaps([existing], { ...opts, excludeId: "x" })).toEqual([]);
  });

  it("ignores cancelled and completed bookings", () => {
    const opts = { phone: P, date: "2099-01-01", time: "20:00", size: 2 };
    expect(findPhoneOverlaps([{ ...existing, status: "cancelled" }], opts)).toEqual([]);
    expect(findPhoneOverlaps([{ ...existing, status: "completed" }], opts)).toEqual([]);
    // pending and seated DO count — they occupy a table
    expect(findPhoneOverlaps([{ ...existing, status: "pending" }], opts)).toHaveLength(1);
    expect(findPhoneOverlaps([{ ...existing, status: "seated" }], opts)).toHaveLength(1);
  });

  it("returns [] on missing phone/date/time rather than throwing", () => {
    expect(findPhoneOverlaps([existing], { phone: "", date: "2099-01-01", time: "20:00" })).toEqual([]);
    expect(findPhoneOverlaps([existing], { phone: P, date: "", time: "20:00" })).toEqual([]);
    expect(findPhoneOverlaps([existing], { phone: P, date: "2099-01-01", time: "" })).toEqual([]);
    expect(findPhoneOverlaps(null, { phone: P, date: "2099-01-01", time: "20:00" })).toEqual([]);
  });

  it("honours an explicit duration and sorts conflicts earliest-first", () => {
    const early = bk({ id: "e", phone: P, date: "2099-01-01", time: "18:00", duration: 60 }); // 18:00–19:00
    // a 15-min booking at 18:30 overlaps `early` only
    expect(findPhoneOverlaps([existing, early], { phone: P, date: "2099-01-01", time: "18:30", dur: 15 }).map((b) => b.id)).toEqual(["e"]);
    // a long booking spans both — earliest first
    expect(findPhoneOverlaps([existing, early], { phone: P, date: "2099-01-01", time: "18:30", dur: 240 }).map((b) => b.id)).toEqual(["e", "x"]);
  });
});

// ── v17.10.0 /code-review: the guest-identity back-stamp ──────────────────────
// Extracted from App.jsx so it is reachable at all. It writes a PERMANENT link
// between two bookings and nothing in the UI can unpick one, which is exactly
// the kind of decision CLAUDE.md says must not live in a component closure.
describe("stampGuestSeed", () => {
  const draft = { guestId: "gb1", guestSeed: "b1" };

  it("writes the minted id onto the seed booking and nothing else", () => {
    const list = [bk({ id: "b1", phone: "" }), bk({ id: "b2", phone: "" })];
    const out = stampGuestSeed(list, draft);
    expect(out.find((b) => b.id === "b1").guestId).toBe("gb1");
    expect(out.find((b) => b.id === "b2").guestId).toBeFalsy();
  });

  it("is a no-op unless the draft carries BOTH keys", () => {
    const list = [bk({ id: "b1", phone: "" })];
    expect(stampGuestSeed(list, { guestId: "gb1" })).toBe(list);       // no seed
    expect(stampGuestSeed(list, { guestSeed: "b1" })).toBe(list);      // no id
    expect(stampGuestSeed(list, null)).toBe(list);
    expect(stampGuestSeed(null, draft)).toBe(null);
  });

  it("never re-homes a booking that already belongs to a group", () => {
    // The same guard that makes a retry safe: a replay on fresh data finds the
    // stamp already there, and a booking joined to someone else is left alone.
    const list = [bk({ id: "b1", phone: "", guestId: "gOTHER" })];
    expect(stampGuestSeed(list, draft)[0].guestId).toBe("gOTHER");
  });

  it("is idempotent, which is what makes the write-retry path safe", () => {
    const list = [bk({ id: "b1", phone: "" })];
    const once = stampGuestSeed(list, draft);
    const twice = stampGuestSeed(once, draft);
    expect(twice.map((b) => b.guestId)).toEqual(once.map((b) => b.guestId));
  });

  it("does not mutate the list it is given", () => {
    // It runs inside doSave's pure transform of `prev`; mutating Firebase's
    // snapshot there would corrupt the base the CAS compares against.
    const src = bk({ id: "b1", phone: "" });
    stampGuestSeed([src], draft);
    expect(src.guestId).toBeFalsy();
  });

  // v17.16.4 (CT-2B-09): the no-op identity contract, the same one
  // `bookingsAfterAction` states. The two early returns above always had it;
  // these are the cases that reach the list and change nothing in it.
  it("returns the INPUT array when it reaches the list and stamps nothing", () => {
    // Already stamped — which is EVERY retry, since the replay-safety guard is
    // what makes a held write safe to re-apply.
    const done = [bk({ id: "b1", phone: "", guestId: "gb1" })];
    expect(stampGuestSeed(done, draft)).toBe(done);
    // Joined to someone else — left alone, so again nothing was written.
    const other = [bk({ id: "b1", phone: "", guestId: "gOTHER" })];
    expect(stampGuestSeed(other, draft)).toBe(other);
    // The seed booking is not in this list at all (a concurrent delete, or a
    // replay on fresh data that no longer holds it).
    const absent = [bk({ id: "b2", phone: "" })];
    expect(stampGuestSeed(absent, draft)).toBe(absent);
    expect(stampGuestSeed([], draft)).toEqual([]);
  });

  it("still returns a NEW array when it does stamp", () => {
    // The other half of the contract: identity must mean something in both
    // directions, or a caller gating on it silently drops a real write.
    const list = [bk({ id: "b1", phone: "" })];
    expect(stampGuestSeed(list, draft)).not.toBe(list);
  });
});
