// tests/manual-assign.test.js — v18.4.7 (ROADMAP #17)
//
// `planAssign` is what the table picker's Save writes, moved out of BookingApp.
// When it moved it was run against the old `manualAssign` (lifted from the
// commit before) over 36,000 generated assignments, with the same written list
// and the same calls every time; that comparison is in REFACTOR_LOG, since it
// needs the old code. These are the cases that stay: one per outcome, each
// asserting what is WRITTEN.
import { describe, it, expect } from "vitest";
import { planAssign, planReassign, planReshuffle, planUnlock, lockedOn, swapSlot, liveSwap } from "../src/lib/manual-assign.js";
import { todayStr, addDays } from "../src/lib/day.js";
import { appCode } from "./app-source.js";
import { unlockOffered, reshuffleOffer } from "../src/lib/booking-logic.js";
import { ALL_TABLES } from "../src/lib/constants.js";
import { readFileSync } from "node:fs";
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
  const list = [bk("a", "19:00", 2, ["3"], { _conflict: true }), bk("b", "19:00", 2, ["4"])];

  it("gives the booking the tables, hand-placed and locked, with one history line", () => {
    const plan = assign("a", ["5", "6"], true, null);
    expect(plan.reshuffles).toBe(false);
    expect(byId(plan.transform(list), "a")).toStrictEqual(Object.assign({}, list[0], {
      tables: ["5", "6"], _conflict: false, _manual: true, _locked: true,
      history: [{ action: "tables manually assigned: 5, 6", by: "u@x" }],
    }));
  });

  it("leaves every other booking the same object, and re-optimises nothing", () => {
    for (const affected of [null, undefined, []]) {
      const out = assign("a", ["5"], true, affected).transform(list);
      expect(out[1]).toBe(list[1]);
      expect(out.length).toBe(2);
    }
  });

  it("locks only on the literal true", () => {
    for (const locked of [false, undefined, 1, "true"]) {
      const a = byId(assign("a", ["5"], locked, null).transform(list), "a");
      expect(a._locked, String(locked)).toBe(false);
      expect(a._manual).toBe(true);
    }
  });

  it("starts a history for a booking stored without one", () => {
    const bare = [Object.assign({}, list[0])];
    delete bare[0].history;
    expect(assign("a", ["5"], true, null).transform(bare)[0].history.length).toBe(1);
  });

  it("writes nothing for an id that is not in the list", () => {
    const out = assign("nobody", ["5"], true, null).transform(list);
    expect(out[0]).toBe(list[0]);
    expect(out[1]).toBe(list[1]);
  });
});

describe("planAssign: a swap", () => {
  // `b` holds 3 by hand; `a` takes it. `b` is released and the day re-optimised.
  const list = [bk("a", "19:00", 2, ["3"]), bk("b", "19:00", 2, ["4"], { _manual: true, _locked: true }),
    bk("c", "19:00", 2, ["5"], { _manual: true, _locked: true })];

  it("releases the party it takes from, which the optimiser then seats elsewhere", () => {
    const plan = assign("a", ["4"], true, [{ id: "b", name: "B", tables: ["4"] }]);
    expect(plan.reshuffles).toBe(true);
    const out = plan.transform(list);
    expect(byId(out, "a").tables).toEqual(["4"]);
    expect(byId(out, "a")._locked).toBe(true);
    const b = byId(out, "b");
    expect(b._locked).toBe(false);
    expect(b._manual).toBe(false);
    expect(b.tables.length).toBeGreaterThan(0);
    expect(b.tables).not.toContain("4");
    expect(b._conflict).toBeFalsy();
  });

  it("does not touch a locked party the swap did not name", () => {
    const out = assign("a", ["4"], true, [{ id: "b", tables: ["4"] }]).transform(list);
    expect(byId(out, "c").tables).toEqual(["5"]);
    expect(byId(out, "c")._locked).toBe(true);
  });

  it("re-optimises the day on screen, not the booking's own", () => {
    // `far` is on another day and unplaced: only a pass over ITS day seats it.
    const far = bk("far", "19:00", 2, [], { date: addDays(D, 1) });
    const days = list.concat([far]);
    const swap = [{ id: "b", tables: ["4"] }];
    expect(byId(assign("a", ["4"], true, swap).transform(days), "far").tables).toEqual([]);
    expect(byId(assign("a", ["4"], true, swap, { viewDate: far.date }).transform(days), "far").tables.length).toBeGreaterThan(0);
  });

  it("seats a released party on its own day when that is not the day on screen (v18.4.9)", () => {
    // The picker finds the parties it takes from on the BOOKING's date. Here
    // the booking and the party it swaps with are a day away from the view.
    const next = addDays(D, 1);
    const a2 = bk("a2", "19:00", 2, ["3"], { date: next });
    const b2 = bk("b2", "19:00", 2, ["4"], { date: next });
    const out = assign("a2", ["4"], true, [{ id: "b2", tables: ["4"] }]).transform(list.concat([a2, b2]));
    expect(byId(out, "a2").tables).toEqual(["4"]);
    const moved = byId(out, "b2");
    expect(moved.tables.length).toBeGreaterThan(0);
    expect(moved.tables).not.toContain("4");
  });

  it("answers the same for the same list, and for a fresh one (the replay)", () => {
    const plan = assign("a", ["4"], true, [{ id: "b", tables: ["4"] }]);
    expect(plan.transform(list)).toStrictEqual(plan.transform(list));
    const fresh = list.filter((b) => b.id !== "c");
    expect(plan.transform(fresh).map((b) => b.id)).toEqual(["a", "b"]);
  });
});

// v18.14.0 (H5): the sentence the Undo pill carries, in a drop's own words.
describe("planAssign: done", () => {
  const list = [
    { id: "a", name: "Lena Brandt", tables: ["1"] },
    { id: "b", name: "Yara Domínguez", tables: ["2"] },
  ];
  it("names the party and its tables", () => {
    expect(planAssign({ bookingId: "a", tables: ["4", "5"], locked: true, bookings: list, viewDate: "x", tableBlocks: [] }).done)
      .toBe("Lena Brandt moved to 4+5.");
  });
  it("names whoever a swap took tables from", () => {
    expect(planAssign({ bookingId: "a", tables: ["2"], locked: true, affected: [{ id: "b", tables: ["2"] }], bookings: list, viewDate: "x", tableBlocks: [] }).done)
      .toBe("Lena Brandt moved to 2 — Yara Domínguez moved.");
  });
});

describe("App's manualAssign is the plan and its three effects", () => {
  const APP = appCode();
  const at = APP.indexOf("function manualAssign(");
  const body = APP.slice(at, APP.indexOf("function addBlock(", at));

  it("decides nothing itself", () => {
    expect(body).toContain("planAssign(");
    for (const word of ["histEntry", "bookingsAfterAction", "releaseSwapped", "_locked", "_manual", ".map("]) {
      expect(body, word).not.toContain(word);
    }
  });

  // v18.14.0 (H5): `saveMove` carries the write's report and the Undo. It flashes
  // only for a swap that moved nobody, since the pill has the sentence otherwise.
  it("writes through saveMove, closes the picker, and has a flash only for a day it reshuffled", () => {
    const flat = body.replace(/\s+/g, "");
    expect(flat).toContain('saveMove(plan.transform,bookingId,"assign",plan.done,plan.reshuffles?flash:null,plan);setManualTarget(null);');
  });
});

// v18.4.9: a Swap the booking form is holding until Save belongs to the slot it
// was picked for.
describe("liveSwap: a swap lasts as long as the draft stays in its slot", () => {
  const draft = { date: D, time: "20:00", size: 2, customDur: null };
  const swap = [{ id: "b", tables: ["4"] }];
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
  const APP = appCode().replace(/\s+/g, "");

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
    const list = [bk("a", "20:00", 2, ["3"], { _manual: true, _conflict: true }), bk("b", "20:00", 2, ["4"])];
    const plan = re("a", list);
    expect(plan.refuse).toBe(undefined);
    const after = plan.transform(list);
    const a = byId(after, "a");
    expect(a.tables).not.toEqual(["3"]);
    expect(a.tables.length).toBeGreaterThan(0);
    expect(a.tables).not.toContain("4");
    expect([a._manual, a._conflict]).toEqual([false, false]);
    expect(a.history).toEqual([{ action: "reassigned 3 → " + a.tables.join("+"), by: "u@x" }]);
    expect(byId(after, "b")).toBe(list[1]);
  });
  it("names 'none' when the booking had no table", () => {
    const list = [bk("a", "20:00", 2, [])];
    expect(byId(re("a", list).transform(list), "a").history[0].action).toMatch(/^reassigned none → /);
  });
  it("refuses a booking that is not there, and a seated one, without asking who", () => {
    asked.length = 0;
    expect(re("gone", [])).toEqual({ refuse: "Booking not found." });
    // v18.17.0 (K): the reason is that the party is seated, in Unlock's words. It
    // said "Booking is manually locked. Edit manually to change tables."
    const seated = [bk("a", "20:00", 2, ["3"], { status: "seated" })];
    expect(re("a", seated).refuse).toBe("A is seated — a seated party stays at its table.");
    const seatedLocked = [bk("a", "20:00", 2, ["3"], { status: "seated", _locked: true, _manual: true })];
    expect(re("a", seatedLocked).refuse).toBe("A is seated — a seated party stays at its table.");
    expect(re("a", seated).refuse).toBe(planUnlock({ id: "a", bookings: seated, tableBlocks: [], autoOptimizer: true, user: "u@x" }).refuse);
    expect(asked).toEqual([]);
  });
  // v18.17.0 (C): a locked booking is moved, and stays locked on its new tables
  // (Patryk, 2026-11-12). Somebody put it there on purpose; the rescue changes
  // the table, not that decision.
  it("moves a locked booking and keeps it locked, with the same history line", () => {
    const list = [bk("a", "20:00", 2, ["3"], { _locked: true, _manual: true, _conflict: true }), bk("b", "20:00", 2, ["4"])];
    const plan = re("a", list);
    expect(plan.refuse).toBe(undefined);
    const a = byId(plan.transform(list), "a");
    expect(a.tables).not.toEqual(["3"]);
    expect(a.tables).not.toContain("4");
    expect([a._locked, a._manual, a._conflict]).toEqual([true, true, false]);
    expect(a.history).toEqual([{ action: "reassigned 3 → " + a.tables.join("+"), by: "u@x" }]);
  });
  it("a lock taken off elsewhere before the replay is not put back", () => {
    const list = [bk("a", "20:00", 2, ["3"], { _locked: true, _manual: true })];
    const plan = re("a", list);
    const fresh = [bk("a", "20:00", 2, ["3"], { _locked: false, _manual: false })];
    expect(byId(plan.transform(fresh), "a")).toMatchObject({ _locked: false, _manual: false });
  });
  it("refuses by name when every other table is taken", () => {
    const ids = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
    const full = ids.map((t, k) => bk("f" + k, "20:00", 2, [t], { _locked: true }));
    const list = full.concat([bk("a", "20:00", 2, ["3"])]);
    expect(re("a", list)).toEqual({ refuse: "No alternative tables available for A at 20:00." });
  });
  it("a seated party still at the booking's table, due to leave as it starts, counts as still there", () => {
    // S sits at table 2 from 18:30 for 90, so on paper it leaves at 20:00, the minute
    // A is booked onto 2. As stored, 2 reads free at 20:00 and A would be handed 2 back.
    const s = bk("s", "18:30", 2, ["3"], { status: "seated" });
    // 2 is also the table A asked for, so the lookup would pick it first if it read free:
    // the same tables back, and the "no alternative" refusal with twelve tables empty.
    const a = bk("a", "20:00", 2, ["3"], { preferredTables: ["3"] });
    const list = [s, a];
    const plan = re("a", list);
    expect(plan.refuse).toBe(undefined);
    const after = plan.transform(list);
    expect(byId(after, "a").tables).not.toContain("3");
    expect(byId(after, "s")).toBe(s);                       // the stretch is for the lookup only
  });
  it("being handed the tables it already has is a refusal, not a write", () => {
    const best = byId(re("a", [bk("a", "20:00", 2, [])]).transform([bk("a", "20:00", 2, [])]), "a").tables;
    expect(re("a", [bk("a", "20:00", 2, best)])).toEqual({ refuse: "No alternative tables available for A at 20:00." });
  });
  it("the replay writes the same tables onto whatever list it is handed", () => {
    const list = [bk("a", "20:00", 2, ["3"])];
    const plan = re("a", list);
    const first = byId(plan.transform(list), "a").tables;
    const fresh = [bk("a", "20:00", 4, ["3"], { notes: "changed elsewhere" }), bk("z", "21:00", 2, ["8"])];
    const replay = plan.transform(fresh);
    expect(byId(replay, "a").tables).toEqual(first);
    expect(byId(replay, "a").notes).toBe("changed elsewhere");
    expect(byId(replay, "z")).toBe(fresh[1]);
  });
});

describe("App's reassignBooking is the plan and its three effects", () => {
  const APP = appCode();
  const at = APP.indexOf("function reassignBooking(");
  const body = APP.slice(at, APP.indexOf("function flashRefusal(", at));
  it("decides nothing itself", () => {
    for (const word of ["findFreeSlot", "isLocked", "histEntry", "toMins(", ".map("]) expect(body, word).not.toContain(word);
  });
  // v18.17.0 (K): the refusal is the refusal toast. `setError` is the booking
  // form's line, and Reassign is pressed on the Overlap banner with no form open.
  it("shows a refusal in the refusal toast, else writes with the deleted-elsewhere report and flashes when the write went", () => {
    const flat = body.replace(/\s+/g, "");
    expect(flat).toContain("constplan=planReassign({id:id,bookings:bookings,liveBookings:liveBookings,tableBlocks:tableBlocks,getUser:getUser});if(plan.refuse){flashRefusal(plan.refuse);return;}constok=saveBookings(plan.transform,false,goneReport(id));if(ok)flash();");
    expect(body).not.toContain("setError");
  });
});


// ── v18.17.0 (D): Reshuffle reads the day as it stands NOW ───────────────────
// `forceReshuffle` ran `applyOpt` on the stored list, the one path that skipped
// `syncLiveDurations`. A seated party past its booked end still holds its table,
// and its stored end said the table was free.
describe("planReshuffle: a seated party running over", () => {
  // The table the optimiser gives a lone party of 2, so the test names no table.
  const lone = planReshuffle({ viewDate: TODAY, tableBlocks: [], today: TODAY, nowMins: 13 * 60 })
    .transform([bk("x", "15:15", 2, [], { date: TODAY })]);
  const T = byId(lone, "x").tables;
  const list = [
    bk("sat", "13:00", 2, T, { date: TODAY, status: "seated" }),   // booked to 14:30
    bk("next", "15:15", 2, [], { date: TODAY }),
  ];

  it("the lone party's table is known", () => {
    expect(T.length).toBeGreaterThan(0);
  });

  it("does not seat the next party on a table somebody is still sitting at", () => {
    const out = planReshuffle({ viewDate: TODAY, tableBlocks: [], today: TODAY, nowMins: 15 * 60 + 20 }).transform(list);
    const next = byId(out, "next").tables;
    expect(next.length).toBeGreaterThan(0);
    expect(next.some((t) => T.includes(t)), "next was given " + next.join("+")).toBe(false);
  });

  it("and does once the party has really gone by then", () => {
    const out = planReshuffle({ viewDate: TODAY, tableBlocks: [], today: TODAY, nowMins: 14 * 60 }).transform(list);
    expect(byId(out, "next").tables).toEqual(T);
  });

  it("App's Reshuffle is this plan, through saveMove", () => {
    expect(appCode()).toMatch(/function forceReshuffle\(unlock\)\{const plan=planReshuffle\(/);
  });
});

// ── v18.17.0 (A): a lock can be taken off ────────────────────────────────────
// A drag, an Assign and a walk-in all lock a booking to its tables, and the only
// way out was the edit form's Clear. Unlock hands the booking back to the
// optimiser in one tap, through `saveMove`, so it can be undone.
// /code-review: a FULL 19:00, one party per table and each the size of its table,
// except one two-top, which holds a party of five put there by hand and locked.
// The optimiser would never seat five at it, and every other table is taken: the
// case where taking a lock off costs somebody a table.
const fullDay = () => {
  const placed = planReshuffle({ viewDate: D, tableBlocks: [], today: TODAY, nowMins: 600 })
    .transform(ALL_TABLES.map((t, i) => bk("f" + i, "19:00", t.capacity, [])));
  const out = placed.find((b) => b.tables.length === 1 && ALL_TABLES.find((t) => t.id === b.tables[0]).capacity === 2);
  return placed.filter((b) => b.id !== out.id).concat([bk("big", "19:00", 5, out.tables.slice(), { _locked: true, _manual: true })]);
};
const seatedCount = (list) => list.filter((b) => b.tables.length > 0).length;

describe("unlockOffered: who can be unlocked", () => {
  it("a locked booking that has not sat down", () => {
    expect(unlockOffered(bk("a", "19:00", 2, ["3"], { _locked: true, _manual: true }))).toBe(true);
    expect(unlockOffered(bk("a", "19:00", 2, ["3"], { _locked: true, status: "pending" }))).toBe(true);
  });
  it("never a seated party (a walk-in is one), a finished booking, or one that is not locked", () => {
    for (const status of ["seated", "completed", "cancelled"]) {
      expect(unlockOffered(bk("a", "19:00", 2, ["3"], { _locked: true, status })), status).toBe(false);
    }
    expect(unlockOffered(bk("a", "19:00", 2, ["3"]))).toBe(false);
    expect(unlockOffered(bk("a", "19:00", 2, ["3"], { _manual: true }))).toBe(false);
    expect(unlockOffered(null)).toBe(false);
  });
});

describe("planUnlock: the lock comes off and the day is handed back", () => {
  const unlock = (list, id, more) => planUnlock(Object.assign({ id, bookings: list, tableBlocks: [], autoOptimizer: true, user: "u@x", stamp }, more || {}));
  // The table the optimiser gives a lone party of 2, so the test names no table.
  const home = byId(planReshuffle({ viewDate: D, tableBlocks: [], today: TODAY, nowMins: 600 }).transform([bk("x", "19:00", 2, [])]), "x").tables;
  const away = ["13"].filter((t) => !home.includes(t));

  it("the booking is no longer locked or hand-placed, with one history line", () => {
    const list = [bk("a", "19:00", 2, away, { _locked: true, _manual: true })];
    const a = byId(unlock(list, "a").transform(list), "a");
    expect(a._locked).toBe(false);
    expect(a._manual).toBe(false);
    expect(a.history).toEqual([{ action: "unlocked: the optimiser may move it", by: "u@x" }]);
  });

  it("with the Optimiser on, it goes where the optimiser would put it, and the sentence says so", () => {
    const list = [bk("a", "19:00", 2, away, { _locked: true, _manual: true })];
    const plan = unlock(list, "a");
    expect(byId(plan.transform(list), "a").tables).toEqual(home);
    expect(plan.done).toBe("A unlocked, now on " + home.join("+") + ".");
  });

  it("with the Optimiser off (today, after the cutoff) it stays where it is", () => {
    const list = [bk("a", "19:00", 2, away, { date: TODAY, _locked: true, _manual: true })];
    const plan = unlock(list, "a", { autoOptimizer: false });
    const a = byId(plan.transform(list), "a");
    expect(a.tables).toEqual(away);
    expect(a._locked).toBe(false);
    expect(plan.done).toBe("A unlocked.");
  });

  it("re-optimises the BOOKING's day, whatever day is on screen", () => {
    const far = addDays(D, 3);
    const list = [bk("a", "19:00", 2, away, { date: far, _locked: true, _manual: true })];
    expect(byId(unlock(list, "a").transform(list), "a").tables).toEqual(home);
  });

  it("refuses what is not offered, by name", () => {
    const list = [bk("s", "19:00", 2, ["3"], { status: "seated", _locked: true }), bk("free", "19:00", 2, ["4"])];
    expect(unlock(list, "s")).toEqual({ refuse: "S is seated — a seated party stays at its table." });
    expect(unlock(list, "free")).toEqual({ refuse: "FREE is not locked." });
    expect(unlock(list, "nobody")).toEqual({ refuse: "Booking not found." });
  });

  it("a replay on a list where the booking has gone changes nothing", () => {
    const list = [bk("a", "19:00", 2, away, { _locked: true, _manual: true })];
    const other = [bk("b", "19:00", 2, home)];
    expect(unlock(list, "a").transform(other)).toBe(other);
  });

  // /code-review: the plan's snapshot said "locked, confirmed"; the row being
  // written may say otherwise by the time a held write replays. Handing back a
  // seated party's tables left it seated with none.
  it("a replay over a booking that was seated, finished or unlocked meanwhile writes nothing", () => {
    const list = [bk("a", "19:00", 2, away, { _locked: true, _manual: true }), bk("b", "19:00", 2, home)];
    const plan = unlock(list, "a");
    for (const change of [{ status: "seated" }, { status: "completed" }, { status: "cancelled" }, { _locked: false, _manual: false, tables: ["7"] }]) {
      const fresh = [Object.assign({}, list[0], change), list[1]];
      expect(plan.transform(fresh), JSON.stringify(change)).toBe(fresh);
      expect(plan.replayRefusal(fresh), JSON.stringify(change)).toBe("The unlock of A was not saved: the day changed on another device.");
    }
  });

  it("a replay over the same booking, still locked, goes ahead and is not refused", () => {
    const list = [bk("a", "19:00", 2, away, { _locked: true, _manual: true })];
    const plan = unlock(list, "a");
    const fresh = [Object.assign({}, list[0], { notes: "window" })];
    expect(plan.replayRefusal(fresh)).toBe(null);
    expect(byId(plan.transform(fresh), "a")).toMatchObject({ _locked: false, tables: home, notes: "window" });
    // A booking that has gone is the other report's question (`goneRefusal`).
    expect(plan.replayRefusal([])).toBe(null);
  });

  it("refuses when the party would have no table without its lock, in the saves' sentence", () => {
    const list = fullDay();
    expect(seatedCount(list)).toBe(list.length);
    expect(unlock(list, "big")).toEqual({ refuse: "Not enough capacity — unlocking BIG would displace 1 existing booking: BIG." });
  });

  it("the same day with the Optimiser off: nothing moves, so the lock comes off", () => {
    const list = fullDay().map((b) => Object.assign({}, b, { date: TODAY }));
    const plan = unlock(list, "big", { autoOptimizer: false });
    expect(plan.refuse).toBe(undefined);
    const out = plan.transform(list);
    expect(byId(out, "big")).toMatchObject({ _locked: false, tables: byId(list, "big").tables });
    expect(seatedCount(out)).toBe(list.length);
  });

  it("a replay on a day that filled up meanwhile writes nothing, and says so", () => {
    const list = [bk("big", "19:00", 5, ["3"], { _locked: true, _manual: true })];
    const plan = unlock(list, "big");
    expect(plan.refuse).toBe(undefined);
    const full = fullDay();
    expect(plan.transform(full)).toBe(full);
    expect(plan.replayRefusal(full)).toBe("The unlock of BIG was not saved: the day changed on another device.");
  });
});

describe("Unlock: the doors", () => {
  const src = (f) => stripComments(readFileSync(new URL("../src/components/" + f, import.meta.url), "utf8")).join("\n");
  it("saveMove asks a plan's own replay question after \"the booking has gone\"", () => {
    const app = appCode();
    expect(app).toContain("return {replayRefusal:function(prev){return (gone&&gone(prev))||plan.replayRefusal(prev);}};");
    expect(app).toContain("}},planReplay(id,plan)));");
  });
  // /code-review: Reassign moves a booking's tables and asked nothing; since (C)
  // it moves a locked one, which Unlock and a drag refuse without the capability.
  it("App's reassignBooking asks bookingAssign before the plan", () => {
    expect(appCode()).toMatch(/function reassignBooking\(id\)\{if\(refused\("bookingAssign"\)\)return;\s+const plan=planReassign\(/);
  });
  it("App's unlockBooking is the gate, the plan and saveMove", () => {
    const app = appCode();
    expect(app).toMatch(/function unlockBooking\(id\)\{if\(refused\("bookingAssign"\)\)return;/);
    expect(app).toContain('saveMove(plan.transform,id,"move",plan.done,');
    expect(app).toContain("onUnlock:function(id){R.current.unlockBooking(id);}");
  });
  it("all three places the status card opens hand it onUnlock", () => {
    for (const f of ["TimelineView.jsx", "ListView.jsx", "PlanView.jsx"]) {
      expect(src(f), f).toMatch(/<QuickStatusPopup[^]*?onUnlock=\{onUnlock\}/);
    }
  });
  it("the card offers it only where unlockOffered says so", () => {
    expect(src("QuickStatusPopup.jsx")).toContain("onUnlock && unlockOffered(booking) ?");
  });
});

// ── v18.17.0 (B): Reshuffle can take the day's locks off ─────────────────────
describe("planReshuffle: Reshuffle and unlock N", () => {
  const home = byId(planReshuffle({ viewDate: D, tableBlocks: [], today: TODAY, nowMins: 600 }).transform([bk("x", "19:00", 2, [])]), "x").tables;
  const away = ["13"].filter((t) => !home.includes(t));
  const list = [
    bk("drag", "19:00", 2, away, { _locked: true, _manual: true }),
    bk("sat", "13:00", 2, ["12"], { status: "seated", _locked: true, _manual: true }),
    bk("far", "19:00", 2, away, { date: addDays(D, 1), _locked: true, _manual: true }),
  ];
  const run = (unlock) => planReshuffle({ viewDate: D, tableBlocks: [], today: TODAY, nowMins: 600, unlock, bookings: list, user: "u@x", stamp });

  it("counts the day's locked bookings that have not sat down", () => {
    expect(lockedOn(list, D)).toBe(1);
    expect(lockedOn(list, addDays(D, 1))).toBe(1);
    expect(lockedOn([], D)).toBe(0);
  });

  it("a plain Reshuffle keeps every lock, as it always has", () => {
    const out = run(false).transform(list);
    expect(byId(out, "drag").tables).toEqual(away);
    expect(byId(out, "drag")._locked).toBe(true);
    expect(run(false).done).toBe("Tables re-optimised.");
    expect(run(undefined).done).toBe("Tables re-optimised.");
  });

  it("with unlock, the day's locked bookings are handed back and placed again", () => {
    const out = run(true).transform(list);
    const d = byId(out, "drag");
    expect(d._locked).toBe(false);
    expect(d._manual).toBe(false);
    expect(d.tables).toEqual(home);
    expect(d.history).toEqual([{ action: "unlocked by Reshuffle", by: "u@x" }]);
    expect(run(true).done).toBe("Tables re-optimised, 1 unlocked.");
  });

  it("never a seated party, and never another day's booking", () => {
    const out = run(true).transform(list);
    expect(byId(out, "sat")).toMatchObject({ tables: ["12"], _locked: true });
    expect(byId(out, "far")).toEqual(list[2]);
  });

  // /code-review: measured on a full 19:00, the freed party of five took a
  // joined set and a party of two that had a table was left without one, under
  // "Tables re-optimised, 1 unlocked.".
  it("with unlock, refuses when taking the locks off would cost a party its table", () => {
    const full = fullDay();
    const plan = planReshuffle({ viewDate: D, tableBlocks: [], today: TODAY, nowMins: 600, unlock: true, bookings: full, user: "u@x", stamp });
    expect(plan.transform).toBe(undefined);
    expect(plan.refuse).toMatch(/^Not enough capacity — unlocking would displace 1 existing booking: /);
  });

  it("the plain Reshuffle on that day is not refused and unseats nobody", () => {
    const full = fullDay();
    const plan = planReshuffle({ viewDate: D, tableBlocks: [], today: TODAY, nowMins: 600, bookings: full });
    expect(plan.refuse).toBe(undefined);
    const out = plan.transform(full);
    expect(seatedCount(out)).toBe(full.length);
    expect(byId(out, "big")._locked).toBe(true);
  });

  it("a replay of an unlocking Reshuffle on a day that filled up writes nothing", () => {
    const full = fullDay();
    expect(run(true).transform(full)).toBe(full);
  });

  it("App shows the refusal and dispatches nothing", () => {
    expect(appCode()).toContain("if(plan.refuse){flashRefusal(plan.refuse);return;}\n    saveMove(plan.transform,null,\"reshuffle\",plan.done,");
  });

  it("only the literal true unlocks: Enter on the confirm passes nothing", () => {
    expect(byId(planReshuffle({ viewDate: D, tableBlocks: [], today: TODAY, nowMins: 600, unlock: {}, bookings: list }).transform(list), "drag")._locked).toBe(true);
  });

  it("the confirm offers it only when the day has a lock, and both buttons wait out a double tap", () => {
    const app = appCode();
    expect(app).toContain("const reshuffleLocked=confirmReshuffle?lockedOn(bookings,viewDate):0;");
    expect(app).toContain("{reshuffleLocked>0?<button");
    expect(app).toContain("if(!armSettled())return;setConfirmReshuffle(false);forceReshuffle(true);");
    expect(app).toContain("if(!armSettled())return;setConfirmReshuffle(false);forceReshuffle();");
  });
});


// ── v18.18.0 commit 15: Reshuffle asks for Move tables ───────────────────────
// Reshuffle moves every unlocked party of the day, and it was the one action
// that moves tables without asking `bookingAssign`: a drag, Assign, Reassign and
// Unlock all ask it. App's `openReshuffle` is the one door to the confirm, and
// it asks at the press, so the refusal comes before the confirm opens.
describe("Reshuffle asks for Move tables", () => {
  it("one door opens the confirm, and it asks first", () => {
    const app = appCode();
    expect(app).toContain('function openReshuffle(){if(refused("bookingAssign"))return;setConfirmReshuffle(true);}');
    // Nothing else opens it, so no way in can skip the question.
    expect(app.match(/setConfirmReshuffle\(true\)/g)).toHaveLength(1);
  });

  it("every way in goes through it: the notice, the views' button and the keyboard", () => {
    const app = appCode();
    // The notice's goes through the ref: `openReshuffle` itself in that render-time
    // call made the React Compiler give up on BookingApp (src/CLAUDE.md, hook order).
    expect(app).toContain("onReshuffle:function(){viewActionsRef.current.openReshuffle();},");
    expect(app).toContain("onReshuffle:function(){R.current.openReshuffle();},");
    expect(app).toContain("setConfirmReshuffle:setConfirmReshuffle,openReshuffle:openReshuffle,");
  });
});


// ── v18.18.0 commit 16: Reshuffle on today and every later day ───────────────
// Since v18.17.0 a save on a day the Optimiser owns keeps the day (`applyOptKeep`),
// so the fresh pass happens only on Reshuffle, which showed on today with the
// switch OFF alone. Patryk: today and every later day, whatever the switch says;
// grey, and orange while pressing it would help. The undo of each kind is proved
// in tests/delete-undo.test.js ("a Reshuffle, undone").
describe("reshuffleOffer: where the Reshuffle button shows, and when it is orange", () => {
  const offer = (viewDate, autoOptimizer, suggest) => reshuffleOffer({ viewDate, today: TODAY, autoOptimizer, suggest });

  it("nothing on a past day, whatever the switch or the check says", () => {
    [true, false].forEach((on) => [true, false].forEach((s) => {
      expect(offer(addDays(TODAY, -1), on, s), on + " " + s).toBe(null);
      expect(offer(addDays(TODAY, -30), on, s), on + " " + s).toBe(null);
    }));
  });
  it("today with the Optimiser off is always orange, as it was", () => {
    expect(offer(TODAY, false, false)).toEqual({ lit: true });
    expect(offer(TODAY, false, true)).toEqual({ lit: true });
  });
  it("today with it on is grey, and orange while the check fires", () => {
    expect(offer(TODAY, true, false)).toEqual({ lit: false });
    expect(offer(TODAY, true, true)).toEqual({ lit: true });
  });
  it("a later day is grey whatever the switch says, and orange while the check fires", () => {
    [true, false].forEach((on) => {
      expect(offer(D, on, false), String(on)).toEqual({ lit: false });
      expect(offer(D, on, true), String(on)).toEqual({ lit: true });
    });
  });
  it("only the literal true lights it, and a date it cannot compare offers nothing", () => {
    for (const s of [1, "true", undefined, null]) expect(offer(D, true, s), String(s)).toEqual({ lit: false });
    expect(reshuffleOffer({ viewDate: null, today: TODAY })).toBe(null);
    expect(reshuffleOffer({ viewDate: D })).toBe(null);
    expect(reshuffleOffer(undefined)).toBe(null);
  });
});

describe("App: Reshuffle on every day ahead", () => {
  const src = (f) => stripComments(readFileSync(new URL("../src/components/" + f, import.meta.url), "utf8")).join("\n");

  it("the notice and the button read one check, and neither is offered on a past day", () => {
    const app = appCode();
    expect(app).toContain("const suggestOn=!!(inefficient&&optimizerActiveFor(viewDate,autoOptimizer)&&bookingDefaults.reshuffleSuggestEnabled&&viewDate>=today);");
    // Dismiss is the notice's alone: the button reads `suggestOn`, which does not know it.
    expect(app).toContain("const ineffShow=!reshuffled&&suggestOn&&dismissedIneff!==viewDate;");
    // `todayStr()` in place: App's `today` handed to a call at render made the
    // React Compiler give up on BookingApp (src/CLAUDE.md, hook order).
    expect(app).toContain("const reshuffleBtn=reshuffleOffer({viewDate:viewDate,today:todayStr(),autoOptimizer:autoOptimizer,suggest:suggestOn});");
  });

  it("both places that draw it take the answer as scalars (the Summary is a memo)", () => {
    const app = appCode();
    expect(app).toContain("reshuffleOn={!!reshuffleBtn}");
    expect(app.match(/reshuffleLit=\{!!reshuffleBtn&&reshuffleBtn\.lit\}/g)).toHaveLength(2);
    expect(src("TimelineView.jsx")).toContain("const optBtns = reshuffleOn ? (");
    for (const f of ["TimelineView.jsx", "Summary.jsx"]) {
      expect(src(f), f).toContain("<OptimiserControls autoOptimizer={autoOptimizer} setAutoOptimizer={setAutoOptimizer} onReshuffle={onReshuffle} isToday={isToday} lit={reshuffleLit} />");
    }
  });

  it("Reshuffle comes first, and the Optimiser toggle beside it is today's alone", () => {
    const c = src("OptimiserControls.jsx");
    const reshuffleAt = c.indexOf(">\n        Reshuffle\n      </button>");
    const toggleAt = c.indexOf('{"Optimiser: " + (autoOptimizer ? "ON" : "OFF")}');
    expect(reshuffleAt).toBeGreaterThan(-1);
    expect(toggleAt).toBeGreaterThan(reshuffleAt);
    expect(c).toContain("{isToday ? (");
    // It no longer slides in with the switch: it is always there on its days.
    expect(c).not.toContain("Presence");
  });

  it("the confirm names the day away from today, and says seated parties stay only on today", () => {
    const app = appCode();
    expect(app).toContain('{"Reshuffle all bookings"+(viewDate===today?"":" on "+formatDay(viewDate))+"?"}');
    expect(app).toContain('{"Confirmed bookings may be moved to different tables to improve efficiency."+(viewDate===today?" Seated bookings will not be moved.":"")}');
  });

  it("the pass reads no switch, so today ON and OFF and every later day get the same fresh pass", () => {
    expect(appCode()).toContain("function forceReshuffle(unlock){const plan=planReshuffle({viewDate:viewDate,tableBlocks:tableBlocks,today:today,nowMins:nowMins,unlock:unlock===true,bookings:bookings,user:getUser()});");
  });
});
