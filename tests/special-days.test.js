// tests/special-days.test.js — v18.10.0
//
// Special days (src/lib/special-days.js): a date or a run of dates, closed or
// with its own hours, stored beside the weekdays in settings/operatingHours and
// read by `hoursFor(date)` before the weekday.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import {
  clampHours, sanitizeException, sanitizeExceptions, exceptionIndex, datesOf, overlapOf,
  specialDayRefusal, affectedBookings, pruneExceptions, splitExceptions, rangeLabel, specialHoursLabel,
  SPECIAL_MAX_DAYS, SPECIAL_KEEP_DAYS,
} from "../src/lib/special-days.js";
import { hoursFor, setHourExceptions, setWeekHours, DEFAULT_WEEK_HOURS } from "../src/lib/constants.js";
import { findTimes } from "../src/lib/booking-logic.js";
import { dueOccurrences } from "../src/lib/recurring.js";
import { specialDayEntry } from "../src/lib/activity.js";
import { addDays } from "../src/lib/day.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => stripComments(readFileSync(join(ROOT, p), "utf8")).join("\n");

const XMAS = { from: "2026-12-24", to: "2026-12-26", closed: true, open: 13, close: 22, note: "Christmas" };
const NYE = { from: "2026-12-31", to: "2026-12-31", closed: false, open: 19, close: 25, note: "New Year's Eve" };

afterEach(() => { setHourExceptions({}); setWeekHours(DEFAULT_WEEK_HOURS); });

describe("reading what is stored", () => {
  it("keeps the weekday bounds", () => {
    expect(clampHours(3, 30)).toEqual({ open: 6, close: 25 });
    expect(clampHours(20, 20)).toEqual({ open: 20, close: 21 });
    expect(clampHours("x", undefined)).toEqual({ open: 13, close: 22 });
  });
  it("reads a special day leniently and refuses what is not one", () => {
    expect(sanitizeException(XMAS)).toEqual(XMAS);
    expect(sanitizeException({ from: "2026-12-24" })).toEqual({ from: "2026-12-24", to: "2026-12-24", closed: false, open: 13, close: 22, note: "" });
    expect(sanitizeException({ from: "2026-12-24", to: "2026-12-01" }).to).toBe("2026-12-24");
    expect(sanitizeException({ from: "2026-12-24", note: "  a\n  b  " }).note).toBe("a b");
    expect(sanitizeException({ from: "24/12/2026" })).toBe(null);
    expect(sanitizeException({ from: "2026-02-31" })).toBe(null);
    expect(sanitizeException(null)).toBe(null);
  });
  it("cuts a run longer than the cap", () => {
    const ex = sanitizeException({ from: "2026-01-01", to: "2027-01-01" });
    expect(datesOf(ex)).toHaveLength(SPECIAL_MAX_DAYS);
  });
  it("keeps only path-safe ids", () => {
    expect(Object.keys(sanitizeExceptions({ ok1: XMAS, "bad/id": XMAS, x: { from: "nope" } }))).toEqual(["ok1"]);
    expect(sanitizeExceptions([XMAS])).toEqual({});
  });
});

describe("hoursFor follows a special day", () => {
  it("before the weekday, on every date of the run, and nowhere else", () => {
    setHourExceptions(exceptionIndex({ a: XMAS, b: NYE }));
    expect(hoursFor("2026-12-23")).toMatchObject({ closed: false, special: false, note: "" });
    ["2026-12-24", "2026-12-25", "2026-12-26"].forEach((d) => expect(hoursFor(d)).toMatchObject({ closed: true, special: true, note: "Christmas" }));
    expect(hoursFor("2026-12-31")).toEqual({ open: 19, close: 25, gridClose: 26, closed: false, special: true, note: "New Year's Eve" });
  });
  it("overrides a closed weekday with special hours", () => {
    const wk = {}; for (let i = 0; i < 7; i++) wk[i] = { open: 13, close: 22, closed: true };
    setWeekHours(wk);
    setHourExceptions(exceptionIndex({ b: NYE }));
    expect(hoursFor("2026-12-30").closed).toBe(true);
    expect(hoursFor("2026-12-31").closed).toBe(false);
  });
  it("two overlapping special days resolve the same way everywhere: earlier start, then id", () => {
    const idx = exceptionIndex({ z: { ...XMAS, from: "2026-12-25", note: "later" }, a: XMAS });
    expect(idx["2026-12-25"].note).toBe("Christmas");
    const same = exceptionIndex({ b: { ...XMAS, note: "b" }, a: { ...XMAS, note: "a" } });
    expect(same["2026-12-24"].note).toBe("a");
  });
  it("refuses times on a closed special day and offers its own hours on an open one", () => {
    setHourExceptions(exceptionIndex({ a: XMAS, b: NYE }));
    expect(findTimes("2026-12-25", 2, "either", [], 90, 20 * 60, [])).toEqual([]);
    const t = findTimes("2026-12-31", 2, "either", [], 90, 21 * 60, []);
    expect(t.length).toBeGreaterThan(0);
    // Minutes since midnight: none before the special day opens.
    t.forEach((m) => expect(m).toBeGreaterThanOrEqual(19 * 60));
  });
  it("a standing booking skips a closed special day", () => {
    setHourExceptions(exceptionIndex({ a: { ...XMAS, from: "2026-12-24", to: "2026-12-24" } }));
    const rule = { id: "r1", startDate: "2026-12-17", weekday: 4, time: "20:00", size: 2, active: true, skipDates: [] };
    const due = dueOccurrences([rule], [], "2026-12-17", 21).map((o) => o.date);
    expect(due).not.toContain("2026-12-24");
    expect(due).toContain("2026-12-31");
  });
});

describe("the editor's questions", () => {
  const today = "2026-12-01";
  it("refuses a broken or past draft, and an overlap, by name", () => {
    expect(specialDayRefusal({ from: "", to: "" }, {}, null, today)).toMatch(/first date/);
    expect(specialDayRefusal({ from: "2026-12-24", to: "2026-12-20", closed: true }, {}, null, today)).toMatch(/before the first/);
    expect(specialDayRefusal({ from: "2026-11-02", to: "2026-11-03", closed: true }, {}, null, today)).toMatch(/passed/);
    expect(specialDayRefusal({ from: "2026-12-02", to: addDays("2026-12-02", SPECIAL_MAX_DAYS), closed: true }, {}, null, today)).toMatch(/At most/);
    expect(specialDayRefusal({ from: "2026-12-25", to: "2026-12-27", closed: true }, { a: XMAS }, null, today)).toMatch(/overlap.*24\.12/);
    expect(specialDayRefusal({ from: "2026-12-30", to: "2026-12-30", closed: false, open: 22, close: 22 }, {}, null, today)).toMatch(/Opening is/);
  });
  it("lets a special day overlap itself while it is edited, and a run that has begun keep its start", () => {
    expect(specialDayRefusal({ ...XMAS, to: "2026-12-27" }, { a: XMAS }, "a", today)).toBe(null);
    expect(specialDayRefusal({ ...XMAS }, { a: XMAS }, "a", "2026-12-25")).toBe(null);
    expect(overlapOf({ a: XMAS }, { from: "2026-12-27", to: "2026-12-28" }, null)).toBe(null);
  });
  it("names the bookings left outside the new hours, and keeps the rest out of it", () => {
    const bk = [
      { id: "1", name: "Ana", date: "2026-12-31", time: "13:30", size: 2, status: "confirmed" },
      { id: "2", name: "Ben", date: "2026-12-31", time: "20:00", size: 4, status: "confirmed" },
      { id: "3", name: "Cleo", date: "2026-12-31", time: "23:50", size: 2, status: "pending" },
      { id: "4", name: "Dan", date: "2026-12-31", time: "13:00", size: 2, status: "cancelled" },
      { id: "5", name: "Eve", date: "2026-12-25", time: "20:00", size: 2, status: "seated" },
      { id: "6", name: "Fay", date: "2026-12-30", time: "13:00", size: 2, status: "confirmed" },
    ];
    // The last start is closing less 15 minutes, never past 23:45.
    expect(affectedBookings(bk, NYE).map((b) => b.name)).toEqual(["Ana", "Cleo"]);
    expect(affectedBookings(bk, { ...NYE, open: 13, close: 20 }).map((b) => b.name)).toEqual(["Ben", "Cleo"]);
    expect(affectedBookings(bk, XMAS).map((b) => b.name)).toEqual(["Eve"]);
    expect(affectedBookings(bk, null)).toEqual([]);
    // /code-review: a run already under way counts from today, so a past
    // booking nobody marked completed is not named.
    expect(affectedBookings(bk, XMAS, "2026-12-25").map((b) => b.name)).toEqual(["Eve"]);
    expect(affectedBookings(bk, XMAS, "2026-12-26")).toEqual([]);
    expect(affectedBookings(bk, NYE, "2026-12-01").map((b) => b.name)).toEqual(["Ana", "Cleo"]);
    expect(read("src/components/SpecialDayModal.jsx")).toMatch(/affectedBookings\(bookings, [^;]*, today\)/);
  });
});

describe("keeping and listing", () => {
  it("drops a special day 30 days after its last date, and returns its input when nothing goes", () => {
    const ex = { a: XMAS, b: NYE };
    expect(pruneExceptions(ex, addDays("2026-12-26", SPECIAL_KEEP_DAYS))).toBe(ex);
    expect(Object.keys(pruneExceptions(ex, addDays("2026-12-26", SPECIAL_KEEP_DAYS + 1)))).toEqual(["b"]);
  });
  it("splits upcoming (by first date) from past (most recent first)", () => {
    const { upcoming, past } = splitExceptions({ b: NYE, a: XMAS, c: { ...XMAS, from: "2026-12-01", to: "2026-12-02" } }, "2026-12-25");
    expect(upcoming.map((e) => e.id)).toEqual(["a", "b"]);
    expect(past.map((e) => e.id)).toEqual(["c"]);
  });
  it("labels a run and its hours, and the activity line names them", () => {
    expect(rangeLabel(XMAS, "2026-12-01")).toMatch(/^Thu.24\.12 – Sat.26\.12$/);
    expect(rangeLabel(NYE, "2026-12-01")).toMatch(/^Thu.31\.12$/);
    expect(specialHoursLabel(XMAS)).toBe("Closed");
    expect(specialHoursLabel(NYE)).toBe("19:00–01:00");
    expect(specialDayEntry("added", XMAS).text).toMatch(/^added a special day · .*24\.12.*26\.12.* · Closed · Christmas$/);
  });
});

describe("the hook carries both halves on every write", () => {
  const H = read("src/hooks/useOperatingHours.js");
  it("writes days and exceptions together, pruned", () => {
    expect(H).toMatch(/writeWithRev\("settings\/operatingHours", \{ days: nextWeek, exceptions \}/);
    expect(H).toMatch(/const exceptions = pruneExceptions\(nextEx, todayStr\(\)\);/);
    expect(H).toMatch(/persist\(next, cur\.exceptions\);/);
    expect(H).toMatch(/persist\(next, hoursRef\.current\.exceptions\);/);
  });
  it("reads them on every snapshot into hoursFor's index", () => {
    expect(H).toMatch(/sanitizeExceptions\(val\.exceptions\)/);
    expect(H).toMatch(/setHourExceptions\(exceptionIndex\(next\.exceptions\)\)/);
  });
  it("App hands the views one repaint key for both halves", () => {
    const A = read("src/App.jsx");
    expect(A).not.toMatch(/hoursSig=\{weekHours\}/);
    expect((A.match(/hoursSig=\{hoursSig\}/g) || []).length).toBe(3);
  });
});

// /code-review: a Save or Remove that wrote nothing (the hours not loaded yet,
// a missing permission) says so, instead of a button that seems to do nothing.
describe("the editor says when nothing was written", () => {
  const M = read("src/components/SpecialDayModal.jsx");
  it("on Save and on Remove", () => {
    expect(M).toMatch(/if \(onSave\(initial\.id, draft\) !== false\) onClose\(true\);\s*else setRefusal\(NOT_SAVED\);/);
    expect(M).toMatch(/if \(onRemove\(initial\.id\) !== false\) onClose\(true\);\s*else \{ setArmed\(false\); setRefusal\(NOT_SAVED\); \}/);
  });
  it("and the hook's two writers answer false when the write was refused", () => {
    const H = read("src/hooks/useOperatingHours.js");
    expect(H).toMatch(/if\(!loaded\.current\)\{\s*console\.warn\([^)]*\);\s*return false;/);
    expect(H).toMatch(/return persist\(cur\.week, \{ \.\.\.cur\.exceptions, \[key\]: ex \}/);
    expect(H).toMatch(/return persist\(cur\.week, next,/);
  });
});
