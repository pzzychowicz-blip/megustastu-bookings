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
import { planDrop, dropPreview, dropCheck } from "../src/lib/drop-plan.js";
import { releaseSwapped } from "../src/lib/booking-save.js";
import { movedNames } from "../src/lib/delete-undo.js";
import { ALL_TABLES } from "../src/lib/constants.js";
import { comboCapBest } from "../src/lib/booking-logic.js";
import { todayStr, addDays } from "../src/lib/day.js";
import { stripComments } from "../scripts/strip-comments.mjs";
import { appCode } from "./app-source.js";

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
    const list = [bk("a", "19:00", 2, ["3"]), bk("gone", "19:00", 2, ["4"], { status: "cancelled" }),
      bk("done", "19:00", 2, ["5"], { status: "completed" }), bk("far", "19:00", 2, ["8"], { date: addDays(D, 1) })];
    expect(drop(list, "nobody", "4")).toBeNull();
    expect(drop(list, "gone", "8")).toBeNull();
    expect(drop(list, "done", "8")).toBeNull();
    expect(drop(list, "far", "6")).toBeNull();
    expect(drop(list, "a", "3")).toBeNull();
  });
});

describe("planDrop: a free table", () => {
  it("moves the booking, locks it, and says where", () => {
    const list = [bk("a", "19:00", 2, ["3"]), bk("b", "19:00", 2, ["5"])];
    const plan = drop(list, "a", "4");
    expect(plan.done).toBe("A moved to 4.");
    const out = plan.transform(list);
    expect(byId(out, "a")).toMatchObject({ tables: ["4"], _manual: true, _locked: true, _conflict: false });
    expect(byId(out, "a").history).toEqual([{ action: "moved to 4 (drag)", by: "u@x" }]);
    expect(byId(out, "b")).toBe(list[1]);          // nobody else is touched
  });

  it("takes joined tables when the row's own table is too small", () => {
    const list = [bk("a", "19:00", 4, ["9"])];
    const plan = drop(list, "a", "3");
    const tables = byId(plan.transform(list), "a").tables;
    expect(tables).toContain("3");
    expect(tables.length).toBeGreaterThan(1);
    expect(comboCapBest(tables)).toBeGreaterThanOrEqual(4);
    expect(plan.done).toBe("A moved to " + tables.join("+") + ".");
  });

  it("a completed booking's table is free", () => {
    const list = [bk("a", "19:00", 2, ["3"]), bk("done", "19:00", 2, ["4"], { status: "completed" })];
    expect(drop(list, "a", "4").done).toBe("A moved to 4.");
  });
});

describe("planDrop: one party in the way", () => {
  it("swaps the two, and locks ONLY the one that was dragged (v17.10.0)", () => {
    const list = [bk("a", "19:00", 2, ["3"]), bk("b", "19:00", 2, ["4"])];
    const plan = drop(list, "a", "4");
    expect(plan.done).toBe("A and B — tables swapped.");
    const out = plan.transform(list);
    expect(byId(out, "a")).toMatchObject({ tables: ["4"], _manual: true, _locked: true });
    expect(byId(out, "b")).toMatchObject({ tables: ["3"], _manual: false, _locked: false });
    expect(byId(out, "a").history[0].action).toBe("swapped tables with B (3 → 4)");
    expect(byId(out, "b").history[0].action).toBe("swapped tables with A (4 → 3)");
  });

  it("a party that was already locked (a walk-in) keeps its lock on its new table", () => {
    const list = [bk("a", "19:00", 2, ["3"]), bk("b", "19:00", 2, ["4"], { _manual: true, _locked: true })];
    const out = drop(list, "a", "4").transform(list);
    expect(byId(out, "b")).toMatchObject({ tables: ["3"], _manual: true, _locked: true });
  });

  it("refuses to move a seated party, by name", () => {
    const list = [bk("a", "19:00", 2, ["3"]), bk("b", "19:00", 2, ["4"], { status: "seated" })];
    expect(drop(list, "a", "4")).toEqual({ refuse: "B is seated on 4's tables — can't move them." });
  });

  it("displaces when there is nothing to swap with, and re-seats the other party unlocked", () => {
    // `a` has no table, so there is no set to hand `b` in exchange.
    const list = [bk("a", "19:00", 2, []), bk("b", "19:00", 2, ["4"], { _manual: true, _locked: true })];
    const plan = drop(list, "a", "4");
    expect(plan.done).toBe("A moved to 4 — B moved.");
    expect(plan.lead).toBe("A moved to 4");
    const out = plan.transform(list);
    expect(byId(out, "a")).toMatchObject({ tables: ["4"], _manual: true, _locked: true });
    const b = byId(out, "b");
    expect(b.tables.length).toBeGreaterThan(0);
    expect(b.tables).not.toContain("4");
    expect(b).toMatchObject({ _manual: false, _locked: false });
    expect(b._conflict).toBeFalsy();
  });

  it("refuses a displacement that would leave the other party with no table", () => {
    // Every other table is held by a locked party, so `b` has nowhere to go.
    const others = ALL_TABLES.map((t) => t.id).filter((t) => t !== "4")
      .map((t, i) => bk("x" + i, "19:00", 2, [t], { _manual: true, _locked: true }));
    const list = [bk("a", "19:00", 2, []), bk("b", "19:00", 2, ["4"])].concat(others);
    expect(drop(list, "a", "4")).toEqual({ refuse: "Can't re-seat the parties there without stranding one — use Manual assign." });
  });
});

describe("planDrop: the table cannot take the party", () => {
  it("names a block on the target", () => {
    const list = [bk("a", "19:00", 2, ["3"])];
    const tableBlocks = [{ id: "k", tableId: "4", date: D, allDay: true }];
    expect(drop(list, "a", "4", { tableBlocks })).toEqual({ refuse: "Table 4 is blocked then." });
  });

  it("says the tables to join are busy when every combination holds a seated party or a block", () => {
    const seated = ALL_TABLES.map((t) => t.id).filter((t) => t !== "3" && t !== "9")
      .map((t, i) => bk("s" + i, "19:00", 2, [t], { status: "seated" }));
    const list = [bk("a", "19:00", 4, ["9"])].concat(seated);
    expect(drop(list, "a", "3")).toEqual({ refuse: "The tables needed to join with 3 are busy or blocked then." });
  });

  it("says a party no joined set can seat will not fit", () => {
    const list = [bk("a", "19:00", 60, [])];
    expect(drop(list, "a", "3")).toEqual({ refuse: "Party of 60 won't fit at 3, even with joined tables." });
  });
});

describe("planDrop: which list it reads", () => {
  it("decides occupancy from liveBookings and runs the transform on the list it is handed", () => {
    const shown = [bk("a", "19:00", 2, ["3"])];
    const stored = shown.concat([bk("b", "19:00", 2, ["4"])]);   // `b` is not on screen
    const plan = drop(shown, "a", "4", { bookings: stored });
    expect(plan.done).toBe("A moved to 4.");
    expect(plan.transform(stored).map((b) => b.id)).toEqual(["a", "b"]);
  });
});

// v18.14.0 (H5): what the row says before the release. Measured against
// `planDrop` over 16,000 generated drops when it was written, with the old
// `planDrop` alongside (REFACTOR_LOG); the short version of that stays below.
describe("dropPreview: the row under a dragged block", () => {
  const see = (list, id, targetId, more) => dropPreview(Object.assign(
    { id, targetId, liveBookings: list, viewDate: D, nowMins: 19 * 60, today: TODAY, tableBlocks: [] }, more || {}));
  const checked = (list, id, targetId, more) => dropCheck(Object.assign(
    { id, targetId, liveBookings: list, viewDate: D, nowMins: 19 * 60, today: TODAY, tableBlocks: [] }, more || {}));

  it("nothing to say for the party's own row, or a party that does not move", () => {
    expect(see([bk("a", "13:00", 2, ["3"])], "a", "3")).toBe(null);
    expect(see([bk("a", "13:00", 2, ["3"], { status: "cancelled" })], "a", "4")).toBe(null);
  });
  it("a free table keeps today's blue, with no words", () => {
    expect(see([bk("a", "13:00", 2, ["3"])], "a", "4")).toEqual({ tone: "free" });
  });
  it("one party that can trade tables is a swap, by full name", () => {
    const hint = see([bk("a", "13:00", 2, ["3"]), bk("b", "13:00", 2, ["4"], { name: "Lena Brandt" })], "a", "4");
    expect(hint).toEqual({ tone: "warn", text: "Swaps with Lena Brandt" });
  });
  it("parties it would move are named by first name, three at most", () => {
    const list = [
      bk("a", "13:00", 2, ["6"], { duration: 360 }),
      bk("b", "13:00", 2, ["7"], { name: "Yara Domínguez", duration: 60 }),
      bk("c", "14:30", 2, ["7"], { name: "Ariadna Puig", duration: 60 }),
    ];
    expect(see(list, "a", "7")).toEqual({ tone: "warn", text: "Moves Yara, Ariadna", unsure: true });
    const crowd = list.concat([
      bk("d", "16:00", 2, ["7"], { name: "Teo Vargas", duration: 60 }),
      bk("e", "17:30", 2, ["7"], { name: "Emil Kovacs", duration: 60 }),
    ]);
    expect(see(crowd, "a", "7")).toEqual({ tone: "warn", text: "Moves Yara, Ariadna, Teo +1", unsure: true });
  });
  // v18.14.2: "Moves Reilly" over a drop that moved eight, measured on an iPad. With
  // the Optimiser on the trial re-seats more than the parties in the way.
  it("once checked, it counts everyone the trial re-seats, not only who was in the way", () => {
    const list = [
      bk("a", "13:00", 2, ["6"], { duration: 360 }),
      bk("b", "13:00", 2, ["7"], { name: "Yara Domínguez", duration: 60 }),
      bk("c", "14:30", 2, ["7"], { name: "Ariadna Puig", duration: 60 }),
      bk("d", "13:00", 2, ["13"], { name: "Teo Vargas" }),
      bk("e", "15:00", 2, ["12"], { name: "Emil Kovacs" }),
      bk("f", "14:00", 2, ["11"], { name: "Lena Brandt" }),
    ];
    const on = { autoOptimizer: true, bookings: list, user: "u@x", nowMins: 600 };
    const plan = drop(list, "a", "7");
    expect(plan.moved.map((b) => b.id)).toEqual(["b", "c"]);
    expect(see(list, "a", "7", { autoOptimizer: true }).text).toBe("Moves Yara, Ariadna");
    expect(checked(list, "a", "7", on)).toEqual({ tone: "warn", text: "Moves Yara, Ariadna, Teo +2" });
    expect(plan.post.map((b) => b.id)).toEqual(plan.transform(list).map((b) => b.id));
  });
  it("a seated party says so, in red, where the drop will be refused", () => {
    const list = [bk("a", "13:00", 2, ["3"]), bk("b", "13:00", 2, ["4"], { name: "Yara Domínguez", status: "seated" })];
    expect(see(list, "a", "4")).toEqual({ tone: "danger", text: "Yara is seated here" });
    expect(drop(list, "a", "4").refuse).toMatch(/is seated on/);
  });
  // Measured on DEV in the evening: a drag that had gone through that morning was
  // refused, under a row that still said "Moves …". Past the cutoff nothing
  // re-seats a displaced party, and that is most of a service.
  it("with the Optimiser off, a party with nowhere to go is red, because the drop will be refused", () => {
    const list = [
      Object.assign(bk("a", "13:00", 2, ["6"], { duration: 360 }), { date: TODAY }),
      Object.assign(bk("b", "13:00", 2, ["7"], { name: "Yara Domínguez", duration: 60 }), { date: TODAY }),
      Object.assign(bk("c", "14:30", 2, ["7"], { name: "Ariadna Puig", duration: 60 }), { date: TODAY }),
    ];
    const off = { viewDate: TODAY, autoOptimizer: false, bookings: list, user: "u@x" };
    expect(drop(list, "a", "7", off).refuse).toMatch(/stranding/);
    expect(see(list, "a", "7", off)).toEqual({ tone: "danger", text: "Can't move Yara, Ariadna" });
  });
  it("with the Optimiser off, a swap is still a swap: it needs nobody re-seated", () => {
    const list = [
      Object.assign(bk("a", "13:00", 2, ["3"]), { date: TODAY }),
      Object.assign(bk("b", "13:00", 2, ["4"], { name: "Lena Brandt" }), { date: TODAY }),
    ];
    const off = { viewDate: TODAY, autoOptimizer: false, bookings: list, user: "u@x" };
    expect(see(list, "a", "4", off)).toEqual({ tone: "warn", text: "Swaps with Lena Brandt" });
  });
  it("every other refusal the drop would make is the row's own words, in red", () => {
    const list = [bk("a", "13:00", 2, ["3"])];
    const blocks = [{ id: "x", tableId: "4", date: D, allDay: true }];
    const hint = see(list, "a", "4", { tableBlocks: blocks });
    expect(hint).toEqual({ tone: "danger", text: drop(list, "a", "4", { tableBlocks: blocks }).refuse });
  });
  it("with the Optimiser on, the first answer is a guess and says so: it never reads the stored list", () => {
    const list = [bk("a", "13:00", 2, ["6"], { duration: 360 }), bk("b", "13:00", 2, ["7"], { name: "Yara Domínguez", duration: 60 }), bk("c", "14:30", 2, ["7"], { name: "Ariadna Puig", duration: 60 })];
    expect(see(list, "a", "7", { bookings: null, autoOptimizer: true })).toEqual({ tone: "warn", text: "Moves Yara, Ariadna", unsure: true });
  });
  it("every other row is exact, so it asks for no check", () => {
    expect(see([bk("a", "13:00", 2, ["3"])], "a", "4")).not.toHaveProperty("unsure");
    const seated = [bk("a", "13:00", 2, ["3"]), bk("b", "13:00", 2, ["4"], { status: "seated", name: "Lena Brandt" })];
    expect(see(seated, "a", "4")).not.toHaveProperty("unsure");
  });

  // The whole contract, on days dense enough to reach every branch. The seed is
  // fixed, so a failure here reproduces.
  it("agrees with the drop: free is plain, a swap is a swap, red is refused", () => {
    const ids = ALL_TABLES.map((t) => t.id);
    let x = 7919;
    const r = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
    const pick = (a) => a[Math.floor(r() * a.length)];
    const hits = { free: 0, swap: 0, moves: 0, red: 0, checked: 0, corrected: 0, wider: 0 };
    for (let day = 0; day < 160; day++) {
      // Every second day is today with the Optimiser off, where the row is exact.
      const off = day % 2 === 1;
      const more = Object.assign({ nowMins: 600 }, off ? { viewDate: TODAY, autoOptimizer: false } : { autoOptimizer: true });
      const list = Array.from({ length: 2 + Math.floor(r() * 14) }, (_, i) => Object.assign(bk("b" + i,
        String(13 + Math.floor(r() * 8)).padStart(2, "0") + ":" + pick(["00", "15", "30", "45"]),
        1 + Math.floor(r() * 8), r() < 0.1 ? [] : [pick(ids)],
        { name: "Name" + i + " Sur", status: pick(["confirmed", "confirmed", "confirmed", "pending", "seated", "completed"]), duration: 90 + Math.floor(r() * 4) * 15 }), off ? { date: TODAY } : null));
      for (let d = 0; d < 4; d++) {
        const ctx = { id: pick(list).id, targetId: pick(ids) };
        const plan = drop(list, ctx.id, ctx.targetId, more);
        const hint = see(list, ctx.id, ctx.targetId, Object.assign({ bookings: list, user: "u@x" }, more));
        expect(hint === null).toBe(plan === null);
        if (!hint) continue;
        // What a settled finger is told is the release, on every row: red exactly when
        // it refuses, and the parties it moves by name.
        const sure = checked(list, ctx.id, ctx.targetId, Object.assign({ bookings: list, user: "u@x" }, more));
        expect(sure.tone === "danger", "the check and the release").toBe(!!plan.refuse);
        expect(sure).not.toHaveProperty("unsure");
        if (plan.moved) {
          // Read from the write itself, so the row and the release cannot differ.
          const names = movedNames(list, plan.transform(list), ctx.id, plan.moved);
          expect(names.slice(0, plan.moved.length).sort(), "those in the way lead").toEqual(plan.moved.map((b) => b.name).sort());
          expect(sure.text).toBe("Moves " + names.slice(0, 3).map((n) => n.split(" ")[0]).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : ""));
          if (names.length > plan.moved.length) hits.wider++;
        }
        if (hint.unsure) { hits.checked++; if (sure.text !== hint.text) hits.corrected++; } else expect(sure).toEqual(hint);
        if (hint.tone === "free") { hits.free++; expect(plan.done).toMatch(/ moved to [^—]*\.$/); }
        if (hint.tone === "danger") { hits.red++; expect(plan.refuse).toBeTruthy(); }
        if (/^Swaps/.test(hint.text)) { hits.swap++; expect(plan.done).toMatch(/tables swapped/); }
        if (/^Moves/.test(hint.text)) {
          hits.moves++;
          // The guess, Optimiser on only: no trial, so the release can take a lower
          // set or strand, and `sure` above is what tells the finger. Off, the row
          // ran the real plan.
          if (off) expect(plan.done).toMatch(/moved to/);
          else expect(plan.refuse || plan.done).toMatch(/moved to|stranding/);
        }
      }
    }
    for (const [k, n] of Object.entries(hits)) expect(n, k + " was never reached").toBeGreaterThan(0);
  });
});

describe("BookingApp's dropOnTable", () => {
  const App = appCode();
  const fn = App.slice(App.indexOf("function dropOnTable("), App.indexOf("function previewDrop("));

  it("is the gate, the plan and the two side effects, and nothing else", () => {
    expect(fn).toMatch(/^function dropOnTable\(id,targetId\)\{if\(refused\("bookingAssign"\)\)return;/);
    expect(fn).toMatch(/planDrop\(dropCtx\(id,targetId\)\)/);
    expect(App, "the two lists stay separate arguments").toMatch(/function dropCtx\(id,targetId\)\{return \{id:id,targetId:targetId,liveBookings:liveBookings,bookings:bookings,/);
    // v18.14.0 (H5): the sentence comes when the write LANDS, on the Undo pill,
    // so a refused write is never shown as a move (the v15.4.0 rule, tighter).
    expect(fn).toContain('saveMove(plan.transform,id,"move",plan.done,function(){flashDragMsg(plan.done,true);},plan);');
    expect(fn.split("\n").length).toBeLessThan(12);
  });
});

// v18.14.0 (H5): the one place a move arms its Undo.
describe("BookingApp's saveMove", () => {
  const App = appCode();
  const flat = App.replace(/\s+/g, "");
  const fn = App.slice(App.indexOf("function saveMove("), App.indexOf("function dropOnTable("));

  it("reads the delta inside the transform, and arms only when the write lands", () => {
    expect(fn).toContain("withUndoDelta(transform,undoDelta)");
    expect(fn).toContain("saveBookings(move.transform,false,");
    expect(fn).toMatch(/onLanded:function\(\)\{/);
    const landed = fn.slice(fn.indexOf("onLanded"));
    expect(landed).toContain("const delta=move.delta();");
    expect(landed).toContain("armUndo(delta,id,kind,false,landedSentence(plan,sentence,delta,move.post(),id));");
    expect(fn.slice(0, fn.indexOf("onLanded")), "nothing is armed at the dispatch").not.toContain("armUndo(");
  });
  it("a write that moved nobody still answers the press, and a late landing offers nothing", () => {
    expect(fn).toContain("if(!delta.length){if(quiet)quiet();return;}");
    expect(fn).toContain("if(move.age()<=(generalSettings.undoSecs||10)*1000) armUndo(");
  });
  it("keeps the deleted-elsewhere report, and a reshuffle has no subject", () => {
    expect(fn).toContain("Object.assign(id==null?{}:goneReport(id),{onLanded:");
  });
  it("carries all three kinds of move", () => {
    expect(flat).toContain('saveMove(plan.transform,id,"move",plan.done,');
    expect(flat).toContain('saveMove(plan.transform,bookingId,"assign",plan.done,');
    expect(flat).toContain('saveMove(function(b){returnapplyOpt(b,viewDate,tableBlocks);},null,"reshuffle","Tablesre-optimised.",function(){flash("unmoved");});');
  });
  it("a sentence replaces the pill's label and leaves its note empty", () => {
    expect(flat).toContain('note:label?"":note,label:label||""');
    const toasts = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "StatusToasts.jsx"), "utf8")).join("\n");
    expect(toasts).toContain('!undoInfo?"":undoInfo.label?undoInfo.label:undoInfo.noShow?');
  });
  // Every drop arms a pill, so a refusal right after one is the ordinary case. It
  // went unsaid under the last move's pill, measured with the toast's own text.
  it("what answers this press sits above the pill, and a plain save's toast under it", () => {
    const toasts = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "StatusToasts.jsx"), "utf8")).join("\n");
    const at = (k) => toasts.indexOf('{key:"' + k + '"');
    expect(at("undo")).toBeGreaterThan(-1);
    expect(at("dragmsg")).toBeGreaterThan(-1);
    expect(at("dragmsg")).toBeLessThan(at("undo"));
    expect(at("unmoved")).toBeGreaterThan(-1);
    expect(at("unmoved")).toBeLessThan(at("undo"));
    expect(at("reshuffled")).toBeGreaterThan(at("undo"));
    expect(toasts).toContain('{key:"reshuffled",on:!!reshuffled&&reshuffled!=="unmoved",');
  });
  // Measured: another device removed the booking under a held finger, and the pill and
  // the amber row outlived the release, until the next tap, because `endDrag` never ran.
  it("a block that leaves under a held drag takes the row's warning with it", () => {
    const timeline = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "TimelineView.jsx"), "utf8")).join("\n");
    const at = timeline.indexOf("cancelAnimationFrame(dragRafRef.current);\n    clearTimeout(dragHoldTimer.current);");
    expect(at).toBeGreaterThan(-1);
    const effect = timeline.slice(timeline.lastIndexOf("useEffect(() => () => {", at), timeline.indexOf("}, []);", at));
    expect(effect).toContain("cancelAnimationFrame(edgeRafRef.current);");
    expect(effect).toContain("if (dragRef.current && dragRef.current.active && setDragHover) setDragHover(null);");
  });
  it("the preview goes through a stable wrapper and the same capability", () => {
    expect(flat).toContain("onDropPreview:function(id,targetId){returnR.current.previewDrop(id,targetId);}");
    expect(flat).toContain('functionpreviewDrop(id,targetId){if(!can("bookingAssign"))returnnull;');
  });
  it("the settled check takes the same two doors", () => {
    expect(flat).toContain("onDropCheck:function(id,targetId){returnR.current.checkDrop(id,targetId);}");
    expect(flat).toContain('functioncheckDrop(id,targetId){if(!can("bookingAssign"))returnnull;');
  });
});

describe("TimelineView asks once per row", () => {
  const View = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "TimelineView.jsx"), "utf8")).join("\n");

  it("derives the hint from the row and the booking alone, not from a pointer frame", () => {
    expect(View).toMatch(/const dropHint = useMemo\(\(\) => \([\s\S]*?onDropPreview\(dragOver, dragHover\)[\s\S]*?\), \[dragHover, dragOver, onDropPreview\]\);/);
  });
  it("keeps hover in two plain values, because a block reports every frame", () => {
    expect(View).toContain("setDragHover(table);");
    expect(View).toContain("setDragOver(table == null || table === home ? null : id);");
    expect((View.match(/setDragHover\(tableAtY\([a-z.]+lastY\), b\.id, homeTable, [a-z.]+lastY\)/g) || []).length).toBe(2);
    expect((View.match(/setDragHover=\{hoverRow\}/g) || []).length).toBe(2);
  });
  it("tints only the hovered row, and the tint eases both ways", () => {
    // v18.14.0 (correction 2): a row at rest may wear the indoor tint, and a hint
    // replaces it, so the hint is still the only thing the hovered row paints.
    expect(View).toMatch(/backgroundColor: dragHover !== id \? \(indoorTint && isIn\(id\) \? "var\(--tl-indoor-bg\)" : undefined\)\s+: hintRole\(rowHint\) \? hintRole\(rowHint\)\.tint : "var\(--bg-ac-hover\)"/);
    expect(View).toContain('transition: "height " + M.shift + ", background-color " + M.tap,');
    expect(View).toContain("<DropHint hint={dragHover === id ? rowHint : null} sz={sz} />");
  });
  // v18.14.0 (correction 17, Patryk): a drag that stalls is worse than a row that is
  // wrong for a moment, so these are the conditions on the one heavy call in a drag.
  it("asks the real plan only for a guess, once per row, and only of a still finger", () => {
    expect(View).toContain('const unsureRow = dropHint && dropHint.unsure ? dragOver + "|" + dragHover : null;');
    expect(View).toContain("if (!unsureRow || dropChecks[unsureRow] || !onDropCheck) return undefined;");
    expect(View, "still, not merely on the row").toMatch(/const left = dropRest\.current\.at \+ DROP_REST_MS - performance\.now\(\);\s+if \(left > 0\) \{ timer = setTimeout\(check, left\); return; \}/);
    expect(View, "a finger leaving the row cancels it").toContain("return () => clearTimeout(timer);");
    expect(View, "the end of a drag forgets every answer").toContain("if (table == null) { setDropChecks(NO_CHECKS); return; }");
    expect((View.match(/onDropCheck\(/g) || []).length, "one caller").toBe(1);
  });
  it("a check that agrees changes nothing on the row, and one that does not fades in", () => {
    expect(View).toContain("const said = sure.text === dropHint.text ? dropHint : { ...sure, corrects: true };");
    expect(View).toContain('<div key={hint.text} className={hint.corrects ? "mgt-appear" : undefined} aria-hidden="true"');
  });
  it("the words sit above a dragged block, which is at 30", () => {
    expect(View).toMatch(/position: "sticky", left: SP\.snug, zIndex: 31,/);
    expect(View).toMatch(/fontSize: sz\.legend,/);
  });
});

// v18.4.7: the displacement and the table picker's Swap leave an occupant the
// same thing. The drop wrote its own copy of the release until then; it was
// run against that copy over 70,655 generated drops when it changed
// (REFACTOR_LOG).
describe("planDrop: what a displaced party is left with", () => {
  const LIB = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "drop-plan.js"), "utf8")).join("\n");

  it("is releaseSwapped, not a second copy of it", () => {
    expect(LIB).toContain("return releaseSwapped(b,taken);");
    expect(LIB).not.toContain("_locked:false");
  });

  it("leaves each occupant unlocked for the optimiser, which seats it off the set", () => {
    // Two parties hold 4 over `a`'s window, so there is no swap: a displacement.
    // `b` also holds 5 by hand; the release leaves it 5, unlocked.
    const list = [bk("a", "19:00", 2, ["3"]),
      bk("b", "18:00", 2, ["4", "5"], { _manual: true, _locked: true }),
      bk("c", "20:00", 2, ["4"], { _manual: true, _locked: true })];
    const plan = drop(list, "a", "4");
    expect(plan.done).toBe("A moved to 4 — B and C moved.");
    const out = plan.transform(list);
    expect(byId(out, "a").tables).toEqual(["4"]);
    for (const id of ["b", "c"]) {
      const o = byId(out, id);
      expect(o._locked, id).toBe(false);
      expect(o._manual, id).toBe(false);
      expect(o.tables.length, id).toBeGreaterThan(0);
      expect(o.tables, id).not.toContain("4");
      expect(o._conflict, id).toBeFalsy();
    }
    // and what the optimiser was handed for `b` is the picker's release
    expect(releaseSwapped(list[1], [{ id: "b", tables: ["4"] }])).toStrictEqual(
      Object.assign({}, list[1], { tables: ["5"], _locked: false, _manual: false }));
  });
});
