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
import { planDrop, dropPreview, dropCheck, planRetime, retimePreview, retimeCheck } from "../src/lib/drop-plan.js";
import { releaseSwapped } from "../src/lib/booking-save.js";
import { movedNames, planUndo, landedSentence, retimeLabel, retimeSentence } from "../src/lib/delete-undo.js";
import { ALL_TABLES, KITCHEN_TABLE_LIMIT, hoursFor } from "../src/lib/constants.js";
import { comboCapBest, undoSnapshots, lastStartMins, toTime, toMins, verifyClean } from "../src/lib/booking-logic.js";
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
    // v18.16.0: a re-timed WhatsApp guest's reply is drafted here too, at the
    // landing, and the pill gains its clause. Nothing else about the arming moved.
    expect(landed).toContain('armUndo(delta,id,kind,false,landedSentence(plan,sentence,delta,move.post(),id)+(said?" · "+said.pill:""));');
    expect(landed).toContain("const said=plan&&plan.retime?draftMoved(id,movedSlot(delta.find(byId),move.post().find(byId))):null;");
    expect(landed, "a landing too late for the pill still says it").toContain("else if(said) flashDragMsg(said.toast,said.good);");
    expect(fn.slice(0, fn.indexOf("onLanded")), "nothing is drafted at the dispatch").not.toMatch(/draftMoved|draftMovedReply/);
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

  // v18.16.0: a time drag adds the time it has reached, a third plain value, and
  // asks the re-time's question for it. Still nothing from a pointer frame.
  it("derives the hint from the row, the booking and the time alone, not from a pointer frame", () => {
    expect(View).toMatch(/const dropHint = useMemo\(\(\) => \{[\s\S]*?onRetimePreview\(dragOver, dragTime\)[\s\S]*?onDropPreview\(dragOver, dragHover\)[\s\S]*?\}, \[dragHover, dragOver, dragTime, onDropPreview, onRetimePreview\]\);/);
    expect(View).toContain("if (dragTime != null) return onRetimePreview ? onRetimePreview(dragOver, dragTime) : null;");
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
    // v18.16.0: a time drag's answer is per TIME on the one row, and its check is
    // the re-time's; one call site still serves both.
    expect(View).toContain('const unsureRow = dropHint && dropHint.unsure ? dragOver + "|" + dragHover + (dragTime != null ? "|" + dragTime : "") : null;');
    expect(View).toContain("const ask = dragTime != null ? onRetimeCheck : onDropCheck;");
    expect(View).toContain("if (!unsureRow || dropChecks[unsureRow] || !ask) return undefined;");
    expect(View).toContain("const sure = ask(dragOver, dragTime != null ? dragTime : dragHover);");
    expect(View, "still, not merely on the row").toMatch(/const left = dropRest\.current\.at \+ DROP_REST_MS - performance\.now\(\);\s+if \(left > 0\) \{ timer = setTimeout\(check, left\); return; \}/);
    expect(View, "a finger leaving the row cancels it").toContain("return () => clearTimeout(timer);");
    expect(View, "the end of a drag forgets every answer").toContain("if (table == null) { setDropChecks(NO_CHECKS); return; }");
    expect((View.match(/\bask\(/g) || []).length, "one caller").toBe(1);
    expect((View.match(/onDropCheck\(|onRetimeCheck\(/g) || []).length, "and nobody goes round it").toBe(0);
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

// ── v18.16.0: the same drag, sideways ────────────────────────────────────────
// A block dragged along its row takes a new start and keeps its tables. One per
// outcome, each asserting what is WRITTEN and what is said, then the contract
// over generated days: what the row says is what the release does.
describe("planRetime: a block dragged to another time", () => {
  const dur = (id, time, size, tables, extra) => bk(id, time, size, tables, Object.assign({ duration: 90 }, extra || {}));
  const ctxOf = (list, id, time, more) => Object.assign({
    id, targetId: null, time, liveBookings: list, bookings: list, viewDate: D, nowMins: 600, today: TODAY,
    tableBlocks: [], autoOptimizer: true, user: "u@x", stamp,
  }, more || {});
  const retime = (list, id, time, more) => planRetime(ctxOf(list, id, time, more));
  // Today with the Optimiser off: nothing re-seats a displaced party.
  const OFF = { viewDate: TODAY, autoOptimizer: false };
  const today = (list) => list.map((b) => Object.assign({}, b, { date: TODAY }));

  it("answers null for a release on the minute it began, and for a booking that does not move", () => {
    const list = [dur("a", "19:00", 2, ["3"]), dur("gone", "19:00", 2, ["4"], { status: "cancelled" }),
      dur("done", "19:00", 2, ["5"], { status: "completed" }), dur("far", "19:00", 2, ["8"], { date: addDays(D, 1) })];
    expect(retime(list, "a", "19:00")).toBeNull();
    expect(retime(list, "nobody", "19:30")).toBeNull();
    expect(retime(list, "gone", "19:30")).toBeNull();
    expect(retime(list, "done", "19:30")).toBeNull();
    expect(retime(list, "far", "19:30")).toBeNull();
  });

  it("a free slot: the time and the scheduled time move, the tables and the length stay, and nothing is pinned", () => {
    const list = [dur("a", "19:00", 2, ["3", "4"], { scheduledTime: "19:00", notes: "window" }), dur("b", "19:00", 2, ["5"])];
    const plan = retime(list, "a", "18:30");
    expect(plan).toMatchObject({ retime: true, lead: "A · 19:00 → 18:30", done: "A · 19:00 → 18:30" });
    expect(plan.moved).toBeUndefined();
    const out = plan.transform(list);
    expect(byId(out, "a")).toMatchObject({ time: "18:30", scheduledTime: "18:30", tables: ["3", "4"], duration: 90,
      notes: "window", _conflict: false });
    // v18.16.0 (follow-up, Patryk): a sideways drag chose a time, not a table, so it
    // pins nothing, and a flag the booking never had is ABSENT, never undefined.
    expect("_locked" in byId(out, "a") || "_manual" in byId(out, "a")).toBe(false);
    expect(byId(out, "a").history).toEqual([{ action: "time 19:00→18:30 (drag)", by: "u@x" }]);
    expect(byId(out, "b")).toBe(list[1]);          // nobody else is touched
  });

  it("a pending booking moves like a confirmed one, and stays pending", () => {
    const list = [dur("a", "19:00", 2, ["3"], { status: "pending" })];
    expect(byId(retime(list, "a", "20:00").transform(list), "a")).toMatchObject({ time: "20:00", status: "pending" });
  });

  it("a seated party's time is when it sat down: refused, by name", () => {
    const list = [dur("a", "19:00", 2, ["3"], { status: "seated", name: "Marcos Vidal" })];
    expect(retime(list, "a", "19:30")).toEqual({ refuse: "Marcos is seated — the time is when the party sat down." });
  });

  it("a booking with no table has no row to keep", () => {
    expect(retime([dur("a", "19:00", 2, [])], "a", "19:30")).toEqual({ refuse: "Give A a table first — then the time can be dragged." });
  });

  it("the new start answers to the form's hours, in the form's words", () => {
    const list = [dur("a", "19:00", 2, ["3"])];
    const h = hoursFor(D);
    expect(retime(list, "a", toTime(lastStartMins(h.close)))).toHaveProperty("transform");
    expect(retime(list, "a", toTime(lastStartMins(h.close) + 15)).refuse).toMatch(/^The last start on \w+s is /);
    expect(retime(list, "a", toTime(h.open * 60 - 15)).refuse).toMatch(/^Bookings on this day are accepted between /);
  });

  it("a block over any of its tables in the new window refuses, and names the table", () => {
    const list = [dur("a", "19:00", 2, ["3", "4"])];
    const blocks = [{ id: "x", tableId: "4", date: D, from: "17:00", to: "18:30" }];
    expect(retime(list, "a", "18:00", { tableBlocks: blocks })).toEqual({ refuse: "Table 4 is blocked then." });
    expect(retime(list, "a", "18:30", { tableBlocks: blocks })).toHaveProperty("transform");   // starts as the block ends
  });

  it("somebody in the way is moved, as a table drop moves them, and the trial is the write", () => {
    const list = [dur("a", "19:00", 2, ["3"]), dur("b", "20:30", 2, ["3"], { _manual: true, _locked: true })];
    const plan = retime(list, "a", "20:00");
    expect(plan.refuse).toBeUndefined();
    expect(plan.moved.map((b) => b.id)).toEqual(["b"]);
    const out = plan.transform(list);
    expect(out).toEqual(plan.post);
    // It lands on its own tables, held for the pass, and comes out with the lock it had: none.
    expect(byId(out, "a")).toMatchObject({ time: "20:00", tables: ["3"] });
    expect("_locked" in byId(out, "a") || "_manual" in byId(out, "a")).toBe(false);
    expect(byId(out, "b")).toMatchObject({ time: "20:30", _locked: false, _manual: false });
    expect(byId(out, "b").tables).not.toContain("3");
    expect(byId(out, "b").tables.length).toBeGreaterThan(0);
    expect(verifyClean(out, D, [])).toBe(true);
  });

  // v18.16.0 (follow-up, Patryk): the drag adds no pin, and takes none away.
  it("a booking somebody placed by hand keeps its pin, on a free slot and through a displacement", () => {
    const pinned = { _manual: true, _locked: true };
    const free = [dur("a", "19:00", 2, ["3"], pinned)];
    expect(byId(retime(free, "a", "18:00").transform(free), "a")).toMatchObject({ time: "18:00", tables: ["3"], ...pinned });
    const busy = [dur("a", "19:00", 2, ["3"], pinned), dur("b", "20:30", 2, ["3"])];
    expect(byId(retime(busy, "a", "20:00").transform(busy), "a")).toMatchObject({ time: "20:00", tables: ["3"], ...pinned });
  });
  it("an unlocked booking stays unlocked, whatever the flags said", () => {
    const off = { _manual: false, _locked: false };
    const list = [dur("a", "19:00", 2, ["3"], off), dur("b", "20:30", 2, ["3"])];
    expect(byId(retime(list, "a", "20:00").transform(list), "a")).toMatchObject({ tables: ["3"], ...off });
    const lib = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "drop-plan.js"), "utf8")).join("\n");
    expect(lib).toContain("const retimed=function(b){return Object.assign({},b,{time:to,scheduledTime:to,_conflict:false,history:");
  });

  it("never swaps: two parties trading times is not what a sideways drag asks for", () => {
    // On a table drop this pair is a swap. Here `b` keeps its time and gets another table.
    const list = [dur("a", "19:00", 2, ["3"]), dur("b", "20:30", 2, ["3"])];
    const plan = retime(list, "a", "20:30");
    expect(byId(plan.transform(list), "b").time).toBe("20:30");
    expect(retimePreview(ctxOf(list, "a", "20:30")).text).not.toMatch(/^Swaps/);
  });

  it("a seated party in the way refuses, by name, and the row says so in red", () => {
    const list = [dur("a", "19:00", 2, ["3"]), dur("b", "20:30", 2, ["3"], { status: "seated", name: "Ana Ruiz" })];
    expect(retime(list, "a", "20:00")).toEqual({ refuse: "Ana is seated on 3 then — can't move them." });
    expect(retimePreview(ctxOf(list, "a", "20:00"))).toEqual({ tone: "danger", text: "Ana is seated here" });
  });

  it("with the Optimiser off nothing re-seats the other party, so it refuses and names who", () => {
    const list = today([dur("a", "19:00", 2, ["3"]), dur("b", "20:30", 2, ["3"], { name: "Ana Ruiz" })]);
    expect(retime(list, "a", "20:00", OFF)).toEqual({ refuse: "Table 3 is taken then by Ana — nowhere to move them." });
    const two = today([dur("a", "19:00", 4, ["3", "4"]), dur("b", "20:30", 2, ["4"], { name: "Ana Ruiz" })]);
    expect(retime(two, "a", "20:00", OFF).refuse).toBe("Tables 3+4 are taken then by Ana — nowhere to move them.");
    // and the row is exact there: red before the release
    expect(retimePreview(ctxOf(list, "a", "20:00", OFF))).toEqual({ tone: "danger", text: "Can't move Ana" });
  });

  it("the row: nothing on its own minute, plain when free, a guess with the Optimiser on, then the real plan", () => {
    const list = [dur("a", "19:00", 2, ["3"]), dur("b", "20:30", 2, ["3"], { name: "Ana Ruiz" })];
    expect(retimePreview(ctxOf(list, "a", "19:00"))).toBeNull();
    expect(retimePreview(ctxOf(list, "a", "18:30"))).toEqual({ tone: "free" });
    expect(retimePreview(ctxOf(list, "a", "20:00"))).toEqual({ tone: "warn", text: "Moves Ana", unsure: true });
    expect(retimeCheck(ctxOf(list, "a", "20:00"))).toEqual({ tone: "warn", text: "Moves Ana" });
  });

  it("a kitchen at its limit is said in amber and refuses nothing (Patryk)", () => {
    const list = [dur("a", "19:00", 2, ["3"])];
    for (let i = 0; i < KITCHEN_TABLE_LIMIT - 1; i++) list.push(dur("k" + i, "20:00", 2, [String(5 + i)]));
    expect(retimePreview(ctxOf(list, "a", "20:00"))).toEqual({ tone: "warn", text: "Kitchen busy at 20:00" });
    expect(retime(list, "a", "20:00")).toHaveProperty("transform");
    // one fewer start and it has nothing to say
    expect(retimePreview(ctxOf(list.slice(0, -1), "a", "20:00"))).toEqual({ tone: "free" });
    // it joins an amber answer and never a red one
    const busy = list.concat([dur("b", "20:30", 2, ["3"], { name: "Ana Ruiz" })]);
    // (the Optimiser re-seats the day, so the names after Ana are its own)
    expect(retimeCheck(ctxOf(busy, "a", "20:00")).text).toMatch(/^Moves Ana\b.* · Kitchen busy at 20:00$/);
    const red = list.concat([dur("b", "20:30", 2, ["3"], { status: "seated", name: "Ana Ruiz" })]);
    expect(retimePreview(ctxOf(red, "a", "20:00"))).toEqual({ tone: "danger", text: "Ana is seated here" });
  });

  it("Undo puts the time back, and every party the write moved", () => {
    const list = [dur("a", "19:00", 2, ["3"], { scheduledTime: "19:00" }), dur("b", "20:30", 2, ["3"], { _manual: true, _locked: true }), dur("c", "13:00", 2, ["9"])];
    const plan = retime(list, "a", "20:00");
    const post = plan.transform(list);
    const snaps = undoSnapshots(list, post);
    expect(snaps.map((b) => b.id)).toContain("a");
    expect(snaps.map((b) => b.id)).toContain("b");
    const back = planUndo({ info: { snapshots: snaps, primaryId: "a", kind: "move" }, getUser: () => "u@x", nowMins: 600, stamp }).transform(post);
    expect(byId(back, "a")).toMatchObject({ time: "19:00", scheduledTime: "19:00", tables: ["3"] });
    expect(byId(back, "a").history).toEqual([{ action: "move undone", by: "u@x" }]);
    expect(byId(back, "b")).toEqual(list[1]);
    expect(byId(back, "c")).toEqual(byId(list, "c"));
  });

  it("the pill is compact: the name, the two times, then who else moved", () => {
    expect(retimeLabel("Marcos", "19:00", "19:30")).toBe("Marcos · 19:00 → 19:30");
    expect(retimeSentence("Marcos · 19:00 → 19:30", [])).toBe("Marcos · 19:00 → 19:30");
    expect(retimeSentence("L", ["Ana"])).toBe("L · moved Ana");
    expect(retimeSentence("L", ["Ana", "Luis"])).toBe("L · moved Ana, Luis");
    expect(retimeSentence("L", ["Ana", "Luis", "Eva", "Joan"])).toBe("L · moved Ana and 3 others");
    // finished at the landing from what really changed tables, like a drop's
    const list = [dur("a", "19:00", 2, ["3"]), dur("b", "20:30", 2, ["3"], { name: "Ana Ruiz" })];
    const plan = retime(list, "a", "20:00");
    const post = plan.transform(list);
    const said = landedSentence(plan, plan.done, undoSnapshots(list, post), post, "a");
    expect(said.startsWith("A · 19:00 → 20:00 · moved Ana Ruiz")).toBe(true);
    const free = retime(list, "a", "18:30");
    const freePost = free.transform(list);
    expect(landedSentence(free, free.done, undoSnapshots(list, freePost), freePost, "a")).toBe("A · 19:00 → 18:30");
  });

  // The contract, on generated days. The seed is fixed, so a failure reproduces.
  it("what the row says is what the release does, at every quarter of generated days", () => {
    const ids = ALL_TABLES.map((t) => t.id);
    let x = 104729;
    const r = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
    const pick = (a) => a[Math.floor(r() * a.length)];
    const hits = { same: 0, free: 0, moves: 0, red: 0, checked: 0, kitchen: 0, landed: 0 };
    for (let day = 0; day < 120; day++) {
      const off = day % 2 === 1;
      const more = off ? OFF : { autoOptimizer: true };
      const list = Array.from({ length: 2 + Math.floor(r() * 12) }, (_, i) => Object.assign(bk("b" + i,
        String(13 + Math.floor(r() * 8)).padStart(2, "0") + ":" + pick(["00", "15", "30", "45"]),
        1 + Math.floor(r() * 6), r() < 0.1 ? [] : [pick(ids)],
        { name: "Name" + i + " Sur", status: pick(["confirmed", "confirmed", "confirmed", "pending", "seated", "completed"]), duration: 90 + Math.floor(r() * 4) * 15 }), off ? { date: TODAY } : null));
      for (let d = 0; d < 6; d++) {
        const id = pick(list).id;
        const time = String(12 + Math.floor(r() * 11)).padStart(2, "0") + ":" + pick(["00", "15", "30", "45"]);
        const c = ctxOf(list, id, time, more);
        const plan = planRetime(c), hint = retimePreview(c);
        expect(hint === null, id + " " + time).toBe(plan === null);
        if (!hint) { hits.same++; continue; }
        const sure = retimeCheck(c);
        expect(sure.tone === "danger", "the check and the release").toBe(!!plan.refuse);
        expect(sure).not.toHaveProperty("unsure");
        if (/Kitchen busy/.test(sure.text || "")) { hits.kitchen++; expect(sure.tone).toBe("warn"); }
        if (hint.unsure) hits.checked++; else expect(sure).toEqual(hint);
        if (hint.tone === "danger") { hits.red++; expect(plan.refuse).toBeTruthy(); }
        if (hint.tone === "free") { hits.free++; expect(plan.moved).toBeUndefined(); }
        if (/^Moves/.test(sure.text || "")) hits.moves++;
        if (plan.refuse) continue;
        // What lands: this booking at the new time on the tables it had, for the
        // length it had, and nobody the plan moved left without a table.
        hits.landed++;
        const src = byId(list, id), out = plan.transform(list), now = byId(out, id);
        expect(now.time).toBe(time);
        expect(now.tables).toEqual(src.tables);
        expect(now.duration).toBe(src.duration);
        for (const o of plan.moved || []) {
          const after = byId(out, o.id);
          expect(after.tables.length, o.id).toBeGreaterThan(0);
          expect(after._conflict, o.id).toBeFalsy();
          expect(toMins(after.time)).toBe(toMins(o.time));
        }
      }
    }
    for (const [k, n] of Object.entries(hits)) expect(n, k + " was never reached").toBeGreaterThan(0);
  });
});

describe("BookingApp's retimeBooking", () => {
  const APP = appCode();
  it("is the gate, the plan and the two side effects, like the drop beside it", () => {
    const fn = APP.slice(APP.indexOf("function retimeBooking("), APP.indexOf("function previewRetime("));
    expect(fn).toContain('if(refused("bookingEdit"))return;');
    expect(fn).toContain("const plan=planRetime(Object.assign(dropCtx(id,null),{time:time}));");
    expect(fn).toContain("if(plan.refuse){flashDragMsg(plan.refuse);return;}");
    expect(fn).toContain('saveMove(plan.transform,id,"move",plan.done,function(){flashDragMsg(plan.done,true);},plan);');
    expect((fn.match(/saveBookings\(/g) || []).length, "no write of its own").toBe(0);
  });
  it("the row's two questions take the same capability and stable wrappers", () => {
    expect(APP).toMatch(/function previewRetime\(id,time\)\{\s+if\(!can\("bookingEdit"\)\) return null;\s+return retimePreview\(Object\.assign\(dropCtx\(id,null\),\{time:time\}\)\);/);
    expect(APP).toMatch(/function checkRetime\(id,time\)\{\s+if\(!can\("bookingEdit"\)\) return null;\s+return retimeCheck\(Object\.assign\(dropCtx\(id,null\),\{time:time\}\)\);/);
    expect(APP).toContain("onRetime:function(id,time){return R.current.retimeBooking(id,time);},");
    expect(APP).toMatch(/onRetime=\{VA\.onRetime\}\s+onRetimePreview=\{VA\.onRetimePreview\}\s+onRetimeCheck=\{VA\.onRetimeCheck\}/);
  });
});
