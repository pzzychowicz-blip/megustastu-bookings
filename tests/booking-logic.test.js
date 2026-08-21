// tests/booking-logic.test.js
//
// Safety-net for src/lib/booking-logic.js — the pure optimizer "brain".
// Added in the /engineering:tech-debt Phase 3 (test harness). Importing
// booking-logic pulls in constants.js, whose module-load `setLayout(DEFAULT_LAYOUT)`
// seeds the real MGT 13-table layout — so these run against production behaviour:
//   • 8 outdoor 2-tops (1A,1B,2,3,4,5A,5B,6) + table 7 (cap 4) + 4 indoor 2-tops.
//   • TOTAL_SEATS 28; hours 13:00–22:00; duration tiers ≤4→90, else 120.
//   • size-2 avoids table 7; size 3–4 prefers 7; DRAG_MAX_WASTE 4.
// Dates use a fixed FUTURE day so optimizerActiveFor(date, …) is always true and
// syncLiveDurations (seated-today only) never perturbs the fixtures.

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  toMins, toTime, overlaps, genId, getDur, statusOrder,
  comboCap, comboCapBest, sanitize, sanitizeAll, diffBooking,
  lateState, lateMins, freeingSoon, daySummary, rangeStats,
  verifyClean, findConflicts, findClashes, canAssign, getBusy, getBlockSlots,
  findBest, findFreeSlot, applyOpt, bookingsAfterAction,
  applySeatedShift, rankCombosContaining, comboExistsFor,
  isLocked, isActive, isIn, comboOk, undoSnapshots, applyUndo, syncLiveDurations,
  stayedMins, bookEnd, padEnd, dayBookingsSig, describeBooking, clashRowId,
} from "../src/lib/booking-logic.js";
import { TOTAL_SEATS, ALL_TABLES, setTurnBuffer, setLayout, DEFAULT_LAYOUT } from "../src/lib/constants.js";

const D = "2099-06-15";      // fixed future date — optimizer always active
const today = new Date().toISOString().slice(0, 10);

function mk(o) {
  return Object.assign({
    id: genId(), name: "T", phone: "", date: D, time: "13:00", size: 2,
    duration: 90, preference: "auto", status: "confirmed", tables: [],
    _locked: false, _manual: false, preferredTables: [], history: [],
  }, o);
}

describe("seed sanity", () => {
  it("has the MGT 13-table / 28-seat layout", () => {
    expect(ALL_TABLES.length).toBe(13);
    expect(TOTAL_SEATS).toBe(28);
    expect(ALL_TABLES.find((t) => t.id === "7").capacity).toBe(4);
  });
});

describe("time primitives", () => {
  it("toMins / toTime round-trip on the grid", () => {
    expect(toMins("13:30")).toBe(810);
    expect(toMins("00:00")).toBe(0);
    expect(toTime(810)).toBe("13:30");
    expect(toTime(0)).toBe("00:00");
    expect(toTime(1440)).toBe("00:00"); // hours wrap %24
  });
  it("overlaps is half-open (touching ends do not overlap)", () => {
    expect(overlaps(0, 10, 5, 15)).toBe(true);
    expect(overlaps(0, 5, 5, 10)).toBe(false);
    expect(overlaps(0, 10, 10, 20)).toBe(false);
  });
  it("genId is path-safe and unique", () => {
    expect(genId()).toMatch(/^[0-9a-z]+$/);
    expect(genId()).not.toBe(genId());
  });
});

describe("getDur (duration tiers seed)", () => {
  it("≤4 → 90, else 120", () => {
    expect(getDur(1)).toBe(90);
    expect(getDur(2)).toBe(90);
    expect(getDur(4)).toBe(90);
    expect(getDur(5)).toBe(120);
    expect(getDur(8)).toBe(120);
  });
});

describe("statusOrder", () => {
  it("seated < confirmed < pending < completed < cancelled", () => {
    expect([statusOrder("seated"), statusOrder("confirmed"), statusOrder("pending"),
      statusOrder("completed"), statusOrder("cancelled")]).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("combo capacity", () => {
  it("comboCap uses overrides then member sum", () => {
    expect(comboCap(["1A", "1B"])).toBe(6);   // override (not 4)
    expect(comboCap(["3", "4"])).toBe(4);      // sum
    expect(comboCap(["7"])).toBe(4);
    expect(comboCap(["i2", "i3", "i4"])).toBe(8);
  });
  it("comboCapBest matches exact combos, else greedy-largest + leftovers", () => {
    expect(comboCapBest([])).toBe(0);
    expect(comboCapBest(["1A", "1B"])).toBe(6);
    expect(comboCapBest(["7"])).toBe(4);
    // no "1A|2" combo → sum of standalones
    expect(comboCapBest(["1A", "2"])).toBe(4);
    // largest contained combo (1A|1B=6) + leftover standalone 2
    expect(comboCapBest(["1A", "1B", "2"])).toBe(8);
  });
});

describe("sanitize / sanitizeAll", () => {
  it("null-safe, applies defaults, clamps deposit ≥ 0", () => {
    expect(sanitize(null)).toBe(null);
    const s = sanitize({});
    expect(s.size).toBe(2);
    expect(s.duration).toBe(90);
    expect(s.status).toBe("confirmed");
    expect(s.time).toBe("13:00");
    expect(s.tables).toEqual([]);
    expect(sanitize({ deposit: -50 }).deposit).toBe(0);
    expect(sanitize({ deposit: 20 }).deposit).toBe(20);
  });
  it("preserves the updatedAt stamp; reads both array and keyed shapes", () => {
    expect(sanitize({ updatedAt: 12345 }).updatedAt).toBe(12345);
    const arr = sanitizeAll([{ id: "a" }, null, { id: "b" }]);
    expect(arr.map((b) => b.id)).toEqual(["a", "b"]);
    const keyed = sanitizeAll({ x: { id: "x" }, y: { id: "y" } });
    expect(keyed.length).toBe(2);
  });
});

describe("diffBooking", () => {
  it("reports changed fields, else a no-change note", () => {
    const orig = mk({ name: "Ann", size: 2, time: "13:00" });
    expect(diffBooking(orig, { name: "Ann", size: 2, time: "13:00", date: orig.date,
      preference: "auto", status: "confirmed", notes: "" }, 2)).toMatch(/no field changes/);
    const d = diffBooking(orig, { name: "Bob", size: 4, time: "13:00", date: orig.date,
      preference: "auto", status: "confirmed", notes: "" }, 4);
    expect(d).toContain("name Ann→Bob");
    expect(d).toContain("size 2→4");
  });
});

describe("lateState / lateMins", () => {
  const cfg = { lateEnabled: true, lateWarnMin: 15, lateNoShowMin: 20 };
  it("lateMins = now − start", () => {
    expect(lateMins({ time: "13:00" }, 810)).toBe(30);
  });
  it("confirmed/pending today cross warn then noshow thresholds", () => {
    const b = mk({ date: D, time: "13:00", status: "confirmed" });
    expect(lateState(b, D, 790, cfg)).toBe(null);   // 10 late
    expect(lateState(b, D, 795, cfg)).toBe("warn");  // 15 late
    expect(lateState(b, D, 800, cfg)).toBe("noshow"); // 20 late
    expect(lateState(mk({ date: D, time: "13:00", status: "pending" }), D, 800, cfg)).toBe("noshow");
  });
  it("ignores seated/completed, other days, and disabled cfg", () => {
    expect(lateState(mk({ status: "seated", time: "13:00" }), D, 800, cfg)).toBe(null);
    expect(lateState(mk({ status: "completed", time: "13:00" }), D, 800, cfg)).toBe(null);
    expect(lateState(mk({ date: "2099-06-16", time: "13:00" }), D, 800, cfg)).toBe(null);
    expect(lateState(mk({ time: "13:00" }), D, 800, { lateEnabled: false })).toBe(null);
  });
});

// v17.6.0: the List card's "stayed N min" tag on a completed booking.
describe("stayedMins", () => {
  it("returns the stamped stay for a seated→completed booking", () => {
    expect(stayedMins(mk({ status: "completed", stayedMin: 105, duration: 105 }))).toBe(105);
  });

  it("returns null for a booking completed without ever being seated", () => {
    // No stamp and no seated trail — duration is the SCHEDULED 90, which would
    // be a lie about how long they sat. This is the case the tag must skip.
    expect(stayedMins(mk({ status: "completed", duration: 90 }))).toBe(null);
  });

  it("falls back to duration for a legacy booking with a seated history entry", () => {
    const legacy = mk({
      status: "completed", duration: 72,
      history: [{ at: "x", by: "y", action: "status → seated" }],
    });
    expect(stayedMins(legacy)).toBe(72);
  });

  it("also matches the form path's history wording", () => {
    const legacy = mk({
      status: "completed", duration: 64,
      history: [{ at: "x", by: "y", action: "edited: status confirmed→seated" }],
    });
    expect(stayedMins(legacy)).toBe(64);
  });

  it("returns null for any non-completed status, stamp or not", () => {
    expect(stayedMins(mk({ status: "seated", stayedMin: 40 }))).toBe(null);
    expect(stayedMins(mk({ status: "confirmed" }))).toBe(null);
    expect(stayedMins(mk({ status: "cancelled", stayedMin: 40 }))).toBe(null);
  });

  it("survives missing / malformed input", () => {
    expect(stayedMins(null)).toBe(null);
    expect(stayedMins(undefined)).toBe(null);
    expect(stayedMins({ status: "completed" })).toBe(null);
    expect(stayedMins({ status: "completed", stayedMin: "abc", history: "nope" })).toBe(null);
    // A zero/negative stamp is "not known", not a zero-minute visit.
    expect(stayedMins(mk({ status: "completed", stayedMin: 0, duration: 90 }))).toBe(null);
  });

  it("survives a sanitize round-trip (stayedMin is whitelisted)", () => {
    const out = sanitize(mk({ status: "completed", stayedMin: 118 }));
    expect(out.stayedMin).toBe(118);
    expect(stayedMins(out)).toBe(118);
  });
});

describe("freeingSoon", () => {
  it("returns seated bookings ending within the window, soonest first; excludes overstayers", () => {
    const soon = mk({ status: "seated", time: "13:00", duration: 90 });  // ends 870, inMin 10
    const later = mk({ status: "seated", time: "13:00", duration: 93 }); // ends 873, inMin 13
    const outside = mk({ status: "seated", time: "13:00", duration: 105 }); // ends 885, inMin 25 > window
    const over = mk({ status: "seated", time: "13:00", duration: 30 });  // ended 810 — overstayer
    const out = freeingSoon([later, soon, outside, over], D, 860, 15);   // now 14:20, window 15
    expect(out.map((f) => f.id)).toEqual([soon.id, later.id]);            // soonest (10) before (13)
    expect(out.find((f) => f.id === outside.id)).toBeUndefined();         // beyond the window
    expect(out.find((f) => f.id === over.id)).toBeUndefined();            // overstayer excluded
    expect(freeingSoon([soon], D, 870, 15)).toEqual([]);                  // exactly at end → not > 0
  });
});

describe("canAssign / getBusy / getBlockSlots", () => {
  it("detects a busy table over an overlapping window", () => {
    const slots = [{ tables: ["7"], s: 780, e: 870 }];
    expect(canAssign(["7"], slots, 800, 860)).toBe(false);
    expect(canAssign(["1A"], slots, 800, 860)).toBe(true);
    expect(canAssign(["7"], slots, 900, 960)).toBe(true); // no overlap
  });
  it("getBusy collects overlapping tables", () => {
    const busy = getBusy([{ tables: ["7", "1A"], s: 780, e: 870 }], 800, 860);
    expect(busy.has("7")).toBe(true);
    expect(busy.has("1A")).toBe(true);
    expect(busy.has("2")).toBe(false);
  });
  it("getBlockSlots maps a timed block to a slot", () => {
    const blocks = [{ tableId: "7", date: D, allDay: false, from: "14:00", to: "15:00" }];
    const s = getBlockSlots(blocks, D);
    expect(s).toEqual([{ tables: ["7"], s: 840, e: 900 }]);
  });
});

describe("findBest (MGT single/combo contracts)", () => {
  const s = 780, e = 870;
  it("size 2 avoids table 7 and returns a single 2-top", () => {
    const r = findBest(2, "auto", s, e, []);
    expect(r).toHaveLength(1);
    expect(r).not.toContain("7");
  });
  it("size 3–4 prefers table 7", () => {
    expect(findBest(4, "auto", s, e, [])).toEqual(["7"]);
    expect(findBest(3, "auto", s, e, [])).toEqual(["7"]);
  });
  it("size 6 needs a combo of sufficient capacity", () => {
    const r = findBest(6, "auto", s, e, []);
    expect(r.length).toBeGreaterThan(1);
    expect(comboCap(r)).toBeGreaterThanOrEqual(6);
  });
  it("respects a preference zone", () => {
    const r = findBest(2, "indoor", s, e, []);
    expect(r.every(isIn)).toBe(true);
  });
});

describe("findFreeSlot", () => {
  it("routes around a busy table", () => {
    const existing = [mk({ tables: ["7"], time: "13:00", duration: 90, size: 4 })];
    const r = findFreeSlot(existing, D, "13:30", 4, "auto", 90, [], null, null);
    expect(r).toBeTruthy();
    expect(r).not.toContain("7"); // 7 is busy at 13:30
  });
  it("honours a preferred-tables hint when it fits and is free", () => {
    const r = findFreeSlot([], D, "13:00", 2, "auto", 90, [], null, ["3"]);
    expect(r).toEqual(["3"]);
  });
});

describe("optimise / applyOpt / bookingsAfterAction", () => {
  it("assigns a lone size-4 booking to table 7", () => {
    const out = applyOpt([mk({ size: 4 })], D, []);
    expect(out[0].tables).toEqual(["7"]);
    expect(out[0]._conflict).toBe(false);
  });
  it("places two overlapping 2-tops on different tables (no overlap)", () => {
    const a = mk({ size: 2, time: "13:00" });
    const b = mk({ size: 2, time: "13:00" });
    const out = applyOpt([a, b], D, []);
    const ta = out.find((x) => x.id === a.id).tables;
    const tb = out.find((x) => x.id === b.id).tables;
    expect(ta.length).toBe(1);
    expect(tb.length).toBe(1);
    expect(ta[0]).not.toBe(tb[0]);
    expect(verifyClean(out, D)).toBe(true);
  });
  it("flags an unplaceable oversized party as conflict, table-less", () => {
    const out = applyOpt([mk({ size: 30 })], D, []);
    expect(out[0].tables).toEqual([]);
    expect(out[0]._conflict).toBe(true);
  });
  it("bookingsAfterAction OFF-path (today + optimizer off) preserves tables", () => {
    const b = mk({ date: today, status: "confirmed", tables: ["7"], size: 4 });
    const out = bookingsAfterAction([b], today, [], null, false, false);
    expect(out[0].tables).toEqual(["7"]);
  });

  // ── v17.14.0: the no-op identity contract ─────────────────────────────────
  // The OFF path used to clone every booking; the ON path built a fresh array
  // from applyOpt. Both now hand back the input when the pass moved nothing,
  // which is what lets a caller ask "did this change anything" with `===`.
  it("OFF-path no-op returns the input array itself", () => {
    const list = [mk({ date: today, status: "confirmed", tables: ["7"], size: 4, _conflict: false })];
    expect(bookingsAfterAction(list, today, [], null, false, false)).toBe(list);
  });

  it("ON-path no-op returns the input array itself", () => {
    // Already optimally placed, so applyOpt reproduces the same assignment.
    const list = applyOpt([mk({ id: "a", size: 4 }), mk({ id: "b", time: "20:00", size: 2 })], D, []);
    expect(bookingsAfterAction(list, D, [], null, false, true)).toBe(list);
  });

  it("still returns a NEW array when the pass actually moves something", () => {
    // Deliberately mis-assigned: table 7 for a party of 4 that the optimizer
    // places elsewhere. The identity contract must not swallow a real change.
    const list = [mk({ id: "a", size: 4, tables: [], _conflict: true })];
    const out = bookingsAfterAction(list, D, [], null, false, true);
    expect(out).not.toBe(list);
    expect(out[0].tables.length).toBeGreaterThan(0);
  });

  it("a seated party past its duration is a change, not a no-op", () => {
    // syncLiveDurations extends `duration`/`customDur`. Both are in the compared
    // field set on purpose — a narrower compare would report "no change" and the
    // extension would be discarded, which is the v17.10.2 lesson this reuses.
    const start = "00:00";
    const list = [mk({ id: "s", date: today, status: "seated", time: start, duration: 1, customDur: 1, tables: ["7"], _conflict: false })];
    const out = bookingsAfterAction(list, today, [], null, false, false);
    expect(out).not.toBe(list);
    expect(out[0].duration).toBeGreaterThan(1);
  });
});

// v17.6.0: separation between bookings. The whole feature hangs off the
// TURN_BUFFER live binding, so these flip it directly and MUST restore it — a
// leaked non-zero buffer would silently change every later test in the file.
describe("turnaround buffer (separation between bookings)", () => {
  const on = (min) => setTurnBuffer({ turnaroundEnabled: true, turnaroundMin: min });
  const off = () => setTurnBuffer(null);
  afterEach(off);

  it("is off unless BOTH the switch and a positive value are set", () => {
    setTurnBuffer({ turnaroundEnabled: false, turnaroundMin: 30 });
    expect(padEnd(100)).toBe(100);
    setTurnBuffer({ turnaroundEnabled: true, turnaroundMin: 0 });
    expect(padEnd(100)).toBe(100);
    setTurnBuffer({ turnaroundEnabled: true, turnaroundMin: "nonsense" });
    expect(padEnd(100)).toBe(100);
  });

  it("bookEnd/padEnd add the buffer to ends only", () => {
    on(15);
    expect(padEnd(100)).toBe(115);
    expect(bookEnd(mk({ time: "13:00", duration: 90 }))).toBe(13 * 60 + 90 + 15);
    // A missing duration still falls back to 90, buffered.
    expect(bookEnd({ time: "13:00" })).toBe(13 * 60 + 90 + 15);
  });

  // NB these assert on whether table "2" is OFFERED, not on a null result:
  // findFreeSlot falls back to findBest and will happily return some other free
  // table. "Is table 2 still on the table" is the question the buffer answers.
  const on2 = (existing, time) =>
    findFreeSlot(existing, D, time, 2, "auto", 90, [], null, ["2"]);

  it("refuses a booking starting inside the previous party's buffer", () => {
    const existing = [mk({ id: "a", time: "13:00", duration: 90, tables: ["2"] })]; // ends 14:30
    expect(on2(existing, "14:30")).toEqual(["2"]);   // no buffer → bookable at the end
    on(15);
    expect(on2(existing, "14:30")).not.toContain("2");
    expect(on2(existing, "14:45")).toEqual(["2"]);
  });

  it("also protects the booking BEFORE an existing one (both ends padded)", () => {
    // `a` starts at 16:00; a 90-min booking ENDING exactly at 16:00 must be
    // refused too, or the separation would only work in one direction.
    const existing = [mk({ id: "a", time: "16:00", duration: 90, tables: ["2"] })];
    expect(on2(existing, "14:30")).toEqual(["2"]);
    on(15);
    expect(on2(existing, "14:30")).not.toContain("2");
    expect(on2(existing, "14:15")).toEqual(["2"]);
  });

  it("separates by exactly the buffer, never twice it", () => {
    on(30);
    const existing = [mk({ id: "a", time: "13:00", duration: 90, tables: ["2"] })]; // ends 14:30
    expect(on2(existing, "14:45")).not.toContain("2");  // 15 min gap — still short
    expect(on2(existing, "15:00")).toEqual(["2"]);      // exactly 30 — allowed
  });

  it("does NOT pad a table block — a block ends when it says it ends", () => {
    on(30);
    const blocks = [{ tableId: "2", date: D, from: "13:00", to: "14:00" }];
    expect(findFreeSlot([], D, "14:00", 2, "auto", 90, blocks, null, ["2"])).toEqual(["2"]);
  });

  it("leaves clash detection alone — an existing back-to-back day stays clean", () => {
    // The decision: switching the setting on must never flag or reshuffle a day
    // that is already booked. verifyClean/findConflicts are unbuffered.
    const day = [
      mk({ id: "a", time: "13:00", duration: 90, tables: ["2"] }),
      mk({ id: "b", time: "14:30", duration: 90, tables: ["2"] }),
    ];
    expect(verifyClean(day, D)).toBe(true);
    on(30);
    expect(verifyClean(day, D)).toBe(true);
    expect(findConflicts(day, D)).toEqual([]);
  });

  it("keeps the optimizer's output conflict-free with a buffer on", () => {
    on(15);
    const day = [2, 4, 2, 6, 3].map((size, i) =>
      mk({ id: "o" + i, time: i % 2 ? "13:00" : "19:00", size, tables: [] })
    );
    const out = applyOpt(day, D, []);
    expect(verifyClean(out, D)).toBe(true);
  });
});

describe("verifyClean / findConflicts", () => {
  it("clean when tables differ; dirty + both ids when they collide", () => {
    const a = mk({ id: "a", tables: ["7"], time: "13:00", duration: 90, size: 4 });
    const b = mk({ id: "b", tables: ["7"], time: "13:30", duration: 90, size: 4 }); // overlaps on 7
    expect(verifyClean([a, b], D)).toBe(false);
    expect(findConflicts([a, b], D).sort()).toEqual(["a", "b"]);
    const c = mk({ id: "c", tables: ["1A"], time: "13:30", duration: 90 });
    expect(verifyClean([a, c], D)).toBe(true);
    expect(findConflicts([a, c], D)).toEqual([]);
  });
});

describe("applySeatedShift", () => {
  it("shifts start to now and pins the original end", () => {
    const b = mk({ time: "13:00", duration: 90, tables: ["7"] }); // scheduled 13:00–14:30
    const r = applySeatedShift(b, 795, [b]); // now 13:15
    expect(r).toBeTruthy();
    expect(r.newTime).toBe("13:15");
    expect(r.newDuration).toBe(75);       // 870 − 795
    expect(r.direction).toBe("late");
  });
  it("returns null at start, past end, or on a shared-table conflict", () => {
    const b = mk({ time: "13:00", duration: 90 });
    expect(applySeatedShift(b, 780, [b])).toBe(null); // now === start
    expect(applySeatedShift(b, 900, [b])).toBe(null); // now ≥ end
    const b2 = mk({ time: "13:00", duration: 90, tables: ["7"] });
    const other = mk({ id: "o", time: "13:20", duration: 90, tables: ["7"] });
    expect(applySeatedShift(b2, 795, [b2, other])).toBe(null); // shared-table overlap
  });
});

describe("rankCombosContaining / comboExistsFor (drag-drop contracts)", () => {
  it("comboExistsFor sees a joinable combo even when the drag rules won't build it", () => {
    expect(comboExistsFor("i1", 4)).toBe(true);     // i1 is in cross-room megas
    // …but a 4-top on i1 wastes > DRAG_MAX_WASTE(4), so the drag ranking excludes all
    expect(rankCombosContaining("i1", 4)).toEqual([]);
  });
  it("an 8-top on table 7 ranks a containing combo, fewest tables first, waste ≤ 4", () => {
    const r = rankCombosContaining("7", 8);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].ids).toContain("7");
    expect(r[0].cap).toBeGreaterThanOrEqual(8);
    expect(r[0].cap - 8).toBeLessThanOrEqual(4);
  });
});

describe("isLocked / isActive / comboOk", () => {
  it("locked = _locked or seated; active excludes cancelled/completed", () => {
    expect(isLocked(mk({ _locked: true }))).toBe(true);
    expect(isLocked(mk({ status: "seated" }))).toBe(true);
    expect(isLocked(mk({ status: "confirmed" }))).toBe(false);
    expect(isActive(mk({ status: "confirmed" }))).toBe(true);
    expect(isActive(mk({ status: "cancelled" }))).toBe(false);
    expect(isActive(mk({ status: "completed" }))).toBe(false);
  });
  it("comboOk rejects a cross-zone set for a zoned preference", () => {
    expect(comboOk(["1A"], "outdoor")).toBe(true);
    expect(comboOk(["i1"], "outdoor")).toBe(false);
    expect(comboOk(["1A", "i1"], "indoor")).toBe(false); // mixed, non-auto pref
  });
});

describe("daySummary", () => {
  it("totals covers and splits by shift + status", () => {
    const bks = [
      mk({ size: 2, time: "13:00", status: "seated" }),
      mk({ size: 4, time: "20:00", status: "confirmed" }),
      mk({ size: 3, time: "21:00", status: "cancelled" }), // excluded from covers
    ];
    const s = daySummary(bks, D, 18);
    expect(s.totalCovers).toBe(6);         // 2 + 4 (cancelled excluded)
    expect(s.afternoon.covers).toBe(2);    // 13:00 < 18
    expect(s.evening.covers).toBe(4);      // 20:00 ≥ 18
    expect(s.seated.count).toBe(1);
    expect(s.seated.covers).toBe(2);
    expect(s.upcoming.count).toBe(1);      // confirmed
  });
});

describe("rangeStats", () => {
  it("aggregates covers, avg party, and no-shows over a range", () => {
    const bks = [
      mk({ date: "2099-06-10", size: 2, status: "completed" }),
      mk({ date: "2099-06-11", size: 4, status: "confirmed" }),
      mk({ date: "2099-06-12", size: 2, status: "cancelled", noShow: true }), // no-show
      mk({ date: "2099-05-01", size: 8, status: "confirmed" }), // out of range
    ];
    const r = rangeStats(bks, "2099-06-01", "2099-06-30");
    expect(r.totalBookings).toBe(2);       // completed + confirmed (cancelled excluded)
    expect(r.totalCovers).toBe(6);         // 2 + 4
    expect(r.avgParty).toBe(3);
    expect(r.noShows).toBe(1);
  });
});

// ── v17.4.0: undo delta helpers ───────────────────────────────────────────────
// These lock in the "restore what the action moved, and ONLY that" contract:
// rewriting bookings an action never touched would widen the window in which
// undo can clobber another device's concurrent edit.
describe("undoSnapshots / applyUndo", () => {
  const a = mk({ id: "a", time: "13:00", tables: ["2"] });
  const b = mk({ id: "b", time: "13:00", tables: ["3"] });
  const c = mk({ id: "c", time: "20:00", tables: ["4"] });

  it("captures the PRE version of every booking the action changed", () => {
    const prev = [a, b, c];
    // the action edited a's size and the optimizer moved b to another table
    const next = [{ ...a, size: 6 }, { ...b, tables: ["5A"] }, c];
    const snaps = undoSnapshots(prev, next);
    expect(snaps.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(snaps.find((x) => x.id === "a").size).toBe(a.size);
    expect(snaps.find((x) => x.id === "b").tables).toEqual(["3"]);
  });

  it("captures a booking the action REMOVED (delete path)", () => {
    const snaps = undoSnapshots([a, b], [b]);
    expect(snaps.map((x) => x.id)).toEqual(["a"]);
  });

  it("ignores untouched bookings, and history/updatedAt churn", () => {
    const prev = [a, b];
    const next = [
      { ...a, history: [{ at: "x", by: "y", action: "edited" }], updatedAt: 999 },
      b,
    ];
    expect(undoSnapshots(prev, next)).toEqual([]);
  });

  it("treats table ORDER as equivalent (a reorder is not a move)", () => {
    const two = mk({ id: "t", tables: ["1A", "1B"] });
    expect(undoSnapshots([two], [{ ...two, tables: ["1B", "1A"] }])).toEqual([]);
  });

  it("applyUndo replaces existing bookings and re-adds deleted ones", () => {
    const current = [{ ...a, size: 6 }, { ...b, tables: ["5A"] }, c];
    const out = applyUndo(current, [a, b]);
    expect(out.find((x) => x.id === "a").size).toBe(a.size);
    expect(out.find((x) => x.id === "b").tables).toEqual(["3"]);
    // untouched booking keeps its IDENTITY, so the diff-write skips it
    expect(out.find((x) => x.id === "c")).toBe(c);
  });

  it("applyUndo re-adds a booking that is gone from current", () => {
    const out = applyUndo([b], [a]);
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("applyUndo with no snapshots is a no-op", () => {
    const cur = [a, b];
    expect(applyUndo(cur, [])).toBe(cur);
  });

  it("a seated OVERSTAYER is not swept in when both sides are live-synced", () => {
    // /code-review regression: bookingsAfterAction runs syncLiveDurations, which
    // rewrites duration/customDur for a seated overstayer on today. Comparing a
    // RAW prev against a synced next made that untouched booking look changed.
    // App's undoDelta syncs the prev side first — modelled here.
    const t = "2099-06-15";
    const nowM = 15 * 60;                       // 15:00
    const over = mk({ id: "ov", status: "seated", date: t, time: "13:00", duration: 90, tables: ["6"] });
    const target = mk({ id: "tg", date: t, time: "20:00", tables: ["2"] });
    const prev = [over, target];
    // the action changed only `target`; the optimizer pass live-synced `over`
    const next = syncLiveDurations(prev, t, nowM).map((b) =>
      b.id === "tg" ? { ...b, status: "cancelled" } : b
    );
    // RAW prev: the overstayer is a false positive
    expect(undoSnapshots(prev, next).map((b) => b.id).sort()).toEqual(["ov", "tg"]);
    // SYNCED prev (what undoDelta does): only the real change survives
    expect(undoSnapshots(syncLiveDurations(prev, t, nowM), next).map((b) => b.id)).toEqual(["tg"]);
  });

  it("round-trips: undo of an action restores the exact prior state", () => {
    const prev = [a, b, c];
    const next = [{ ...a, size: 6 }, { ...b, tables: ["5A"] }, c];
    const restored = applyUndo(next, undoSnapshots(prev, next));
    expect(restored.map((x) => ({ id: x.id, size: x.size, tables: x.tables })))
      .toEqual(prev.map((x) => ({ id: x.id, size: x.size, tables: x.tables })));
  });
});

// ── v17.4.0: optimizer invariants ─────────────────────────────────────────────
// The heuristics in this file went through ~10 documented correctness rounds.
// These lock the invariants CLAUDE.md calls out as load-bearing, so a future
// refactor can't quietly relax one.
describe("optimizer invariants", () => {
  it("NEVER reshuffles a seated booking off its tables", () => {
    const seated = mk({ id: "s", status: "seated", time: "13:00", size: 2, tables: ["7"], date: today });
    const other = mk({ id: "o", status: "confirmed", time: "13:00", size: 4, tables: [], date: today });
    const out = applyOpt([seated, other], today, []);
    expect(out.find((b) => b.id === "s").tables).toEqual(["7"]);
  });

  it("NEVER reshuffles a locked walk-in", () => {
    const walkin = mk({ id: "w", time: "13:00", size: 2, tables: ["6"], _manual: true, _locked: true });
    const other = mk({ id: "o", time: "13:00", size: 6, tables: [] });
    const out = applyOpt([walkin, other], D, []);
    expect(out.find((b) => b.id === "w").tables).toEqual(["6"]);
    expect(isLocked(out.find((b) => b.id === "w"))).toBe(true);
  });

  it("treats a COMPLETED booking's table as free", () => {
    // a completed 13:00 booking must not block a new 13:00 booking on its table
    const done = mk({ id: "d", status: "completed", time: "13:00", size: 2, tables: ["2"] });
    const fresh = mk({ id: "f", status: "confirmed", time: "13:00", size: 2, tables: [] });
    const out = applyOpt([done, fresh], D, []);
    const got = out.find((b) => b.id === "f");
    expect(got.tables.length).toBeGreaterThan(0);
    expect(got._conflict).toBeFalsy();
  });

  it("a cancelled booking never occupies a table", () => {
    const dead = mk({ id: "c", status: "cancelled", time: "13:00", size: 2, tables: ["2"] });
    expect(isActive(dead)).toBe(false);
    const out = applyOpt([dead, mk({ id: "n", time: "13:00", size: 2, tables: [] })], D, []);
    expect(verifyClean(out, D)).toBe(true);
  });

  it("is idempotent — optimising an optimised day changes nothing", () => {
    const day = [
      mk({ id: "1", time: "13:00", size: 2, tables: [] }),
      mk({ id: "2", time: "13:00", size: 4, tables: [] }),
      mk({ id: "3", time: "19:00", size: 6, tables: [] }),
    ];
    const once = applyOpt(day, D, []);
    const twice = applyOpt(once, D, []);
    expect(twice.map((b) => b.tables.join("+"))).toEqual(once.map((b) => b.tables.join("+")));
  });

  it("produces a conflict-free day for a realistic service", () => {
    const day = [2, 4, 2, 6, 3, 2, 4].map((size, i) =>
      mk({ id: "b" + i, time: i % 2 ? "13:00" : "20:00", size, tables: [] })
    );
    const out = applyOpt(day, D, []);
    expect(verifyClean(out, D)).toBe(true);
    expect(findConflicts(out, D)).toEqual([]);
  });

  it("respects a table block — never assigns a blocked table", () => {
    const blocks = [{ tableId: "7", date: D, allDay: true }];
    const out = applyOpt([mk({ id: "b", time: "13:00", size: 4, tables: [] })], D, blocks);
    expect(out[0].tables).not.toContain("7");
  });

  it("honours an indoor/outdoor preference", () => {
    const inn = applyOpt([mk({ id: "i", time: "13:00", size: 2, preference: "indoor", tables: [] })], D, []);
    expect(inn[0].tables.every(isIn)).toBe(true);
    const out = applyOpt([mk({ id: "o", time: "13:00", size: 2, preference: "outdoor", tables: [] })], D, []);
    expect(out[0].tables.every((t) => !isIn(t))).toBe(true);
  });
});

// ── dayBookingsSig + the unresolvable-clash property (v17.10.2) ─────────────
//
// These pin the two halves of the reconciliation-loop fix. The effect in App.jsx
// re-dispatches a date only when a pass would actually CHANGE something, and it
// decides that by comparing signatures — so both the comparison and the property
// it detects need to be nailed down here, where they are reachable.

describe("dayBookingsSig", () => {
  it("is stable across array order — the same day scores the same", () => {
    const a = mk({ id: "a", tables: ["1A"] });
    const b = mk({ id: "b", time: "18:00", tables: ["2"] });
    expect(dayBookingsSig([a, b], D)).toBe(dayBookingsSig([b, a], D));
  });
  it("is stable across TABLE order within one booking", () => {
    expect(dayBookingsSig([mk({ id: "a", tables: ["5A", "5B"] })], D))
      .toBe(dayBookingsSig([mk({ id: "a", tables: ["5B", "5A"] })], D));
  });
  it("changes when a booking moves table", () => {
    expect(dayBookingsSig([mk({ id: "a", tables: ["1A"] })], D))
      .not.toBe(dayBookingsSig([mk({ id: "a", tables: ["2"] })], D));
  });
  it("ignores other dates entirely", () => {
    const same = mk({ id: "a", tables: ["1A"] });
    const other = mk({ id: "z", date: "2099-06-16", tables: ["6"] });
    expect(dayBookingsSig([same], D)).toBe(dayBookingsSig([same, other], D));
  });
  it("survives a missing/!array tables field rather than throwing", () => {
    expect(() => dayBookingsSig([{ id: "a", date: D }], D)).not.toThrow();
    expect(dayBookingsSig(null, D)).toBe("");
  });
});

describe("dayBookingsSig covers what the pass can change, not just tables", () => {
  // /code-review: the first version compared `id:tables` alone. But
  // `bookingsAfterAction` ALSO runs syncLiveDurations (extending a seated
  // party's duration) and applyOpt sets `_conflict` — so on a date that stays
  // dirty, a tables-only signature read those as "no change" and the guard
  // discarded them. Each case below failed against that version.
  const base = mk({ id: "s", tables: ["1A"], status: "seated", duration: 90 });

  it("sees a live duration extension with no table move", () => {
    const extended = Object.assign({}, base, { duration: 150, customDur: 150 });
    expect(dayBookingsSig([base], D)).not.toBe(dayBookingsSig([extended], D));
  });
  it("sees a _conflict flip with no table move", () => {
    const flagged = Object.assign({}, base, { _conflict: true });
    expect(dayBookingsSig([base], D)).not.toBe(dayBookingsSig([flagged], D));
  });
  it("sees a status change with no table move", () => {
    expect(dayBookingsSig([base], D))
      .not.toBe(dayBookingsSig([Object.assign({}, base, { status: "completed" })], D));
  });
  it("still ignores per-write metadata, so a server echo is not a change", () => {
    const echoed = Object.assign({}, base, { updatedAt: Date.now(), baseUpdatedAt: 1, history: [{ a: 1 }] });
    expect(dayBookingsSig([base], D)).toBe(dayBookingsSig([echoed], D));
  });
});

describe("dayBookingsSig separators are not reachable from the data", () => {
  // /code-review: `idOk` (LayoutSettings.jsx) rejects only "" and "|", so a
  // table id may contain "+" — and "+"/"|" were the array/field separators.
  // A venue naming a joined table "1+2" collapsed ["1+2"] and ["1","2"] onto
  // one key, which reads as "nothing changed" and discards a real reshuffle.
  it("distinguishes a table named with the old array separator", () => {
    expect(dayBookingsSig([mk({ id: "x", tables: ["1+2"] })], D))
      .not.toBe(dayBookingsSig([mk({ id: "x", tables: ["1", "2"] })], D));
  });
  it("distinguishes notes containing the old field separator", () => {
    expect(dayBookingsSig([mk({ id: "x", notes: "a|b", preference: "auto" })], D))
      .not.toBe(dayBookingsSig([mk({ id: "x", notes: "a", preference: "b|auto" })], D));
  });
});

describe("an all-locked clash is unresolvable, which is why the loop existed", () => {
  // Two _locked bookings overlapping on ONE table. Reachable by ordinary use:
  // every walk-in is _manual + _locked, and every drag-drop path sets _locked.
  //
  // `_conflict: false` is not decoration. `applyOpt` writes `_conflict` on every
  // booking for the date, so a fixture that omits it moves undefined → false and
  // the (correctly widened) signature reports a change that the real app can
  // never see: `sanitize` coerces `_conflict: !!b._conflict`, and every booking
  // reaches state through `sanitizeAll`. The fixture trap CLAUDE.md records for
  // ALL_TABLES, one field along — build fixtures to what `sanitize` guarantees,
  // or the test measures the fixture instead of the code.
  const clash = () => [
    mk({ id: "p", time: "20:00", tables: ["3"], _locked: true, _manual: true, _conflict: false }),
    mk({ id: "r", time: "20:30", tables: ["3"], _locked: true, _manual: true, _conflict: false }),
  ];

  it("is genuinely a conflict, and findConflicts sees it", () => {
    expect(verifyClean(clash(), D)).toBe(false);
    expect(findConflicts(clash(), D).sort()).toEqual(["p", "r"]);
  });

  it("findClashes names the PAIR, the shared table and the shared minutes", () => {
    // The half findConflicts throws away. "p and r" is what a strip row is
    // about; "table 3" and "20:30–21:30" are what the row and the block title
    // say. None of it is recoverable from the id set.
    const out = findClashes(clash(), D);
    expect(out.length).toBe(1);
    expect(out[0].a).toBe("p");
    expect(out[0].b).toBe("r");
    expect(out[0].tables).toEqual(["3"]);
    expect(out[0].from).toBe(toMins("20:30"));  // later start
    expect(out[0].to).toBe(toMins("21:30"));    // earlier end (p: 20:00 + 90)
  });

  it("findConflicts is exactly findClashes deduped — the contract did not move", () => {
    const pairs = findClashes(clash(), D);
    const ids = new Set(pairs.flatMap((c) => [c.a, c.b]));
    expect(findConflicts(clash(), D).sort()).toEqual([...ids].sort());
  });

  it("a clean day yields no pairs", () => {
    const ok = [
      mk({ id: "p", time: "20:00", tables: ["3"] }),
      mk({ id: "r", time: "20:00", tables: ["4"] }),
    ];
    expect(findClashes(ok, D)).toEqual([]);
  });

  it("survives a reshuffle unchanged — applyOpt copies locked tables verbatim", () => {
    const before = clash();
    const after = bookingsAfterAction(before, D, [], null, false, true);
    expect(dayBookingsSig(after, D)).toBe(dayBookingsSig(before, D));
    expect(verifyClean(after, D)).toBe(false);   // still dirty, still unresolvable
  });

  it("returns the INPUT array when nothing changed — v17.14.0 inverted this", () => {
    // Until v17.14.0 this returned a fresh array either way, and that was the
    // fuel: the reconciliation effect assigned the result unconditionally,
    // React saw a new reference on a dep, and re-ran the effect forever. The
    // v17.10.2 fix compared signatures at that ONE call site; v17.14.0 fixes it
    // at the source, so every caller can compare identity.
    //
    // This assertion is the exact reverse of the one it replaces. That is the
    // point of the change, not a regression — the old test's "do not optimise
    // that away" was guarding the call-site fix, which still stands.
    const before = clash();
    expect(bookingsAfterAction(before, D, [], null, false, true)).toBe(before);
  });

  it("a clash the optimizer CAN fix does change the signature", () => {
    const before = [
      mk({ id: "p", time: "20:00", tables: ["3"], _locked: true, _manual: true, _conflict: false }),
      mk({ id: "r", time: "20:30", tables: ["3"], _conflict: false }),   // movable
    ];
    const after = bookingsAfterAction(before, D, [], null, false, true);
    expect(dayBookingsSig(after, D)).not.toBe(dayBookingsSig(before, D));
    expect(verifyClean(after, D)).toBe(true);
  });
});

// v17.14.0: clashRowId had no test, despite its comment making the separator
// load-bearing and naming the exact collision it exists to avoid. It is the key
// of the notification strip's per-clash dismissal Set, so a collision does not
// throw — it silently dismisses a DIFFERENT double-booking than the one the ✕
// was pressed on, which is the failure mode nobody would report as a bug.
describe("clashRowId", () => {
  it("is stable and ordered — a pair has ONE id", () => {
    expect(clashRowId({ a: "p", b: "r" })).toBe(clashRowId({ a: "p", b: "r" }));
  });

  it("keys by PAIR, not by booking — dismissing p·r does not key p·x", () => {
    // The reason the Set is pair-keyed at all: silencing "Pau vs Rita" must not
    // silence "Rita vs a third party".
    expect(clashRowId({ a: "p", b: "r" })).not.toBe(clashRowId({ a: "p", b: "x" }));
    expect(clashRowId({ a: "p", b: "r" })).not.toBe(clashRowId({ a: "x", b: "r" }));
  });

  it("does not collide on ids that WOULD collide under \"_\"", () => {
    // A recurring occurrence id is "r" + ruleId + "_" + date, so "_" is already
    // spoken for by the data — exactly the class of separator the comment warns
    // about. Under "_" both of these pairs render "rA_2026-08-21_x".
    const one = clashRowId({ a: "rA_2026-08-21", b: "x" });
    const two = clashRowId({ a: "rA", b: "2026-08-21_x" });
    expect(one).not.toBe(two);
    expect(one.replace(/\u001f/g, "_")).toBe(two.replace(/\u001f/g, "_"));  // proves the premise
  });

  it("does not collide on ids containing a hyphen", () => {
    expect(clashRowId({ a: "r1-2", b: "3" })).not.toBe(clashRowId({ a: "r1", b: "2-3" }));
  });

  it("the SOURCE writes the separator as an escape, never as a raw byte", () => {
    // A literal 0x1F in source is invisible in every editor, grep and diff — the
    // same class of trap as the HTML entity that hid from v17.9.0's glyph sweep.
    // Asserted over the whole module, so it also covers undoKey's four keys.
    const src = readFileSync(new URL("../src/lib/booking-logic.js", import.meta.url), "utf8");
    expect(src).toMatch(/\\u001f/);
    expect(src.includes("\u001f")).toBe(false);
  });
});

describe("findClashes: the clash with NO shared table", () => {
  // canAssign rejects a pair for a SECOND reason: each booking taking two or
  // more tables from the same join cluster (they would need the same physical
  // join). Those two sets need not intersect — which callers must handle,
  // because "both on table N" is then a sentence with no N in it.
  //
  // Unreachable in the DEFAULT layout by pigeonhole: its biggest cluster is
  // three tables, and two 2-subsets of a 3-set always share a member. It takes
  // a join group of FOUR, which Settings → Layout permits.
  afterEach(() => setLayout(DEFAULT_LAYOUT));

  it("reports the pair with an empty `tables`", () => {
    setLayout(Object.assign({}, DEFAULT_LAYOUT, {
      joinGroups: [["2", "3", "4", "5A"]],
    }));
    const day = [
      mk({ id: "p", time: "20:00", size: 4, tables: ["2", "3"], _locked: true }),
      mk({ id: "r", time: "20:00", size: 4, tables: ["4", "5A"], _locked: true }),
    ];
    const out = findClashes(day, D);
    expect(out.length).toBe(1);
    expect(out[0].tables).toEqual([]);          // nothing to name
    expect(findConflicts(day, D).sort()).toEqual(["p", "r"]);
  });
});

// ── describeBooking (v17.12.0) ───────────────────────────────────────────────
// The one source for every spoken label in the app. It replaced three
// hand-written copies, so what these pin is that the extraction did not change a
// single character of what the three views already said — and that the one
// PARAMETER exists for a reason PlanView actually has.
describe("describeBooking", () => {
  const b = { name: "Pau Estévez", time: "20:00", size: 4, tables: ["3"], status: "confirmed" };

  it("reads as the List card and the timeline block always did", () => {
    expect(describeBooking(b)).toBe("Pau Estévez, 20:00, 4 guests, table 3, confirmed");
  });

  it("says `guest` for a party of one", () => {
    // The pluralisation was written out three times before this; a size of 1 is
    // the only input that told the three copies apart from each other.
    expect(describeBooking({ ...b, size: 1 })).toBe("Pau Estévez, 20:00, 1 guest, table 3, confirmed");
  });

  it("names an unassigned booking as unassigned rather than trailing off", () => {
    expect(describeBooking({ ...b, tables: [] })).toBe("Pau Estévez, 20:00, 4 guests, no table assigned, confirmed");
    expect(describeBooking({ ...b, tables: undefined })).toBe("Pau Estévez, 20:00, 4 guests, no table assigned, confirmed");
  });

  it("joins a two-table booking, and pluralises the noun", () => {
    expect(describeBooking({ ...b, tables: ["5A", "5B"] })).toBe("Pau Estévez, 20:00, 4 guests, tables 5A and 5B, confirmed");
  });

  it("joins THREE tables as a list, not as a chain of \"and\"", () => {
    // v17.14.0. The extraction commit joined with " and " throughout, which gave
    // "5A and 5B and 6". A three- or four-table mega-combo is an ordinary
    // Settings → Layout configuration, so this is reachable rather than theoretical.
    expect(describeBooking({ ...b, tables: ["5A", "5B", "6"] })).toBe("Pau Estévez, 20:00, 4 guests, tables 5A, 5B and 6, confirmed");
    expect(describeBooking({ ...b, tables: ["1A", "1B", "2", "3"] })).toBe("Pau Estévez, 20:00, 4 guests, tables 1A, 1B, 2 and 3, confirmed");
  });

  it("a single table keeps the singular noun and no join", () => {
    expect(describeBooking({ ...b, tables: ["3"] })).toBe("Pau Estévez, 20:00, 4 guests, table 3, confirmed");
  });

  it("drops the table clause entirely for PlanView, rather than saying none", () => {
    // On the floor plan the table IS the subject ("Table 3, …"), so repeating it
    // would be redundant and "no table assigned" would be false — the booking is
    // on the very table doing the asking.
    expect(describeBooking(b, { tables: false })).toBe("Pau Estévez, 20:00, 4 guests, confirmed");
    expect(describeBooking({ ...b, tables: [] }, { tables: false })).toBe("Pau Estévez, 20:00, 4 guests, confirmed");
  });

  it("treats any other option object as the default", () => {
    expect(describeBooking(b, {})).toBe(describeBooking(b));
    expect(describeBooking(b, null)).toBe(describeBooking(b));
  });
});
