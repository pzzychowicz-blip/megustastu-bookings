// tests/manual-assign.test.js — v18.4.7 (ROADMAP #17)
//
// `planAssign` is what the table picker's Save writes, moved out of BookingApp.
// When it moved it was run against the old `manualAssign` (lifted from the
// commit before) over 36,000 generated assignments, with the same written list
// and the same calls every time; that comparison is in REFACTOR_LOG, since it
// needs the old code. These are the cases that stay: one per outcome, each
// asserting what is WRITTEN.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planAssign, planReassign, swapSlot, liveSwap } from "../src/lib/manual-assign.js";
import { todayStr, addDays } from "../src/lib/day.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const TODAY = todayStr();
// A day that is not today: the optimiser is always on.
const D = addDays(TODAY, 2);
const stamp = (action, user) => ({ action, by: user });

const bk = (id, time, size, tables, extra) => Object.assign(
  { id, name: id.toUpperCase(), date: D, time, size, duration: 90, status: "confirmed", tables, history: [] }, extra || {});

const assign = (bookingId, tables, locked, affected, more) => planAssign(Object.assign({
  bookingId, tables, locked, affected, viewDate: D, tableBlocks: [], autoOptimizer: true, user: "u@x", stamp,
}, more || {}));
const byId = (list, id) => list.find((b) => b.id === id);

describe("planAssign: a plain assignment", () => {
  const list = [bk("a", "19:00", 2, ["2"], { _conflict: true }), bk("b", "19:00", 2, ["3"])];

  it("gives the booking the tables, hand-placed and locked, with one history line", () => {
    const plan = assign("a", ["4", "5A"], true, null);
    expect(plan.reshuffles).toBe(false);
    expect(byId(plan.transform(list), "a")).toStrictEqual(Object.assign({}, list[0], {
      tables: ["4", "5A"], _conflict: false, _manual: true, _locked: true,
      history: [{ action: "tables manually assigned: 4, 5A", by: "u@x" }],
    }));
  });

  it("leaves every other booking the same object, and re-optimises nothing", () => {
    for (const affected of [null, undefined, []]) {
      const out = assign("a", ["4"], true, affected).transform(list);
      expect(out[1]).toBe(list[1]);
      expect(out.length).toBe(2);
    }
  });

  it("locks only on the literal true", () => {
    for (const locked of [false, undefined, 1, "true"]) {
      const a = byId(assign("a", ["4"], locked, null).transform(list), "a");
      expect(a._locked, String(locked)).toBe(false);
      expect(a._manual).toBe(true);
    }
  });

  it("starts a history for a booking stored without one", () => {
    const bare = [Object.assign({}, list[0])];
    delete bare[0].history;
    expect(assign("a", ["4"], true, null).transform(bare)[0].history.length).toBe(1);
  });

  it("writes nothing for an id that is not in the list", () => {
    const out = assign("nobody", ["4"], true, null).transform(list);
    expect(out[0]).toBe(list[0]);
    expect(out[1]).toBe(list[1]);
  });
});

describe("planAssign: a swap", () => {
  // `b` holds 3 by hand; `a` takes it. `b` is released and the day re-optimised.
  const list = [bk("a", "19:00", 2, ["2"]), bk("b", "19:00", 2, ["3"], { _manual: true, _locked: true }),
    bk("c", "19:00", 2, ["4"], { _manual: true, _locked: true })];

  it("releases the party it takes from, which the optimiser then seats elsewhere", () => {
    const plan = assign("a", ["3"], true, [{ id: "b", name: "B", tables: ["3"] }]);
    expect(plan.reshuffles).toBe(true);
    const out = plan.transform(list);
    expect(byId(out, "a").tables).toEqual(["3"]);
    expect(byId(out, "a")._locked).toBe(true);
    const b = byId(out, "b");
    expect(b._locked).toBe(false);
    expect(b._manual).toBe(false);
    expect(b.tables.length).toBeGreaterThan(0);
    expect(b.tables).not.toContain("3");
    expect(b._conflict).toBeFalsy();
  });

  it("does not touch a locked party the swap did not name", () => {
    const out = assign("a", ["3"], true, [{ id: "b", tables: ["3"] }]).transform(list);
    expect(byId(out, "c").tables).toEqual(["4"]);
    expect(byId(out, "c")._locked).toBe(true);
  });

  it("re-optimises the day on screen, not the booking's own", () => {
    // `far` is on another day and unplaced: only a pass over ITS day seats it.
    const far = bk("far", "19:00", 2, [], { date: addDays(D, 1) });
    const days = list.concat([far]);
    const swap = [{ id: "b", tables: ["3"] }];
    expect(byId(assign("a", ["3"], true, swap).transform(days), "far").tables).toEqual([]);
    expect(byId(assign("a", ["3"], true, swap, { viewDate: far.date }).transform(days), "far").tables.length).toBeGreaterThan(0);
  });

  it("seats a released party on its own day when that is not the day on screen (v18.4.9)", () => {
    // The picker finds the parties it takes from on the BOOKING's date. Here
    // the booking and the party it swaps with are a day away from the view.
    const next = addDays(D, 1);
    const a2 = bk("a2", "19:00", 2, ["2"], { date: next });
    const b2 = bk("b2", "19:00", 2, ["3"], { date: next });
    const out = assign("a2", ["3"], true, [{ id: "b2", tables: ["3"] }]).transform(list.concat([a2, b2]));
    expect(byId(out, "a2").tables).toEqual(["3"]);
    const moved = byId(out, "b2");
    expect(moved.tables.length).toBeGreaterThan(0);
    expect(moved.tables).not.toContain("3");
  });

  it("answers the same for the same list, and for a fresh one (the replay)", () => {
    const plan = assign("a", ["3"], true, [{ id: "b", tables: ["3"] }]);
    expect(plan.transform(list)).toStrictEqual(plan.transform(list));
    const fresh = list.filter((b) => b.id !== "c");
    expect(plan.transform(fresh).map((b) => b.id)).toEqual(["a", "b"]);
  });
});

describe("App's manualAssign is the plan and its three effects", () => {
  const APP = stripComments(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/App.jsx"), "utf8")).join("\n");
  const at = APP.indexOf("function manualAssign(");
  const body = APP.slice(at, APP.indexOf("function addBlock(", at));

  it("decides nothing itself", () => {
    expect(body).toContain("planAssign(");
    for (const word of ["histEntry", "bookingsAfterAction", "releaseSwapped", "_locked", "_manual", ".map("]) {
      expect(body, word).not.toContain(word);
    }
  });

  it("writes through saveBookings with the deleted-elsewhere report, closes the picker, and flashes only when the write went and the day was reshuffled", () => {
    const flat = body.replace(/\s+/g, "");
    expect(flat).toContain("constok=saveBookings(plan.transform,false,goneReport(bookingId));setManualTarget(null);if(ok&&plan.reshuffles)flash();");
  });
});

// v18.4.9: a Swap the booking form is holding until Save belongs to the slot it
// was picked for.
describe("liveSwap: a swap lasts as long as the draft stays in its slot", () => {
  const draft = { date: D, time: "20:00", size: 2, customDur: null };
  const swap = [{ id: "b", tables: ["3"] }];
  const slot = swapSlot(draft);

  it("is the swap while the draft is where it was picked", () => {
    expect(liveSwap(swap, slot, Object.assign({}, draft, { name: "Ana", notes: "x" }))).toBe(swap);
    // The size typed back as a string, and the default duration written out.
    expect(liveSwap(swap, slot, Object.assign({}, draft, { size: "2", customDur: 90 }))).toBe(swap);
  });

  it("is nothing once the date, time, size or duration moved", () => {
    for (const change of [{ date: addDays(D, 1) }, { time: "20:15" }, { size: 5 }, { customDur: 120 }]) {
      expect(liveSwap(swap, slot, Object.assign({}, draft, change)), JSON.stringify(change)).toBe(null);
    }
  });

  it("is nothing for no swap, whatever the slot", () => {
    expect(liveSwap(null, slot, draft)).toBe(null);
    expect(liveSwap([], slot, draft)).toBe(null);
    expect(liveSwap(swap, null, draft)).toBe(null);
  });
});

describe("the picker opened from the booking form fills the draft (v18.4.9)", () => {
  const APP = stripComments(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/App.jsx"), "utf8")).join("\n").replace(/\s+/g, "");

  it("for an edit as for a new booking, and writes nothing", () => {
    expect(APP).toContain('consttoDraft=manualTarget==="__new__"||(showForm&&manualTarget===editId);');
    expect(APP).toContain("if(toDraft){setForm(function(f){returnObject.assign({},f,{manualTables:tables,_clearManual:false});});setSwapAffected(affected||null);setSwapPickedFor(swapSlot(form));setManualTarget(null);}elsemanualAssign(manualBooking.id,tables,locked,affected);");
  });

  it("the saves read the swap through liveSwap, never the raw pick", () => {
    expect(APP).toContain("constswapAffected=liveSwap(swapPicked,swapPickedFor,form);");
    // The raw pick is named twice: the state's declaration and liveSwap's argument.
    expect(APP.match(/\bswapPicked\b/g).length).toBe(2);
  });

  it("an assignment still needs the capability from the edit form", () => {
    expect(APP).toContain('if(manualTarget!=="__new__"&&refused("bookingAssign"))return;');
  });
});

// v18.5.1 (ROADMAP #17): the Overlap banner's Reassign, moved out of App's
// `reassignBooking`. Compared with the old function over 60,000 generated days
// when it moved (REFACTOR_LOG); these are the outcomes that stay.
describe("planReassign", () => {
  const asked = [];
  const re = (id, bookings, more) => planReassign(Object.assign({
    id, bookings, liveBookings: bookings, tableBlocks: [],
    getUser: () => { asked.push("user"); return "u@x"; }, stamp,
  }, more || {}));

  it("moves the booking to other tables, unlocked and unflagged, with one history line, and nobody else", () => {
    const list = [bk("a", "20:00", 2, ["2"], { _manual: true, _conflict: true }), bk("b", "20:00", 2, ["3"])];
    const plan = re("a", list);
    expect(plan.refuse).toBe(undefined);
    const after = plan.transform(list);
    const a = byId(after, "a");
    expect(a.tables).not.toEqual(["2"]);
    expect(a.tables.length).toBeGreaterThan(0);
    expect(a.tables).not.toContain("3");
    expect([a._manual, a._conflict]).toEqual([false, false]);
    expect(a.history).toEqual([{ action: "reassigned 2 → " + a.tables.join("+"), by: "u@x" }]);
    expect(byId(after, "b")).toBe(list[1]);
  });
  it("names 'none' when the booking had no table", () => {
    const list = [bk("a", "20:00", 2, [])];
    expect(byId(re("a", list).transform(list), "a").history[0].action).toMatch(/^reassigned none → /);
  });
  it("refuses a booking that is not there, and one that is locked or seated, without asking who", () => {
    asked.length = 0;
    expect(re("gone", [])).toEqual({ refuse: "Booking not found." });
    const locked = [bk("a", "20:00", 2, ["2"], { _locked: true })];
    expect(re("a", locked)).toEqual({ refuse: "Booking is manually locked. Edit manually to change tables." });
    const seated = [bk("a", "20:00", 2, ["2"], { status: "seated" })];
    expect(re("a", seated).refuse).toBe("Booking is manually locked. Edit manually to change tables.");
    expect(asked).toEqual([]);
  });
  it("refuses by name when every other table is taken", () => {
    const ids = ["1A", "1B", "2", "3", "4", "5A", "5B", "6", "7", "i1", "i2", "i3", "i4"];
    const full = ids.map((t, k) => bk("f" + k, "20:00", 2, [t], { _locked: true }));
    const list = full.concat([bk("a", "20:00", 2, ["2"])]);
    expect(re("a", list)).toEqual({ refuse: "No alternative tables available for A at 20:00." });
  });
  it("a seated party still at the booking's table, due to leave as it starts, counts as still there", () => {
    // S sits at table 2 from 18:30 for 90, so on paper it leaves at 20:00, the minute
    // A is booked onto 2. As stored, 2 reads free at 20:00 and A would be handed 2 back.
    const s = bk("s", "18:30", 2, ["2"], { status: "seated" });
    // 2 is also the table A asked for, so the lookup would pick it first if it read free:
    // the same tables back, and the "no alternative" refusal with twelve tables empty.
    const a = bk("a", "20:00", 2, ["2"], { preferredTables: ["2"] });
    const list = [s, a];
    const plan = re("a", list);
    expect(plan.refuse).toBe(undefined);
    const after = plan.transform(list);
    expect(byId(after, "a").tables).not.toContain("2");
    expect(byId(after, "s")).toBe(s);                       // the stretch is for the lookup only
  });
  it("being handed the tables it already has is a refusal, not a write", () => {
    const best = byId(re("a", [bk("a", "20:00", 2, [])]).transform([bk("a", "20:00", 2, [])]), "a").tables;
    expect(re("a", [bk("a", "20:00", 2, best)])).toEqual({ refuse: "No alternative tables available for A at 20:00." });
  });
  it("the replay writes the same tables onto whatever list it is handed", () => {
    const list = [bk("a", "20:00", 2, ["2"])];
    const plan = re("a", list);
    const first = byId(plan.transform(list), "a").tables;
    const fresh = [bk("a", "20:00", 4, ["2"], { notes: "changed elsewhere" }), bk("z", "21:00", 2, ["6"])];
    const replay = plan.transform(fresh);
    expect(byId(replay, "a").tables).toEqual(first);
    expect(byId(replay, "a").notes).toBe("changed elsewhere");
    expect(byId(replay, "z")).toBe(fresh[1]);
  });
});

describe("App's reassignBooking is the plan and its three effects", () => {
  const APP = stripComments(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/App.jsx"), "utf8")).join("\n");
  const at = APP.indexOf("function reassignBooking(");
  const body = APP.slice(at, APP.indexOf("function flashRefusal(", at));
  it("decides nothing itself", () => {
    for (const word of ["findFreeSlot", "isLocked", "histEntry", "toMins(", ".map("]) expect(body, word).not.toContain(word);
  });
  it("shows a refusal, else writes with the deleted-elsewhere report, clears the error and flashes when the write went", () => {
    const flat = body.replace(/\s+/g, "");
    expect(flat).toContain("constplan=planReassign({id:id,bookings:bookings,liveBookings:liveBookings,tableBlocks:tableBlocks,getUser:getUser});if(plan.refuse){setError(plan.refuse);return;}constok=saveBookings(plan.transform,false,goneReport(id));setError(\"\");if(ok)flash();");
  });
});

