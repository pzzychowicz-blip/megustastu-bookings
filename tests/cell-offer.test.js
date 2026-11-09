// tests/cell-offer.test.js — v18.16.0
//
// An empty cell of the Timeline starts a booking. What a cell offers is pure
// (src/lib/cell-offer.js); what the view does with a pointer is pinned in
// tests/timeline-drag.test.js. The rule this file holds: a cell offers exactly
// the minutes the form's Save would accept for the time, minus a blocked table,
// so nobody opens a form from the grid that the form then refuses.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { appCode } from "./app-source.js";
import { CELL_MINS, cellAt, cellOffer } from "../src/lib/cell-offer.js";
import { draftRefusal, timeRefusal } from "../src/lib/booking-save.js";
import { toTime, lastStartMins } from "../src/lib/booking-logic.js";
import { setWeekHours, setHourExceptions, DEFAULT_WEEK_HOURS, hoursFor } from "../src/lib/constants.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const code = (p) => stripComments(readFileSync(join(ROOT, p), "utf8")).join("\n");

const D = "2026-11-09";   // a Monday
afterEach(() => { setWeekHours(DEFAULT_WEEK_HOURS); setHourExceptions(null); });

describe("cellAt: the quarter under a pointer", () => {
  const OPEN = 13 * 60;
  it("is the quarter the pixel falls in, from its first pixel to its last", () => {
    expect(cellAt(0, 2.4, OPEN)).toBe(OPEN);
    expect(cellAt(35.9, 2.4, OPEN)).toBe(OPEN);          // 15 min = 36px at 2.4px a minute
    expect(cellAt(36, 2.4, OPEN)).toBe(OPEN + 15);
    expect(cellAt(36 * 23 + 1, 2.4, OPEN)).toBe(OPEN + 23 * 15);
  });
  it("does not depend on the zoom", () => {
    for (const perMin of [1.2, 2.4, 3.6, 12]) {
      expect(cellAt(perMin * 15 * 7 + 0.5, perMin, OPEN)).toBe(OPEN + 7 * 15);
    }
  });
  it("answers nothing for a pointer left of the grid or a grid with no width", () => {
    expect(cellAt(-1, 2.4, OPEN)).toBeNull();
    expect(cellAt(10, 0, OPEN)).toBeNull();
    expect(cellAt(NaN, 2.4, OPEN)).toBeNull();
    expect(cellAt(10, 2.4, NaN)).toBeNull();
  });
  it("a cell is the app's quarter hour", () => {
    expect(CELL_MINS).toBe(15);
  });
});

describe("cellOffer: what a cell offers", () => {
  const ctx = { date: D, blocks: [] };
  it("offers the table and the time, as the form writes a time", () => {
    expect(cellOffer("5", 18 * 60 + 15, ctx)).toEqual({ tableId: "5", time: "18:15" });
  });
  it("offers every quarter from opening to the last start, and none outside", () => {
    const h = hoursFor(D);
    const last = lastStartMins(h.close);
    expect(cellOffer("5", h.open * 60, ctx)).not.toBeNull();
    expect(cellOffer("5", last, ctx)).not.toBeNull();
    expect(cellOffer("5", last + 15, ctx)).toBeNull();
    expect(cellOffer("5", h.open * 60 - 15, ctx)).toBeNull();
    // The grid runs an hour past close, and none of that hour is offered.
    for (let m = h.close * 60; m < h.gridClose * 60; m += 15) expect(cellOffer("5", m, ctx)).toBeNull();
  });
  it("agrees with the form's Save for every quarter of the day, both ways", () => {
    const h = hoursFor(D);
    for (let m = (h.open - 1) * 60; m <= (h.gridClose + 1) * 60 && m < 24 * 60; m += 15) {
      const form = draftRefusal({ name: "Ana", date: D, time: toTime(m) }, null);
      expect(cellOffer("5", m, ctx) === null, toTime(m)).toBe(form !== null);
    }
  });
  it("offers nothing on a closed day", () => {
    setWeekHours(Object.assign({}, DEFAULT_WEEK_HOURS, { 1: { closed: true, open: 13, close: 22 } }));
    expect(hoursFor(D).closed).toBe(true);
    expect(cellOffer("5", 18 * 60, ctx)).toBeNull();
  });
  it("offers nothing under a table block, on that table only", () => {
    const blocks = [{ id: "b1", tableId: "5", date: D, from: "18:00", to: "19:00" }];
    const c = { date: D, blocks };
    expect(cellOffer("5", 18 * 60, c)).toBeNull();
    expect(cellOffer("5", 18 * 60 + 45, c)).toBeNull();
    expect(cellOffer("5", 19 * 60, c)).not.toBeNull();        // a block ends where the next cell starts
    expect(cellOffer("5", 17 * 60 + 45, c)).not.toBeNull();
    expect(cellOffer("6", 18 * 60, c)).not.toBeNull();
  });
  it("a block on another date, or one that cannot be read, blocks nothing", () => {
    const other = { date: D, blocks: [{ id: "b1", tableId: "5", date: "2026-11-10", from: "18:00", to: "19:00" }] };
    const bad = { date: D, blocks: [{ id: "b2", tableId: "5", date: D, from: 2000, to: "19:00" }] };
    expect(cellOffer("5", 18 * 60, other)).not.toBeNull();
    expect(cellOffer("5", 18 * 60, bad)).not.toBeNull();
  });
  it("an all-day block takes the whole row", () => {
    const c = { date: D, blocks: [{ id: "b1", tableId: "5", date: D, allDay: true }] };
    const h = hoursFor(D);
    for (let m = h.open * 60; m <= lastStartMins(h.close); m += 15) expect(cellOffer("5", m, c)).toBeNull();
  });
  it("answers nothing without a table, a minute or a date", () => {
    expect(cellOffer("", 18 * 60, ctx)).toBeNull();
    expect(cellOffer("5", NaN, ctx)).toBeNull();
    expect(cellOffer("5", 18 * 60, null)).toBeNull();
    expect(cellOffer("5", 18 * 60, { blocks: [] })).toBeNull();
  });
});

describe("timeRefusal: one rule for the form, the cell and the drag", () => {
  it("draftRefusal asks it, and keeps no copy of the three checks", () => {
    const save = code("lib/booking-save.js");
    const draft = save.slice(save.indexOf("export function draftRefusal"), save.indexOf("export function timeRefusal"));
    expect(draft).toMatch(/return timeRefusal\(f\.date,toMins\(f\.time\)\);/);
    expect(draft).not.toMatch(/lastStartMins|hoursFor|closed/);
    expect(code("lib/cell-offer.js")).toMatch(/if \(timeRefusal\(ctx\.date, mins\)\) return null;/);
  });
  it("says the form's sentences", () => {
    expect(timeRefusal(D, 12 * 60).message).toBe("Bookings on this day are accepted between 13:00 and 22:00.");
    expect(timeRefusal(D, 22 * 60).message).toBe("The last start on Mondays is 21:45.");
    expect(timeRefusal(D, 18 * 60)).toBeNull();
  });
});

describe("the form opens with the cell's time and its table preferred, not picked", () => {
  const app = appCode();
  const door = app.slice(app.indexOf("function newAtCell("), app.indexOf("function newAtCell(") + 400);
  it("goes through the gated door, on the form's own empty draft", () => {
    expect(door).toMatch(/return openNewWith\(Object\.assign\(\{\},EMPTY_FORM,\{/);
  });
  it("sets the time and the preferred table, and never a hand pick", () => {
    expect(door).toMatch(/time:time,/);
    expect(door).toMatch(/preferredTables:\[tableId\]/);
    expect(door).not.toMatch(/manualTables/);
  });
  it("reaches the memoised view as a stable wrapper", () => {
    expect(app).toMatch(/onNewAt:function\(tableId,time\)\{R\.current\.newAtCell\(tableId,time\);\}/);
    expect(app).toMatch(/onNewAt=\{VA\.onNewAt\}/);
  });
});

describe("it is this device's switch, on by default", () => {
  const hook = code("hooks/useShellPrefs.js");
  it("stores only the non-default value", () => {
    expect(hook).toMatch(/const CELL_BOOK_KEY="mgt-tl-cellbook";/);
    expect(hook).toMatch(/return localStorage\.getItem\(CELL_BOOK_KEY\)!=="0";\}catch\{return true;\}/);
    expect(hook).toMatch(/if\(next\) localStorage\.removeItem\(CELL_BOOK_KEY\); else localStorage\.setItem\(CELL_BOOK_KEY,"0"\);/);
  });
  it("never reaches the database", () => {
    const toggle = hook.slice(hook.indexOf("function onToggleCellBook"), hook.indexOf("const [appWidth"));
    expect(toggle).not.toMatch(/saveUserPrefs/);
  });
  it("has one switch, in the Timeline group, and the view takes it as a scalar", () => {
    const settings = code("components/Settings.jsx");
    expect(settings).toMatch(/<Toggle label="Tap an empty cell to book" on=\{cellBook\} onClick=\{onToggleCellBook\} \/>/);
    expect(settings.indexOf('label="Tap an empty cell to book"')).toBeGreaterThan(settings.indexOf(">Timeline<"));
    expect(appCode()).toMatch(/cellBook=\{cellBook\}\s+onNewAt=\{VA\.onNewAt\}/);
  });
});
