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
import { CELL_MINS, DRAG_SLOP, cellAt, cellOffer, dragAxis, draggedStart, nextFreeAfter } from "../src/lib/cell-offer.js";
import { draftRefusal, timeRefusal } from "../src/lib/booking-save.js";
import { toTime, lastStartMins } from "../src/lib/booking-logic.js";
import { setWeekHours, setHourExceptions, setTurnBuffer, DEFAULT_WEEK_HOURS, hoursFor } from "../src/lib/constants.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const code = (p) => stripComments(readFileSync(join(ROOT, p), "utf8")).join("\n");

const D = "2026-11-09";   // a Monday
afterEach(() => { setWeekHours(DEFAULT_WEEK_HOURS); setHourExceptions(null); setTurnBuffer(null); });

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
  const door = app.slice(app.indexOf("function newAtCell("), app.indexOf("function openNewAfter("));
  const draft = app.slice(app.indexOf("function newDraft("), app.indexOf("function openNewWith("));
  // v18.16.0 (/code-review): one spelling of what a new booking starts with. The
  // cell wrote the seed-date rule and the literal out a second time.
  it("goes through the gated door, on the draft + New itself starts with", () => {
    expect(door).toContain("function newAtCell(tableId,time){return openNewWith(newDraft({time:time,preferredTables:[tableId]}));}");
    expect(draft).toContain("return Object.assign({},EMPTY_FORM,{date:seedDate,phone:\"\",time:newBookingTime(seedDate,today,nowMins),size:generalSettings.defaultBookingSize},over);");
    expect(app).toContain("openForm(draft||newDraft());");
    expect((app.match(/Object\.assign\(\{\},EMPTY_FORM,\{date:seedDate/g) || []).length, "the literal, once").toBe(1);
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

// ── v18.16.0: a block dragged sideways ───────────────────────────────────────
// The gesture cannot be run here (a drag spans frames). Its two decisions can.
// ── Commit 9: `N` with a Timeline block focused ──────────────────────────────
describe("nextFreeAfter: a new booking on that table, right after that booking", () => {
  const bk = (o) => Object.assign({ id: "b1", date: D, time: "19:00", duration: 90, status: "confirmed", tables: ["5"] }, o);
  const ctx = (o) => Object.assign({ date: D, blocks: [], nowMins: 12 * 60, today: "2026-11-01" }, o);
  it("is the booking's end, on its table", () => {
    expect(nextFreeAfter(bk(), "5", ctx())).toEqual({ tableId: "5", time: "20:30" });
    // the row that was focused, for a party on several tables
    expect(nextFreeAfter(bk({ tables: ["3", "4", "5"] }), "4", ctx())).toEqual({ tableId: "4", time: "20:30" });
  });
  it("an end off the quarter is the next quarter", () => {
    expect(nextFreeAfter(bk({ time: "19:10" }), "5", ctx()).time).toBe("20:45");
    expect(nextFreeAfter(bk({ duration: 61 }), "5", ctx()).time).toBe("20:15");
  });
  it("waits out the turnaround buffer, which is when the table is free", () => {
    setTurnBuffer({ turnaroundEnabled: true, turnaroundMin: 15 });
    expect(nextFreeAfter(bk(), "5", ctx()).time).toBe("20:45");
  });
  it("a seated party running over frees its table now, not at its booked end", () => {
    const seated = bk({ status: "seated", time: "13:00", duration: 60 });
    expect(nextFreeAfter(seated, "5", ctx({ today: D, nowMins: 15 * 60 + 7 })).time).toBe("15:15");
    // …and on another day its booked end stands
    expect(nextFreeAfter(seated, "5", ctx()).time).toBe("14:00");
  });
  it("skips a block on that table, as a cell under one offers nothing", () => {
    const blocks = [{ id: "bl", tableId: "5", date: D, from: "20:30", to: "21:15" }];
    expect(nextFreeAfter(bk(), "5", ctx({ blocks })).time).toBe("21:15");
    expect(nextFreeAfter(bk(), "6", ctx({ blocks })).time).toBe("20:30");
  });
  it("offers only what a cell offers: nothing past the last start, nothing on a closed day", () => {
    const last = lastStartMins(hoursFor(D).close);
    expect(nextFreeAfter(bk({ time: toTime(last - 90) }), "5", ctx()).time).toBe(toTime(last));
    expect(nextFreeAfter(bk({ time: toTime(last - 75) }), "5", ctx())).toBeNull();
    setWeekHours(Object.assign({}, DEFAULT_WEEK_HOURS, { 1: { closed: true, open: 13, close: 22 } }));
    expect(nextFreeAfter(bk(), "5", ctx())).toBeNull();
  });
  it("answers what cellOffer answers for that minute, over a whole day of ends", () => {
    const h = hoursFor(D);
    for (let m = h.open * 60; m < h.close * 60; m += 15) {
      const got = nextFreeAfter(bk({ time: toTime(m), duration: 60 }), "5", ctx());
      const want = cellOffer("5", m + 60, ctx());
      if (want) expect(got, toTime(m)).toEqual(want); else expect(got, toTime(m)).toBeNull();
    }
  });
  it("answers nothing without a booking, a table, a date, or a time it can read", () => {
    expect(nextFreeAfter(undefined, "5", ctx())).toBeNull();
    expect(nextFreeAfter(bk(), "", ctx())).toBeNull();
    expect(nextFreeAfter(bk(), "5", null)).toBeNull();
    expect(nextFreeAfter(bk({ time: "soon" }), "5", ctx())).toBeNull();
  });
});

describe("N on a focused block opens the cell's door, or the plain form", () => {
  const app = appCode();
  const fn = app.slice(app.indexOf("function openNewAfter("), app.indexOf("function openNewAfter(") + 420);
  it("asks nextFreeAfter about the viewed day, with the clock the Timeline draws by", () => {
    expect(fn).toContain("const at=nextFreeAfter(bookings.find(function(b){return b.id===id;}),tableId,{date:viewDate,blocks:tableBlocks,nowMins:nowMins,today:todayStr()});");
  });
  it("goes through newAtCell, so the table is preferred and the door is the gated one; no time left is the plain N", () => {
    expect(fn).toContain("if(at) newAtCell(at.tableId,at.time); else openNew();");
  });
  it("the block says which row it stands on, and an Unplaced block says none", () => {
    const view = code("components/TimelineView.jsx");
    expect(view).toContain("data-tbl={leaving || homeTable == null ? undefined : homeTable}");
  });
});

describe("dragAxis: one direction per drag", () => {
  it("has not decided inside the slop, on either axis", () => {
    expect(DRAG_SLOP).toBe(6);
    expect(dragAxis(0, 0, true)).toBeNull();
    expect(dragAxis(6, 6, true)).toBeNull();
    expect(dragAxis(-6, 3, true)).toBeNull();
  });
  it("the larger travel wins, either way along it", () => {
    expect(dragAxis(7, 2, true)).toBe("x");
    expect(dragAxis(-30, 12, true)).toBe("x");
    expect(dragAxis(2, 7, true)).toBe("y");
    expect(dragAxis(12, -30, true)).toBe("y");
  });
  it("a tie is the table drag, the older gesture", () => {
    expect(dragAxis(9, 9, true)).toBe("y");
    expect(dragAxis(-9, 9, true)).toBe("y");
  });
  it("a block that cannot be re-timed only ever drags to a table, on vertical travel alone", () => {
    expect(dragAxis(40, 0, false)).toBeNull();        // a sideways wobble is still a click
    expect(dragAxis(40, 6, false)).toBeNull();
    expect(dragAxis(40, 7, false)).toBe("y");
    expect(dragAxis(0, -7, false)).toBe("y");
  });
});

describe("draggedStart: the quarter a dragged block has reached", () => {
  const OPEN = 13 * 60, END = 23 * 60;      // the grid: 13:00 to 23:00
  const at = (start, px) => draggedStart(start, px, 2.4, OPEN, END);   // 36px a quarter
  it("less than half a quarter of travel is no move", () => {
    expect(at(19 * 60, 0)).toBe(19 * 60);
    expect(at(19 * 60, 17.9)).toBe(19 * 60);
    expect(at(19 * 60, -17.9)).toBe(19 * 60);
  });
  it("then it steps by the quarter, both ways", () => {
    expect(at(19 * 60, 18)).toBe(19 * 60 + 15);
    expect(at(19 * 60, 53.9)).toBe(19 * 60 + 15);
    expect(at(19 * 60, 54)).toBe(19 * 60 + 30);
    expect(at(19 * 60, -18.1)).toBe(19 * 60 - 15);
    expect(at(19 * 60, -36 * 4)).toBe(18 * 60);
  });
  it("does not depend on the zoom", () => {
    for (const perMin of [1.2, 2.4, 4.8, 12]) {
      expect(draggedStart(19 * 60, perMin * 45, perMin, OPEN, END)).toBe(19 * 60 + 45);
    }
  });
  it("a booking standing off the quarter keeps its minute until it is dragged, then lands on one", () => {
    const start = 19 * 60 + 10;
    expect(at(start, 10)).toBe(start);
    expect(at(start, 0)).toBe(start);
    expect(at(start, 24)).toBe(19 * 60 + 15);        // 19:20 raw, the nearest quarter
    expect(at(start, -24)).toBe(19 * 60);
  });
  it("is held inside the grid", () => {
    expect(at(13 * 60 + 30, -500)).toBe(OPEN);
    expect(at(21 * 60, 5000)).toBe(END - 15);
  });
  it("a start past the grid's last cell does not move without travel", () => {
    expect(at(END - 5, 0)).toBe(END - 5);
  });
  it("answers the start itself for a width it cannot read", () => {
    expect(draggedStart(19 * 60, 100, 0, OPEN, END)).toBe(19 * 60);
    expect(draggedStart(19 * 60, NaN, 2.4, OPEN, END)).toBe(19 * 60);
  });
});
