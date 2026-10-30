// tests/operating-hours.test.js — v18.13.0 (#31)
//
// The two whitelists over `settings/operatingHours.days`. tests/schema.test.js hashes
// them, which spots an edit and cannot spot a wrong result; this runs them.

import { describe, it, expect } from "vitest";
import { sanitizeDay, sanitizeWeek } from "../src/lib/operating-hours.js";

const DEFAULT = { open: 13, close: 22, closed: false };
const week = (day) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [i, day]));

describe("sanitizeDay", () => {
  it("keeps a good day, and only the three keys", () => {
    expect(sanitizeDay({ open: 12, close: 23, closed: true, note: "x" })).toEqual({ open: 12, close: 23, closed: true });
  });
  it("a day with nothing usable is the default pair", () => {
    [undefined, null, "x", 5, {}].forEach((raw) => expect(sanitizeDay(raw), String(raw)).toEqual(DEFAULT));
  });
  it("closed is true only when it is true", () => {
    ["yes", 1, "true", null].forEach((closed) => expect(sanitizeDay({ closed }).closed, String(closed)).toBe(false));
  });
  it("holds the bounds: open 6 to 22, close an hour later up to 25", () => {
    expect(sanitizeDay({ open: 3, close: 2 })).toEqual({ open: 6, close: 7, closed: false });
    expect(sanitizeDay({ open: 30, close: 40 })).toEqual({ open: 22, close: 25, closed: false });
    expect(sanitizeDay({ open: 13, close: 13 })).toEqual({ open: 13, close: 14, closed: false });
  });
});

describe("sanitizeWeek", () => {
  it("reads the {days} shape day by day", () => {
    const days = week({ open: 12, close: 23, closed: false });
    days[1] = { open: 13, close: 22, closed: true };
    const w = sanitizeWeek({ days });
    expect(w[1]).toEqual({ open: 13, close: 22, closed: true });
    expect(w[2]).toEqual({ open: 12, close: 23, closed: false });
    expect(Object.keys(w)).toHaveLength(7);
  });
  it("a weekday missing from {days} is the default pair, not the day before it", () => {
    expect(sanitizeWeek({ days: { 0: { open: 12, close: 23 } } })[1]).toEqual(DEFAULT);
  });
  it("reads the legacy flat pair as seven equal days, each its own object", () => {
    const w = sanitizeWeek({ open: 12, close: 23 });
    expect(w).toEqual(week({ open: 12, close: 23, closed: false }));
    expect(w[0]).not.toBe(w[1]);
  });
  it("one half of a flat pair is still the flat shape", () => {
    expect(sanitizeWeek({ close: 23 })[4]).toEqual({ open: 13, close: 23, closed: false });
  });
  it("{days} wins when both are there", () => {
    expect(sanitizeWeek({ open: 8, close: 9, days: week({ open: 12, close: 23 }) })[0].open).toBe(12);
  });
  it("anything else is the default week", () => {
    [null, undefined, "x", 5, {}, { days: "x" }].forEach((v) => {
      expect(sanitizeWeek(v), JSON.stringify(v)).toEqual(week(DEFAULT));
    });
  });
  it("what it returns reads back as itself, so a save changes nothing", () => {
    const once = sanitizeWeek({ open: 3, close: 40 });
    expect(sanitizeWeek({ days: once })).toEqual(once);
  });
});
