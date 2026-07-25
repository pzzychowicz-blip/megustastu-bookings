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

import { describe, it, expect } from "vitest";
import {
  toMins, toTime, overlaps, genId, getDur, statusOrder,
  comboCap, comboCapBest, sanitize, sanitizeAll, diffBooking,
  lateState, lateMins, freeingSoon, daySummary, rangeStats,
  verifyClean, findConflicts, canAssign, getBusy, getBlockSlots,
  findBest, findFreeSlot, applyOpt, bookingsAfterAction,
  applySeatedShift, rankCombosContaining, comboExistsFor,
  isLocked, isActive, isIn, comboOk, undoSnapshots, applyUndo, syncLiveDurations,
} from "../src/lib/booking-logic.js";
import { TOTAL_SEATS, ALL_TABLES } from "../src/lib/constants.js";

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
