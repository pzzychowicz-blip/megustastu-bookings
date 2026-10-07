// tests/drop-plan.test.js — v18.4.5 (ROADMAP #17)
//
// `planDrop` is what a timeline drop does, moved out of BookingApp. When it
// moved it was run against the old `dropOnTable` (lifted from the commit
// before) over 70,538 generated drops, with the same toast and the same written
// list every time; that comparison is in REFACTOR_LOG, since it needs the old
// code. These are the cases that stay: one per outcome, each asserting what is
// WRITTEN and what the toast says.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planDrop } from "../src/lib/drop-plan.js";
import { ALL_TABLES } from "../src/lib/constants.js";
import { comboCapBest } from "../src/lib/booking-logic.js";
import { todayStr, addDays } from "../src/lib/day.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const TODAY = todayStr();
// A day that is not today: no party is live, and the optimiser is always on.
const D = addDays(TODAY, 2);
const stamp = (action, user) => ({ action, by: user });

const bk = (id, time, size, tables, extra) => Object.assign(
  { id, name: id.toUpperCase(), date: D, time, size, status: "confirmed", tables, history: [] }, extra || {});

const drop = (list, id, targetId, more) => planDrop(Object.assign({
  id, targetId, liveBookings: list, bookings: list, viewDate: D, nowMins: 600, today: TODAY,
  tableBlocks: [], autoOptimizer: true, user: "u@x", stamp,
}, more || {}));
const byId = (list, id) => list.find((b) => b.id === id);

describe("planDrop: nothing to do", () => {
  it("answers null for an unknown, cancelled, completed or other-day booking, and for its own row", () => {
    const list = [bk("a", "19:00", 2, ["2"]), bk("gone", "19:00", 2, ["3"], { status: "cancelled" }),
      bk("done", "19:00", 2, ["4"], { status: "completed" }), bk("far", "19:00", 2, ["6"], { date: addDays(D, 1) })];
    expect(drop(list, "nobody", "3")).toBeNull();
    expect(drop(list, "gone", "6")).toBeNull();
    expect(drop(list, "done", "6")).toBeNull();
    expect(drop(list, "far", "5A")).toBeNull();
    expect(drop(list, "a", "2")).toBeNull();
  });
});

describe("planDrop: a free table", () => {
  it("moves the booking, locks it, and says where", () => {
    const list = [bk("a", "19:00", 2, ["2"]), bk("b", "19:00", 2, ["4"])];
    const plan = drop(list, "a", "3");
    expect(plan.done).toBe("A moved to 3.");
    const out = plan.transform(list);
    expect(byId(out, "a")).toMatchObject({ tables: ["3"], _manual: true, _locked: true, _conflict: false });
    expect(byId(out, "a").history).toEqual([{ action: "moved to 3 (drag)", by: "u@x" }]);
    expect(byId(out, "b")).toBe(list[1]);          // nobody else is touched
  });

  it("takes joined tables when the row's own table is too small", () => {
    const list = [bk("a", "19:00", 4, ["7"])];
    const plan = drop(list, "a", "2");
    const tables = byId(plan.transform(list), "a").tables;
    expect(tables).toContain("2");
    expect(tables.length).toBeGreaterThan(1);
    expect(comboCapBest(tables)).toBeGreaterThanOrEqual(4);
    expect(plan.done).toBe("A moved to " + tables.join("+") + ".");
  });

  it("a completed booking's table is free", () => {
    const list = [bk("a", "19:00", 2, ["2"]), bk("done", "19:00", 2, ["3"], { status: "completed" })];
    expect(drop(list, "a", "3").done).toBe("A moved to 3.");
  });
});

describe("planDrop: one party in the way", () => {
  it("swaps the two, and locks ONLY the one that was dragged (v17.10.0)", () => {
    const list = [bk("a", "19:00", 2, ["2"]), bk("b", "19:00", 2, ["3"])];
    const plan = drop(list, "a", "3");
    expect(plan.done).toBe("A and B — tables swapped.");
    const out = plan.transform(list);
    expect(byId(out, "a")).toMatchObject({ tables: ["3"], _manual: true, _locked: true });
    expect(byId(out, "b")).toMatchObject({ tables: ["2"], _manual: false, _locked: false });
    expect(byId(out, "a").history[0].action).toBe("swapped tables with B (2 → 3)");
    expect(byId(out, "b").history[0].action).toBe("swapped tables with A (3 → 2)");
  });

  it("a party that was already locked (a walk-in) keeps its lock on its new table", () => {
    const list = [bk("a", "19:00", 2, ["2"]), bk("b", "19:00", 2, ["3"], { _manual: true, _locked: true })];
    const out = drop(list, "a", "3").transform(list);
    expect(byId(out, "b")).toMatchObject({ tables: ["2"], _manual: true, _locked: true });
  });

  it("refuses to move a seated party, by name", () => {
    const list = [bk("a", "19:00", 2, ["2"]), bk("b", "19:00", 2, ["3"], { status: "seated" })];
    expect(drop(list, "a", "3")).toEqual({ refuse: "B is seated on 3's tables — can't move them." });
  });

  it("displaces when there is nothing to swap with, and re-seats the other party unlocked", () => {
    // `a` has no table, so there is no set to hand `b` in exchange.
    const list = [bk("a", "19:00", 2, []), bk("b", "19:00", 2, ["3"], { _manual: true, _locked: true })];
    const plan = drop(list, "a", "3");
    expect(plan.done).toBe("A moved to 3 — B reassigned.");
    const out = plan.transform(list);
    expect(byId(out, "a")).toMatchObject({ tables: ["3"], _manual: true, _locked: true });
    const b = byId(out, "b");
    expect(b.tables.length).toBeGreaterThan(0);
    expect(b.tables).not.toContain("3");
    expect(b).toMatchObject({ _manual: false, _locked: false });
    expect(b._conflict).toBeFalsy();
  });

  it("refuses a displacement that would leave the other party with no table", () => {
    // Every other table is held by a locked party, so `b` has nowhere to go.
    const others = ALL_TABLES.map((t) => t.id).filter((t) => t !== "3")
      .map((t, i) => bk("x" + i, "19:00", 2, [t], { _manual: true, _locked: true }));
    const list = [bk("a", "19:00", 2, []), bk("b", "19:00", 2, ["3"])].concat(others);
    expect(drop(list, "a", "3")).toEqual({ refuse: "Can't re-seat the parties there without stranding one — use Manual assign." });
  });
});

describe("planDrop: the table cannot take the party", () => {
  it("names a block on the target", () => {
    const list = [bk("a", "19:00", 2, ["2"])];
    const tableBlocks = [{ id: "k", tableId: "3", date: D, allDay: true }];
    expect(drop(list, "a", "3", { tableBlocks })).toEqual({ refuse: "Table 3 is blocked then." });
  });

  it("says the tables to join are busy when every combination holds a seated party or a block", () => {
    const seated = ALL_TABLES.map((t) => t.id).filter((t) => t !== "2" && t !== "7")
      .map((t, i) => bk("s" + i, "19:00", 2, [t], { status: "seated" }));
    const list = [bk("a", "19:00", 4, ["7"])].concat(seated);
    expect(drop(list, "a", "2")).toEqual({ refuse: "The tables needed to join with 2 are busy or blocked then." });
  });

  it("says a party no joined set can seat will not fit", () => {
    const list = [bk("a", "19:00", 60, [])];
    expect(drop(list, "a", "2")).toEqual({ refuse: "Party of 60 won't fit at 2, even with joined tables." });
  });
});

describe("planDrop: which list it reads", () => {
  it("decides occupancy from liveBookings and runs the transform on the list it is handed", () => {
    const shown = [bk("a", "19:00", 2, ["2"])];
    const stored = shown.concat([bk("b", "19:00", 2, ["3"])]);   // `b` is not on screen
    const plan = drop(shown, "a", "3", { bookings: stored });
    expect(plan.done).toBe("A moved to 3.");
    expect(plan.transform(stored).map((b) => b.id)).toEqual(["a", "b"]);
  });
});

describe("BookingApp's dropOnTable", () => {
  const App = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "App.jsx"), "utf8")).join("\n");
  const fn = App.slice(App.indexOf("function dropOnTable("), App.indexOf("function requestDelete("));

  it("is the gate, the plan and the two side effects, and nothing else", () => {
    expect(fn).toMatch(/^function dropOnTable\(id,targetId\)\{if\(refused\("bookingAssign"\)\)return;/);
    expect(fn).toMatch(/planDrop\(\{/);
    expect(fn).toMatch(/liveBookings:liveBookings,bookings:bookings,/);
    // The success toast is gated on the save's boolean (v15.4.0): a refused
    // write is never shown as a move.
    expect(fn).toMatch(/if\(saveBookings\(plan\.transform\)\) flashDragMsg\(plan\.done,true\);/);
    expect(fn.split("\n").length).toBeLessThan(12);
  });
});
