// tests/drafts.test.js
//
// Safety-net for src/lib/drafts.js — the comparison behind the v17.5.0
// unsaved-changes guard. The failure modes here are BOTH directions and both
// are user-hostile: a false positive nags on every untouched Cancel (staff
// learn to tap through it), a false negative silently drops a typed booking.

import { describe, it, expect } from "vitest";
import { sameDraft } from "../src/lib/drafts.js";

const FORM = {
  name: "", phone: "+", date: "2099-01-01", time: "13:00", size: 2,
  preference: "auto", notes: "", status: "confirmed", customDur: null,
  deposit: "", repeatWeekly: false, manualTables: [], preferredTables: [],
  returnOf: null,
};

describe("sameDraft — unchanged drafts", () => {
  it("treats a draft as equal to itself", () => {
    expect(sameDraft(FORM, FORM)).toBe(true);
  });

  it("ignores key ORDER (object literal vs Object.assign spread)", () => {
    const reordered = {};
    Object.keys(FORM).reverse().forEach((k) => { reordered[k] = FORM[k]; });
    expect(sameDraft(FORM, reordered)).toBe(true);
  });

  it("collapses the empty-ish family — null / undefined / '' / false", () => {
    expect(sameDraft({ a: null }, { a: "" })).toBe(true);
    expect(sameDraft({ a: null }, { a: false })).toBe(true);
    expect(sameDraft({ a: undefined }, {})).toBe(true);
    expect(sameDraft({ ...FORM, customDur: null }, { ...FORM, customDur: "" })).toBe(true);
  });

  it("does not treat a number/string swap as an edit (input type=number)", () => {
    expect(sameDraft({ ...FORM, size: 2 }, { ...FORM, size: "2" })).toBe(true);
  });

  it("ignores table-pick ORDER — the arrays are sets in spirit", () => {
    expect(sameDraft(
      { ...FORM, preferredTables: ["5A", "1B", "7"] },
      { ...FORM, preferredTables: ["7", "5A", "1B"] },
    )).toBe(true);
  });
});

describe("sameDraft — real edits", () => {
  it("catches a typed name", () => {
    expect(sameDraft(FORM, { ...FORM, name: "Ana" })).toBe(false);
  });

  it("catches a party-size change", () => {
    expect(sameDraft(FORM, { ...FORM, size: 4 })).toBe(false);
  });

  it("catches an added table pick", () => {
    expect(sameDraft(FORM, { ...FORM, manualTables: ["6"] })).toBe(false);
  });

  it("catches a removed table pick", () => {
    expect(sameDraft({ ...FORM, manualTables: ["6", "7"] }, { ...FORM, manualTables: ["6"] })).toBe(false);
  });

  it("catches a genuine boolean flip", () => {
    expect(sameDraft(FORM, { ...FORM, repeatWeekly: true })).toBe(false);
  });

  it("catches a deposit typed then cleared to a different value", () => {
    expect(sameDraft({ ...FORM, deposit: "20" }, { ...FORM, deposit: "30" })).toBe(false);
  });

  it("catches a key present on one side with a real value", () => {
    expect(sameDraft({ ...FORM }, { ...FORM, notes: "window seat" })).toBe(false);
  });
});

describe("sameDraft — non-object inputs", () => {
  it("is false when either side is missing", () => {
    expect(sameDraft(null, FORM)).toBe(false);
    expect(sameDraft(FORM, null)).toBe(false);
    expect(sameDraft(undefined, undefined)).toBe(true); // identity short-circuit
  });
});
