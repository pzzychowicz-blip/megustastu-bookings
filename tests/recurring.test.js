// tests/recurring.test.js
//
// v18.3.3 — standing (weekly) bookings.
//
// B2: "Repeat weekly" wrote its rule BEFORE the new-booking save's capacity
// refusals, so a refused save left the rule behind, the generator then created
// the booking the form had just refused, and every further tap on Save added
// another rule. Measured on DEV before the fix: one refused save plus Confirm on
// the "Kitchen may be busy" its generated booking raised = two rules. There is
// no DOM test environment here (tests/CLAUDE.md), so the save's ORDER is pinned
// by reading `doSaveNew` with its comments stripped.
//
// B3: a rule had no start, so the generator booked every matching weekday from
// TODAY. Measured on DEV before the fix: "Repeat weekly" on Thu 22 Oct also
// booked 1, 8 and 15 Oct. `dueOccurrences` is the generator's decision, pure.
// The dates below are arguments, never compared with a live clock, so they are
// arithmetic fixtures and safe as literals (tests/CLAUDE.md's date row).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { dueOccurrences, ruleStart } from "../src/lib/recurring.js";
import { setWeekHours, DEFAULT_WEEK_HOURS } from "../src/lib/constants.js";

const APP = stripComments(
  readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).join("\n");

// The body of `doSaveNew`, from its declaration to the next top-level function.
function doSaveNewBody() {
  const start = APP.indexOf("function doSaveNew(");
  const end = APP.indexOf("function doSave(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
}

describe("Repeat weekly writes its rule only once the save cannot be refused (B2)", () => {
  it("calls addRule exactly once in doSaveNew", () => {
    expect(doSaveNewBody().split("addRule(").length - 1).toBe(1);
  });

  it("calls it after every refusal and before the booking write", () => {
    const body = doSaveNewBody();
    const rule = body.indexOf("addRule(");
    const lastRefusal = body.lastIndexOf("setError(");
    const write = body.indexOf("saveBookings(");
    expect(lastRefusal).toBeGreaterThan(-1);
    expect(rule).toBeGreaterThan(lastRefusal);
    expect(write).toBeGreaterThan(rule);
  });

  it("stamps the first occurrence with the id the rule is written under", () => {
    const body = doSaveNewBody();
    expect(body).toMatch(/addRule\(\{id:recStampId,/);
    expect(body).toMatch(/recurringId:recStampId/);
  });
});

// ── B3: where a rule starts ─────────────────────────────────────────────────

const TODAY = "2026-10-01";          // a Thursday (getUTCDay 4)
const rule = (over) => Object.assign(
  { id: "R1", name: "Ana", phone: "", size: 2, weekday: 4, time: "20:00",
    preference: "auto", notes: "", active: true, skipDates: [], createdAt: 1 }, over);
// The booking "Repeat weekly" was ticked on: a genId id, stamped with the rule.
const formBooking = (date) => ({ id: "m" + date, recurringId: "R1", recurringDate: date, date });
// One the generator made: the deterministic id.
const genBooking = (date) => ({ id: "rR1_" + date, recurringId: "R1", recurringDate: date, date });
const dates = (due) => due.map((o) => o.date);

describe("ruleStart", () => {
  it("is the rule's own startDate when it has one", () => {
    expect(ruleStart(rule({ startDate: "2026-10-22" }), [])).toBe("2026-10-22");
  });
  it("is the earliest booking the FORM stamped, for an older rule", () => {
    expect(ruleStart(rule(), [genBooking("2026-10-08"), formBooking("2026-10-22"), formBooking("2026-10-29")]))
      .toBe("2026-10-22");
  });
  it("ignores the generator's own bookings", () => {
    expect(ruleStart(rule(), [genBooking("2026-10-01"), genBooking("2026-10-08")])).toBe(null);
  });
  it("ignores another rule's bookings and a malformed startDate", () => {
    const other = { id: "x", recurringId: "R2", recurringDate: "2026-09-01" };
    expect(ruleStart(rule({ startDate: "22.10.2026" }), [other])).toBe(null);
  });
});

describe("dueOccurrences", () => {
  it("never books the rule's own start date, even before its booking arrives", () => {
    // The race measured on DEV: the rule reached a device ahead of its booking.
    expect(dates(dueOccurrences([rule({ startDate: "2026-10-08" })], [], TODAY, 14)))
      .toEqual(["2026-10-15"]);
  });
  it("does not book the weeks before a rule starts (the DEV measurement)", () => {
    const due = dueOccurrences([rule({ startDate: "2026-10-22" })], [formBooking("2026-10-22")], TODAY, 28);
    expect(dates(due)).toEqual(["2026-10-29"]);
  });
  it("derives the start for an older rule from its form booking", () => {
    const due = dueOccurrences([rule()], [formBooking("2026-10-15")], TODAY, 28);
    expect(dates(due)).toEqual(["2026-10-22", "2026-10-29"]);
  });
  it("keeps the old behaviour for a rule with no start to find", () => {
    expect(dates(dueOccurrences([rule()], [], TODAY, 14)))
      .toEqual(["2026-10-01", "2026-10-08", "2026-10-15"]);
  });
  it("skips existing, skipped and paused occurrences", () => {
    const r = rule({ startDate: TODAY, skipDates: ["2026-10-08"] });
    expect(dates(dueOccurrences([r], [formBooking(TODAY)], TODAY, 14))).toEqual(["2026-10-15"]);
    expect(dueOccurrences([rule({ active: false })], [], TODAY, 14)).toEqual([]);
  });
  it("skips a closed day, and a time past the day's last start", () => {
    try {
      setWeekHours(Object.assign({}, DEFAULT_WEEK_HOURS, { 4: { open: 13, close: 22, closed: true } }));
      expect(dueOccurrences([rule()], [], TODAY, 14)).toEqual([]);
      // 22:00 close: the last start is 21:45, which the form, the Time field
      // and findTimes all name. The loop tested the close itself.
      setWeekHours(DEFAULT_WEEK_HOURS);
      expect(dates(dueOccurrences([rule({ time: "21:45" })], [], TODAY, 0))).toEqual([TODAY]);
      expect(dueOccurrences([rule({ time: "21:50" })], [], TODAY, 0)).toEqual([]);
    } finally { setWeekHours(DEFAULT_WEEK_HOURS); }
  });
});

describe("the wiring", () => {
  it("App's generator asks dueOccurrences, and a new rule carries startDate", () => {
    expect(APP).toMatch(/const toCreate=dueOccurrences\(recurring\.rules,bookings,todayStr\(\),recurring\.horizonWeeks\*7\)/);
    expect(doSaveNewBody()).toMatch(/addRule\(\{id:recStampId,startDate:f\.date,/);
  });
  it("useRecurring's whitelist keeps startDate", () => {
    const HOOK = stripComments(
      readFileSync(new URL("../src/hooks/useRecurring.js", import.meta.url), "utf8")).join("\n");
    expect(HOOK).toMatch(/startDate: r\.startDate/);
  });
});
