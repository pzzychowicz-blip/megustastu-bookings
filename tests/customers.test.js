// tests/customers.test.js
//
// Safety-net for src/lib/customers.js — the phone-identity layer (customers are
// DERIVED from bookings by normalized phone; there is no customers collection).
// Added in the /engineering:tech-debt Phase 3 (test harness). Locks in the
// no-merge rules for phone-less guests and the anonymized-booking exclusions.

import { describe, it, expect } from "vitest";
import {
  normalizePhone, formatPhone, hasRealPhone, isNoShow,
  matchCustomerByPhone, customerIndex, noShowMap,
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
