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

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  toMins, toTime, overlaps, genId, getDur, statusOrder,
  comboCap, comboCapBest, sanitize, sanitizeAll, isReadableTime, diffBooking,
  lateState, lateMins, freeingSoon, daySummary, rangeStats,
  verifyClean, findConflicts, findClashes, canAssign, getBusy, getBlockSlots, isReadableBlock,
  findBest, findFreeSlot, applyOpt, optimise, bookingsAfterAction,
  applySeatedShift, rankCombosContaining, comboExistsFor,
  isLocked, isActive, isIn, comboOk, undoSnapshots, applyUndo, syncLiveDurations,
  stayedMins, bookEnd, padEnd, dayBookingsSig, describeBooking, clashRowId, mergeSpans,
  sanitizeBlock, sanitizeBlocks,
  liveBarDur, seatedElapsed, seatedIsLive, occupancyEnd, pastCloseMins, seatingClosed,
  plannedDuration, seatNoteFor,
  tablesPinned, seatedFitRefusal, pinnedClashParties, pinnedClashRefusal, replacePinnedClashes,
  unseatRestore, seatRefusal, seatClashParties, completedSeatedPatch, seatedShiftFor,
  tablesFreeFor, trialFits, enteredPhone, kitchenRelevant, savedToast, lastStartMins,
} from "../src/lib/booking-logic.js";
import { TOTAL_SEATS, ALL_TABLES, setTurnBuffer, setLayout, DEFAULT_LAYOUT } from "../src/lib/constants.js";
import { todayStr } from "../src/lib/day.js";
import { setWeekHours, DEFAULT_WEEK_HOURS } from "../src/lib/constants.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const D = "2099-06-15";      // fixed future date — optimizer always active
// v17.16.2: same source as the app. Derived with toISOString() this drifted
// one day from the code under test between 00:00 and 01:00 every summer.
const today = todayStr();

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

// v17.16.5 (CT-2A-05): the optimiser's answer must not depend on the order the
// bookings arrived in. It did — `optimise`'s four sort keys are not a total
// order and `Array.sort` is stable, so a tie fell through to array position,
// and array order is not the same on two devices (one that just created a
// booking has it appended; one that received it by snapshot has it key-sorted).
//
// The fixture is deliberately the shape that TIES: same size, same start, same
// "auto" preference — which is also the shape a real service has. On the
// measured 200-day harness this scenario differed in 138/200 before the id key
// and 0/200 after.
describe("optimise is order-invariant", () => {
  const D = "2026-09-10";
  const party = (id, time, size) => sanitize({
    id, name: id, date: D, time, size, duration: 90,
    preference: "auto", status: "confirmed",
  });
  const day = () => [
    party("b01", "20:00", 2), party("b02", "20:00", 2), party("b03", "20:00", 2),
    party("b04", "20:00", 4), party("b05", "20:00", 4), party("b06", "20:30", 2),
    party("b07", "20:30", 2), party("b08", "20:30", 4),
  ];
  const sig = (res) => Object.keys(res).sort()
    .map((k) => k + ":" + (res[k] || []).slice().sort().join("+")).join("|");

  // Every case below asserts PLACEMENT before it asserts invariance, and that
  // order is the point (/code-review). `sig({})` is the empty string, so an
  // `optimise` that assigns NOBODY produces one identical signature for every
  // ordering and satisfies invariance perfectly — proven, not argued: with
  // `var assigned={}` substituted for the greedy pass, both of these tests
  // passed. **Invariance is a property of the answer, so there has to be an
  // answer first**, or the strongest possible regression reads as green.
  const placed = (res, n) => {
    const got = Object.keys(res).filter((k) => (res[k] || []).length > 0);
    expect(got.length).toBe(n);
    return res;
  };

  it("gives the same assignment however the list is ordered", () => {
    const base = sig(placed(optimise(day(), D, []), 8));
    expect(base).not.toBe("");
    expect(sig(placed(optimise(day().reverse(), D, []), 8))).toBe(base);
    // A rotation and a swap of two tied neighbours — the two ways a real array
    // diverges (an append landing elsewhere than the key sort would put it).
    const rot = day(); rot.push(rot.shift());
    expect(sig(placed(optimise(rot, D, []), 8))).toBe(base);
    const sw = day(); const t = sw[0]; sw[0] = sw[2]; sw[2] = t;
    expect(sig(placed(optimise(sw, D, []), 8))).toBe(base);
  });

  // Every permutation, not a handful. A sampled shuffle can pass by luck on a
  // build with no tie-break — the first draft of this test did exactly that,
  // and a test that cannot fail is worse than none because it reports coverage
  // it does not have. Five fully-tied parties is 120 orderings, which settles it
  // exhaustively and runs in milliseconds.
  it("gives one answer across all 120 orderings of a fully tied day", () => {
    const tied = [
      party("b01", "20:00", 2), party("b02", "20:00", 2), party("b03", "20:00", 2),
      party("b04", "20:00", 2), party("b05", "20:00", 2),
    ];
    const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) =>
      perms(a.slice(0, i).concat(a.slice(i + 1))).map((p) => [x].concat(p)));
    const all = perms(tied);
    expect(all.length).toBe(120);
    const answers = new Set(all.map((p) => sig(placed(optimise(p, D, []), 5))));
    expect(answers.size).toBe(1);
    // NOT `answers.has(sig(optimise(tied, …)))`: `tied` is one of the 120, and
    // the line above already says there is exactly one answer, so that check
    // could never fail — the vacuous-assertion trap this whole test exists to
    // avoid, one line further down. What is actually worth pinning is that the
    // single answer places every party on a distinct table, i.e. that the five
    // tied parties were resolved rather than collapsed onto one another.
    const only = [...answers][0];
    const tables = only.split("|").map((e) => e.split(":")[1]);
    expect(new Set(tables).size).toBe(5);
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
  // v17.16.5 (CT-2A-03, client half). `toMins` is `t.split(":")` at 83 call
  // sites, so a stored time that is not a readable string is a crash, not a
  // wrong value — and it is reachable from the server, where the rules check
  // type and deliberately not format.
  it("keeps only a time toMins can read; every other shape takes the default", () => {
    // The exact reproduction: a number is truthy, so it used to survive.
    expect(sanitize({ time: 2000 }).time).toBe("13:00");
    expect(() => toMins(sanitize({ time: 2000 }).time)).not.toThrow();
    expect(sanitize({ time: true }).time).toBe("13:00");
    expect(sanitize({ time: { h: 13 } }).time).toBe("13:00");
    expect(sanitize({ time: ["13:00"] }).time).toBe("13:00");
    // Silent rather than throwing, and just as unusable: toMins("31/08/2026") is NaN.
    expect(sanitize({ time: "31/08/2026" }).time).toBe("13:00");
    // scheduledTime carries the same guard, and falls back to the sanitised
    // time rather than to the literal — a booking moved to 19:00 whose
    // scheduledTime is junk must not claim it was scheduled for 13:00.
    expect(sanitize({ time: "19:00", scheduledTime: 9 }).scheduledTime).toBe("19:00");
    expect(sanitize({ time: 2000, scheduledTime: 2000 }).scheduledTime).toBe("13:00");
  });
  // The guard is the CONSUMER'S requirement, not a format of its own: nothing
  // that reads today may move. These are the values that would break if someone
  // "tightened" it into a /^\d{2}:\d{2}$/ pattern.
  it("does not move a value that already reads", () => {
    expect(sanitize({ time: "9:30" }).time).toBe("9:30");
    expect(sanitize({ time: "13:00:00" }).time).toBe("13:00:00");
    expect(sanitize({ time: "13:0" }).time).toBe("13:0");
    // Kept deliberately, and recorded at the predicate: neither crashes, so
    // neither is this fix's business. ":" reads as 00:00, "25:99" as 1599.
    expect(sanitize({ time: ":" }).time).toBe(":");
    expect(sanitize({ time: "25:99" }).time).toBe("25:99");
  });
  it("isReadableTime answers for the consumer", () => {
    expect(isReadableTime("13:00")).toBe(true);
    expect(isReadableTime(2000)).toBe(false);
    expect(isReadableTime("")).toBe(false);
    expect(isReadableTime("1300")).toBe(false);
    expect(isReadableTime(null)).toBe(false);
    expect(isReadableTime(undefined)).toBe(false);
  });
  it("preserves the updatedAt stamp; reads both array and keyed shapes", () => {
    expect(sanitize({ updatedAt: 12345 }).updatedAt).toBe(12345);
    const arr = sanitizeAll([{ id: "a" }, null, { id: "b" }]);
    expect(arr.map((b) => b.id)).toEqual(["a", "b"]);
    const keyed = sanitizeAll({ x: { id: "x" }, y: { id: "y" } });
    expect(keyed.length).toBe(2);
  });
});

describe("sanitizeAll — the RTDB key IS the identity of last resort (v17.16.13)", () => {
  // `sanitize` did `id: b.id || genId()` and `sanitizeAll` mapped
  // `Object.values(node)`, throwing the key away. So a /bookings/{key} child
  // whose stored value carries no `id` field got a NEW identity on every read.
  //
  // Measured live on DEV: the write-diff saw a create, `stampForWrite` had no
  // `old` so it stamped `baseUpdatedAt: 0`, the per-$id rule ACCEPTS that for a
  // create, and the node grew by one booking per pass — 538 -> 541 across four
  // consecutive listener fires. What `ROADMAP.md` recorded as an oscillating
  // reconciler was the reconciler working correctly on data that changed
  // underneath it every read.
  const keylessRow = { name: "Probe", date: "2026-09-05", time: "20:00", size: 2, tables: ["3"] };

  it("two reads of ONE unchanged node agree about every id", () => {
    const node = { zznav_probe: { ...keylessRow }, real: { id: "real", ...keylessRow } };
    const a = sanitizeAll(node);
    const b = sanitizeAll(node);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  it("a keyless row takes the key it was stored under", () => {
    expect(sanitizeAll({ zznav_probe: { ...keylessRow } })[0].id).toBe("zznav_probe");
  });

  it("a row that states its own id keeps it, even when the key differs", () => {
    // Every row this app has ever written states its id AND uses it as the key,
    // so the two agree. Only a row written by something else — an Admin-SDK
    // backend, a console edit, a rules probe — reaches the key arm at all.
    expect(sanitizeAll({ somekey: { id: "mine", ...keylessRow } })[0].id).toBe("mine");
  });

  it("ids stay UNIQUE across a node mixing keyed, keyless and colliding rows", () => {
    const ids = sanitizeAll({
      a: { id: "a", ...keylessRow },
      b: { ...keylessRow },
      c: { ...keylessRow },
    }).map((x) => x.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("the legacy ARRAY arm does NOT take the index as an identity", () => {
    // An index is a position, not an identity (the v17.16.4 lesson: a stale
    // index resolves to a DIFFERENT row). That node is converted by the v15.5.0
    // migration on first load anyway.
    const [row] = sanitizeAll([{ ...keylessRow }]);
    expect(row.id).not.toBe("0");
    expect(row.id).not.toBe(0);
    expect(typeof row.id).toBe("string");
    expect(row.id.length).toBeGreaterThan(3);
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
    expect(lateMins({ date: D, time: "13:00" }, 810, D)).toBe(30);
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

  // v17.16.6 — the getBlockSlots sibling of CT-2A-03. A block's from/to reach
  // the same `toMins` a booking's `time` does, and `sanitizeBlock` is a MINT
  // rather than a whitelist, so nothing upstream guarantees they are readable.
  // Before this the call threw `t.split is not a function` and took the whole
  // placement path with it — every scan that consults blocks.
  it("skips a block whose from/to `toMins` cannot read, instead of throwing", () => {
    const bad = { tableId: "7", date: D, allDay: false, from: 2000, to: 2100 };
    const good = { tableId: "2", date: D, allDay: false, from: "14:00", to: "15:00" };
    expect(() => getBlockSlots([bad], D)).not.toThrow();
    // The survivor is what matters: one malformed block must not cost the others.
    expect(getBlockSlots([bad, good], D)).toEqual([{ tables: ["2"], s: 840, e: 900 }]);
  });

  it("skips it whichever end is unreadable, and for every unreadable shape", () => {
    const shapes = [
      { from: 2000, to: "15:00" },
      { from: "14:00", to: 2100 },
      { from: null, to: "15:00" },
      { from: "14:00", to: undefined },
      { from: "", to: "15:00" },
      { from: "14:00", to: {} },
      { from: "not a time", to: "15:00" },
    ];
    shapes.forEach((sh) => {
      const bl = Object.assign({ tableId: "7", date: D, allDay: false }, sh);
      expect(() => getBlockSlots([bl], D)).not.toThrow();
      expect(getBlockSlots([bl], D)).toEqual([]);
    });
  });

  it("leaves an allDay block alone — it never reads from/to", () => {
    // The skip must not widen into blocks the defect cannot reach: an allDay
    // block spans hoursFor(date) and its from/to are ignored, so a malformed
    // pair there is not a reason to stop protecting the table all day.
    const bl = { tableId: "7", date: D, allDay: true, from: 2000, to: null };
    const s = getBlockSlots([bl], D);
    expect(s).toHaveLength(1);
    expect(s[0].tables).toEqual(["7"]);
    expect(Number.isFinite(s[0].s) && Number.isFinite(s[0].e)).toBe(true);
  });

  // v17.16.6 (/code-review): the guard shipped on ONE of two consumers. BlockBar
  // (TimelineView) filters dayBlocks by date alone and then calls toMins(bl.from)
  // itself, so an unreadable block still threw — during RENDER, where the error
  // boundary unmounts the whole app. The predicate is exported and shared now,
  // and this is the guard that fails if a third consumer appears without it.
  it("EVERY consumer that computes with bl.from/bl.to filters on the predicate", () => {
    const files = ["src/lib/booking-logic.js", "src/components/TimelineView.jsx",
      "src/components/PlanView.jsx", "src/components/DaySheet.jsx",
      "src/components/BlockModal.jsx", "src/components/ManualModal.jsx",
      "src/components/WalkinForm.jsx", "src/App.jsx"];
    const offenders = [];
    files.forEach((f) => {
      const src = stripComments(readFileSync(new URL("../" + f, import.meta.url), "utf8")).join("\n");
      // Does this file hand a block's own from/to to toMins itself, rather than
      // going through getBlockSlots? If so it must know about the predicate.
      const computes = /toMins\(\s*b[a-z]*\.(from|to)\s*\)/.test(src);
      if (computes && !src.includes("isReadableBlock")) offenders.push(f);
    });
    expect(offenders).toEqual([]);
  });

  it("isReadableBlock answers for a null block and for allDay", () => {
    expect(isReadableBlock(null)).toBe(false);
    expect(isReadableBlock(undefined)).toBe(false);
    // allDay never reads from/to, so a malformed pair there is not a reason to
    // stop protecting the table all day.
    expect(isReadableBlock({ allDay: true, from: 2000, to: null })).toBe(true);
    expect(isReadableBlock({ allDay: false, from: "14:00", to: "15:00" })).toBe(true);
    expect(isReadableBlock({ allDay: false, from: 2000, to: "15:00" })).toBe(false);
    expect(isReadableBlock({ allDay: false, from: "14:00", to: undefined })).toBe(false);
  });

  it("keeps every readable time the app already accepts", () => {
    // The guard is `toMins` yields a finite number — the consumer's own
    // requirement — and NOT a format of its own, for `isReadableTime`'s stated
    // reason: nothing that currently works may move. "9:30" and "13:00:00" are
    // not what the picker emits and both read fine today.
    const keep = [
      ["9:30", "10:30", 570, 630],
      ["13:00:00", "14:00:00", 780, 840],
      [":", "1:00", 0, 60],
    ];
    keep.forEach(([from, to, es, ee]) => {
      const bl = { tableId: "7", date: D, allDay: false, from, to };
      expect(getBlockSlots([bl], D)).toEqual([{ tables: ["7"], s: es, e: ee }]);
    });
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
  // ── v17.15.5: a FINISHED booking's tables are a historical record ────────
  // These pin the layer `doSaveEdit` disagreed with. App's own fix (a completed
  // or cancelled booking is never handed to the optimiser and never has its
  // tables blanked) is the caller's half; this is the half that was already
  // right and must stay right, because the App fix is written to agree with it.
  it("applyOpt never moves a completed booking, whatever else it reshuffles", () => {
    const done = mk({ status: "completed", tables: ["7"], size: 4, time: "13:00" });
    // A live booking that the optimiser WOULD like to put on table 7.
    const live = mk({ status: "confirmed", tables: [], size: 4, time: "13:00" });
    const out = applyOpt([done, live], D, []);
    const d = out.find((x) => x.id === done.id);
    expect(d.tables, "a party that has already left did sit where they sat")
      .toEqual(["7"]);
    expect(d.status).toBe("completed");
  });
  it("applyOpt does not refill a completed booking whose tables were blanked", () => {
    // Why blanking one upstream is unrecoverable rather than merely untidy —
    // this is what turned an edit into "No tables available at this time".
    const out = applyOpt([mk({ status: "completed", tables: [], size: 4 })], D, []);
    expect(out[0].tables).toEqual([]);
    expect(out[0]._conflict, "and it is not even flagged as a conflict").toBe(false);
  });
  it("a completed booking keeps its tables through a size change", () => {
    const done = mk({ date: today, status: "completed", tables: ["7"], size: 4, _locked: true });
    const bigger = Object.assign({}, done, { size: 6 });
    const out = bookingsAfterAction([bigger], today, [], done.id, true, true);
    expect(out[0].tables, "a size edit must not relocate a finished visit")
      .toEqual(["7"]);
  });
  it("a cancelled booking keeps its tables through a size change", () => {
    const gone = mk({ date: today, status: "cancelled", tables: ["5A"], size: 2 });
    const bigger = Object.assign({}, gone, { size: 4 });
    const out = bookingsAfterAction([bigger], today, [], gone.id, true, true);
    expect(out[0].tables).toEqual(["5A"]);
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
    //
    // The CLOCK IS FROZEN, and that is not tidiness. The fixture starts at
    // "00:00" with `duration: 1`, and the extension is elapsed-since-start — so
    // "extended past 1" needs `nowMins >= 2`, i.e. this test FAILED for the
    // first two minutes after local midnight and passed the other 1438. Caught
    // by running it at 00:00 on 2026-09-04: the file was red at 00:00 and green
    // at 00:03, with nothing changed in between. Same family as the stale date
    // literal that turned `main` red on 2026-09-02 (CLAUDE.md's Gotchas), in
    // its time-of-day variant — and worse to diagnose, because it heals itself
    // within two minutes and points at whatever change is in flight.
    //
    // Noon on the test's OWN date, so `today` still matches and the assertion
    // no longer depends on when the suite happens to run.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(today + "T12:00:00"));
    try {
      const start = "00:00";
      const list = [mk({ id: "s", date: today, status: "seated", time: start, duration: 1, customDur: 1, tables: ["7"], _conflict: false })];
      const out = bookingsAfterAction(list, today, [], null, false, false);
      expect(out).not.toBe(list);
      expect(out[0].duration).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
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
    const r = applySeatedShift(b, 795, [b], D); // now 13:15
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

  // v17.16.6 (CT-2A-11): the separator is no longer reachable FROM THE DATA.
  //
  // The source comment used to assert "No text field in the app can produce a
  // control character", which nothing enforced and which was false — `notes` is
  // a <textarea> and `sanitize` writes it verbatim. `idOk`
  // (LayoutSettings.jsx:81) forbids only "|" in a table id, and neither
  // `settings/layout` nor `bookings` validates field FORMAT server-side, so a
  // value carrying one is reachable exactly as a malformed `time` is.
  //
  // The ARRAY join is where a SINGLE poisoned value collides. The field join has
  // fixed arity, so shifting content across one boundary changes the separator
  // count and cannot collide without a second poisoned field — which is why the
  // reachable case here is the same shape as the v17.10.2 defect that introduced
  // these separators ("1+2" vs ["1","2"]), with the separator that replaced it.
  const SEP = "\u001f";  // K_ARR — written as the escape, never the raw byte
  it("does not collapse a poisoned table id and a two-table set into one key", () => {
    const one = mk({ id: "k", tables: ["a" + SEP + "b"] });
    const two = { ...one, tables: ["a", "b"] };
    // Two genuinely different table sets. Before this both joined to the same
    // string, undoKey read "nothing changed", and NO UNDO SNAPSHOT WAS TAKEN —
    // the action became silently un-undoable.
    expect(undoSnapshots([one], [two]).map((x) => x.id)).toEqual(["k"]);
    expect(undoSnapshots([two], [one]).map((x) => x.id)).toEqual(["k"]);
    // dayBookingsSig gates the reconciliation effect on the same key, where the
    // same collision discards a real reshuffle instead.
    expect(dayBookingsSig([one], one.date)).not.toBe(dayBookingsSig([two], two.date));
  });

  it("separates a poisoned preferredTables the same way", () => {
    // The other array field in UNDO_FIELDS, and it holds table ids too.
    const one = mk({ id: "k", preferredTables: ["a" + SEP + "b"] });
    const two = { ...one, preferredTables: ["a", "b"] };
    expect(undoSnapshots([one], [two]).map((x) => x.id)).toEqual(["k"]);
  });

  it("ESCAPES rather than strips, so it opens no collision of its own", () => {
    // The distinction that decided the fix. Stripping the bytes out would map
    // "a<SEP>b" and "ab" onto one key — the identical failure one character
    // away, and the one an injective escape cannot produce.
    const withSep = mk({ id: "k", notes: "a" + SEP + "b" });
    const without = { ...withSep, notes: "ab" };
    expect(undoSnapshots([withSep], [without]).map((x) => x.id)).toEqual(["k"]);
    // ESC is itself inside the escaped range, so data cannot forge an escape:
    // a literal ESC becomes ESC-"[" and a literal "[" stays "[".
    const esc = mk({ id: "k", notes: "a\u001bb" });
    const forged = { ...esc, notes: "a[b" };
    expect(undoSnapshots([esc], [forged]).map((x) => x.id)).toEqual(["k"]);
  });

  it("renders a null array element as join always did, not as \"null\"", () => {
    // /code-review. Swapping `join` for `.map(escSep)` changed how a null or
    // undefined ELEMENT stringifies: join gives "", String(v) gives "null" —
    // so [null] and ["null"] became one key, a NEW collision in the function
    // this version exists to remove one from. RTDB returns a sparse array as
    // ["1A", null, "2"] and sanitize only checks Array.isArray, so the null
    // side is reachable; `idOk` permits a table literally named "null".
    const holed = mk({ id: "k", tables: [null] });
    const named = { ...holed, tables: ["null"] };
    expect(undoSnapshots([holed], [named]).map((x) => x.id)).toEqual(["k"]);
    expect(dayBookingsSig([holed], holed.date)).not.toBe(dayBookingsSig([named], named.date));
    // ...and undefined the same way, against its own spelling
    const undef = mk({ id: "k", tables: [undefined] });
    const uname = { ...undef, tables: ["undefined"] };
    expect(undoSnapshots([undef], [uname]).map((x) => x.id)).toEqual(["k"]);
    // The escape must be a pure ADDITION to the old key: a hole still collapses
    // to nothing, exactly as join rendered it.
    expect(dayBookingsSig([holed], holed.date))
      .toBe(dayBookingsSig([mk({ id: "k", tables: [undefined] })], holed.date));
  });

  it("leaves every ordinary value exactly where it was", () => {
    // The guarantee that matters more than the collision: nothing WITHOUT a
    // control character may change behaviour. An unchanged booking still reads
    // unchanged, and a real edit still reads as one.
    const plain = mk({ id: "k", name: "Nunez-O'Brien", notes: "window seat, 2 high chairs" });
    expect(undoSnapshots([plain], [{ ...plain }])).toEqual([]);
    expect(undoSnapshots([plain], [{ ...plain, notes: "window seat" }]).map((x) => x.id)).toEqual(["k"]);
    expect(dayBookingsSig([plain], plain.date)).toBe(dayBookingsSig([{ ...plain }], plain.date));
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
describe("mergeSpans", () => {
  // v17.14.0. clashSpans emitted one band per PAIR, so three bookings clashing
  // on one table drew three coincident bands on the same pixels.
  const sp = (from, to) => ({ from, to });

  it("leaves a single span, or none, alone", () => {
    expect(mergeSpans([])).toEqual([]);
    expect(mergeSpans([sp(10, 20)])).toEqual([sp(10, 20)]);
    expect(mergeSpans(undefined)).toEqual([]);
  });

  it("merges identical spans - the three-way clash case", () => {
    expect(mergeSpans([sp(1200, 1290), sp(1200, 1290), sp(1200, 1290)]))
      .toEqual([sp(1200, 1290)]);
  });

  it("merges overlapping spans into their union", () => {
    expect(mergeSpans([sp(1200, 1290), sp(1260, 1350)])).toEqual([sp(1200, 1350)]);
  });

  it("merges a span fully contained in another", () => {
    expect(mergeSpans([sp(1200, 1400), sp(1250, 1300)])).toEqual([sp(1200, 1400)]);
  });

  it("merges spans that merely TOUCH", () => {
    // Two clashes meeting at 20:30 are one continuously-contested stretch of the
    // row; two bands separated by a zero-width seam is a rendering artefact.
    expect(mergeSpans([sp(1200, 1230), sp(1230, 1260)])).toEqual([sp(1200, 1260)]);
  });

  it("keeps genuinely separate spans apart, in order", () => {
    expect(mergeSpans([sp(1300, 1400), sp(1200, 1250)]))
      .toEqual([sp(1200, 1250), sp(1300, 1400)]);
  });

  it("does not mutate its input", () => {
    const input = [sp(1200, 1290), sp(1260, 1350)];
    const copy = input.map((x) => ({ ...x }));
    mergeSpans(input);
    expect(input).toEqual(copy);
  });
});

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
    // split/join, not a regex: a control character in a regex literal is a lint
    // ERROR here (no-control-regex) and lint is a hard CI gate.
    const asUnderscore = (k) => k.split("\u001f").join("_");
    expect(asUnderscore(one)).toBe(asUnderscore(two));  // proves the premise
  });

  it("does not collide on ids containing a hyphen", () => {
    expect(clashRowId({ a: "r1-2", b: "3" })).not.toBe(clashRowId({ a: "r1", b: "2-3" }));
  });

  it("the SOURCE writes the separator as an escape, never as a raw byte", () => {
    // A literal 0x1F in source is invisible in every editor, grep and diff — the
    // same class of trap as the HTML entity that hid from v17.9.0's glyph sweep.
    // Asserted over the whole module, so it also covers undoKey's four keys.
    const src = stripComments(readFileSync(new URL("../src/lib/booking-logic.js", import.meta.url), "utf8")).join("\n");
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

// ── Table-block identity (v17.15.3) ───────────────────────────────────────────
// The defect: `removeBlock` matched a block by its field set, and nothing
// dedupes blocks — so two identical blocks were indistinguishable and
// unblocking either dropped BOTH. These pin the mint that replaced it.
describe("sanitizeBlock / sanitizeBlocks", () => {
  const base = { tableId: "3", date: "2026-08-26", allDay: false, from: "14:00", to: "16:00" };

  it("mints an id on a block that has none", () => {
    const out = sanitizeBlock(base);
    expect(typeof out.id).toBe("string");
    expect(out.id.length).toBeGreaterThan(0);
  });

  it("MINTS over a falsy-but-present id, rather than handing it back", () => {
    // /code-review: as `Object.assign({id:genId()}, bl)` the mint sat in the
    // TARGET, so "" / 0 / null / an explicit undefined all overwrote it and the
    // branch that exists to mint an id returned the unusable one it had just
    // rejected. Two blocks sharing a falsy id would then make removeBlock's
    // `bl.id !== block.id` drop BOTH — this version's own bug, back again.
    for (const bad of ["", 0, null, undefined]) {
      const out = sanitizeBlock(Object.assign({}, base, { id: bad }));
      expect(out.id, "id " + JSON.stringify(bad) + " must be replaced").toBeTruthy();
      expect(typeof out.id).toBe("string");
      expect(out.tableId, "the rest of the block survives the mint").toBe("3");
    }
    // ...and two such blocks are then distinguishable, which is the whole point.
    const a = sanitizeBlock(Object.assign({}, base, { id: "" }));
    const b = sanitizeBlock(Object.assign({}, base, { id: "" }));
    expect(a.id).not.toBe(b.id);
  });

  it("KEEPS an id that is already there, and returns the same object", () => {
    const withId = Object.assign({ id: "keepme" }, base);
    const out = sanitizeBlock(withId);
    expect(out.id).toBe("keepme");
    // Identity, not just equality: a settled node must keep its per-block
    // references across snapshots or every consumer re-renders on every read.
    expect(out).toBe(withId);
  });

  it("is a MINT, not a whitelist — unknown fields survive", () => {
    // `reason` is read by DaySheet and written by nothing; `allDay` is likewise
    // read-only legacy. A sanitize() -shaped whitelist would silently drop them.
    const out = sanitizeBlock(Object.assign({}, base, { reason: "deep clean", allDay: true }));
    expect(out.reason).toBe("deep clean");
    expect(out.allDay).toBe(true);
    expect(out.from).toBe("14:00");
    expect(out.to).toBe("16:00");
    expect(out.tableId).toBe("3");
  });

  it("gives two IDENTICAL blocks two DIFFERENT ids", () => {
    // The whole point. These two agree on every field the old matcher compared.
    const out = sanitizeBlocks([Object.assign({}, base), Object.assign({}, base)]);
    expect(out).toHaveLength(2);
    expect(out[0].id).not.toBe(out[1].id);
  });

  it("removing one duplicate by id leaves exactly one", () => {
    const out = sanitizeBlocks([Object.assign({}, base), Object.assign({}, base)]);
    const next = out.filter((bl) => bl.id !== out[0].id);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(out[1].id);
    // ...and it is still a real block, not a husk.
    expect(next[0].tableId).toBe("3");
    expect(next[0].from).toBe("14:00");
  });

  it("accepts the object shape RTDB returns for non-sequential keys", () => {
    const out = sanitizeBlocks({ a: Object.assign({}, base), b: Object.assign({}, base) });
    expect(out).toHaveLength(2);
    expect(out[0].id).not.toBe(out[1].id);
  });

  it("returns [] for an absent node, matching both read sites", () => {
    expect(sanitizeBlocks(null)).toEqual([]);
    expect(sanitizeBlocks(undefined)).toEqual([]);
    expect(sanitizeBlocks([])).toEqual([]);
  });

  it("drops holes rather than minting ids for them", () => {
    // RTDB arrays are sparse; .filter(Boolean) was in both read sites before.
    expect(sanitizeBlocks([null, Object.assign({}, base), undefined])).toHaveLength(1);
    expect(sanitizeBlock(null)).toBe(null);
    expect(sanitizeBlock("nope")).toBe(null);
  });

  // ── v17.16.4 (CT-2B-06): the mint is deterministic for a LEGACY node ───────
  // A random mint answers "what read was this", not "which block is this", so
  // two reads of one unchanged node disagreed about every id — and removeBlock
  // filters on an id BlockModal captured at open time. A resync in between made
  // Unblock a silent no-op.
  it("gives one unchanged legacy node the SAME ids on every read", () => {
    const node = () => [Object.assign({}, base), Object.assign({}, base, { from: "18:00", to: "19:00" })];
    const first = sanitizeBlocks(node()).map((b) => b.id);
    const second = sanitizeBlocks(node()).map((b) => b.id);
    expect(second).toEqual(first);
  });

  it("survives the round trip that used to no-op: open, resync, unblock", () => {
    const node = () => [Object.assign({}, base), Object.assign({}, base, { from: "18:00", to: "19:00" })];
    const captured = sanitizeBlocks(node())[0];        // BlockModal holds this
    const afterResync = sanitizeBlocks(node());        // a fresh snapshot lands
    const next = afterResync.filter((bl) => bl.id !== captured.id);  // removeBlock
    expect(next).toHaveLength(1);
    expect(next[0].from).toBe("18:00");
  });

  it("keys the seed on CONTENT, not on array position", () => {
    // Position would be stable only while nothing is inserted. If a stale index
    // ever resolved it would resolve to a DIFFERENT block — unblocking the
    // wrong table, which is worse than the no-op it replaces. A content key
    // either finds the same block or finds none.
    const b1 = Object.assign({}, base);
    const b2 = Object.assign({}, base, { tableId: "5A" });
    const before = sanitizeBlocks([b1, b2]);
    const after = sanitizeBlocks([b2, b1]);
    expect(after.find((b) => b.tableId === "3").id).toBe(before.find((b) => b.tableId === "3").id);
    expect(after.find((b) => b.tableId === "5A").id).toBe(before.find((b) => b.tableId === "5A").id);
  });

  it("distinguishes blocks that differ ONLY in reason", () => {
    // `reason` is free staff-entered text and is in the key, which is why the
    // separator is a control character rather than a printable one.
    const out = sanitizeBlocks([
      Object.assign({}, base, { reason: "deep clean" }),
      Object.assign({}, base, { reason: "private party" }),
    ]);
    expect(out[0].id).not.toBe(out[1].id);
  });

  it("never collides with a genId() id, and leaves a real id alone", () => {
    const minted = sanitizeBlocks([Object.assign({}, base)])[0].id;
    expect(minted).toContain("_");          // genId() output contains no "_"
    const real = sanitizeBlocks([Object.assign({ id: "abc123" }, base)])[0];
    expect(real.id).toBe("abc123");
  });

  it("keeps the single-argument mint RANDOM — addBlock has nothing to derive from", () => {
    // App's addBlock calls sanitizeBlock(block) directly on a brand-new block,
    // which has no stored identity. Two new blocks that happen to be identical
    // must still be two blocks.
    expect(sanitizeBlock(Object.assign({}, base)).id)
      .not.toBe(sanitizeBlock(Object.assign({}, base)).id);
  });

  // /code-review: the invariant removeBlock depends on is that every id in ONE
  // result is distinct. A content hash alone does not give it, and both ways it
  // can fail end in the v17.15.3 defect — one id for two blocks, so unblocking
  // either drops BOTH.
  it("never mints an id that COLLIDES with one the node already stores", () => {
    // Reachable once a minted id has been persisted by saveBlocks and a
    // pre-v17.15.3 client later writes an id-less block beside it. The first
    // draft asserted this was impossible because genId() contains no "_" —
    // true of genId() ids, false of a minted one that has since been stored.
    const legacy = Object.assign({}, base);
    const minted = sanitizeBlocks([Object.assign({}, legacy)])[0].id;
    const out = sanitizeBlocks([Object.assign({ id: minted }, base), legacy]);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(minted);
    expect(out[1].id).not.toBe(minted);
  });

  it("gives two blocks whose content HASHES collide two different ids", () => {
    // hash36 is 32-bit, so this is constructed rather than argued: these two
    // reason strings on the same table and window hash identically. With the
    // ordinal counting identical CONTENT keys, both took ordinal 1.
    const A = Object.assign({}, base, { reason: "deep clean 149599" });
    const B = Object.assign({}, base, { reason: "deep clean 312382" });
    const out = sanitizeBlocks([A, B]);
    expect(out).toHaveLength(2);
    expect(out[0].id).not.toBe(out[1].id);
    // ...and removing one leaves the other, which is the property that matters.
    expect(out.filter((bl) => bl.id !== out[0].id)).toHaveLength(1);
  });

  it("keeps every id in one result distinct, mixed node included", () => {
    const out = sanitizeBlocks([
      Object.assign({ id: "real1" }, base),
      Object.assign({}, base),
      Object.assign({}, base),
      Object.assign({}, base, { reason: "deep clean 149599" }),
      Object.assign({}, base, { reason: "deep clean 312382" }),
    ]);
    const ids = out.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stays compatible with getBlockSlots", () => {
    // The consumer that matters: minted blocks must still produce slots.
    const out = sanitizeBlocks([Object.assign({}, base)]);
    const slots = getBlockSlots(out, "2026-08-26");
    expect(slots).toHaveLength(1);
    expect(slots[0].tables).toEqual(["3"]);
  });
});

// ── v17.16.2 · one time axis (CT-2B-01 / CT-2B-02) ───────────────────────────
//
// Every function here used to subtract `toMins(b.time)` — minutes since midnight
// of the BOOKING's date — from `nowMins`, minutes since midnight of TODAY. The
// two agree only while the booking is today's, which is why none of this was
// visible in eight years of daytime use and all of it is wrong after midnight.
//
// These need a past-midnight close (24/25) to be reachable, which Settings
// permits and Me Gustas Tú does not currently use. The hours are set directly
// and MUST be restored — the TURN_BUFFER precedent above, same reason: a leaked
// close would silently change every later test in the file.
describe("v17.16.2 — now and a booking on one axis", () => {
  const YDAY = "2099-06-15";   // = D, the fixture date
  const TMRW = "2099-06-16";   // "today" while yesterday's party is still seated
  const lateClose = { open: 13, close: 25 };  // closes at 01:00

  function withClose25(fn) {
    const week = { 0: lateClose, 1: lateClose, 2: lateClose, 3: lateClose, 4: lateClose, 5: lateClose, 6: lateClose };
    setWeekHours(week);
    try { return fn(); } finally { setWeekHours(DEFAULT_WEEK_HOURS); }
  }

  // A party seated 23:30, an hour into their meal at 00:30 the next day.
  const seated2330 = () => mk({ date: YDAY, time: "23:30", duration: 60, status: "seated", tables: ["7"] });

  describe("liveBarDur", () => {
    it("draws an hour as an hour, not as the 15-minute floor", () => {
      withClose25(() => {
        // 30 = 00:30 on TMRW. Projected onto YDAY that is minute 1470.
        expect(liveBarDur(seated2330(), 30, TMRW)).toBe(60);
        // What it returned before: max(15, 30 − 1410) = 15.
        expect(Math.max(15, 30 - toMins("23:30"))).toBe(15);
      });
    });
    it("is unchanged for a booking on today", () => {
      const b = mk({ date: YDAY, time: "13:00", duration: 90, status: "seated" });
      expect(liveBarDur(b, 840, YDAY)).toBe(60);        // 14:00, one hour in
      expect(liveBarDur(b, 790, YDAY)).toBe(15);        // 13:10 → the floor
    });
    it("returns the stored duration for a booking that is not seated", () => {
      expect(liveBarDur(mk({ date: YDAY, duration: 90 }), 840, YDAY)).toBe(90);
    });
  });

  describe("seatedElapsed — the cap that replaces the old date filter", () => {
    it("caps at the booking's own close instead of rising forever", () => {
      // Three weeks on, a booking left seated reads its day's service once and
      // stops. Uncapped this is 30240 minutes and climbing, and syncLiveDurations
      // would write it to the database as the party's duration.
      const stale = mk({ date: YDAY, time: "13:00", status: "seated" });
      expect(seatedElapsed(stale, "2099-07-06", 600)).toBe(22 * 60 - 13 * 60); // 540
    });
    it("agrees with auto-complete at the boundary rather than stepping", () => {
      // auto-complete freezes duration at closeMins − start; the live figure must
      // arrive at the same number, or the block jumps at closing time.
      const b = mk({ date: YDAY, time: "21:00", status: "seated" });
      const atClose = seatedElapsed(b, YDAY, 22 * 60);
      const afterClose = seatedElapsed(b, YDAY, 23 * 60);
      expect(atClose).toBe(60);
      expect(afterClose).toBe(60);
    });
  });

  describe("occupancyEnd — the table that read FREE while someone sat at it", () => {
    it("holds the table through an overstay that began yesterday", () => {
      withClose25(() => {
        const b = seated2330();               // ends 00:30, i.e. minute 1470
        // At 00:45 the party has overstayed. On the shared axis now is 1485,
        // so the slot must extend past it and read BUSY.
        expect(occupancyEnd(b, 45, TMRW)).toBeGreaterThan(1485);
        // The old reading: e(1470) > nowM(45), so the overstay branch never
        // fired and getBusy saw the table as free for a walk-in.
        expect(1470 > 45).toBe(true);
      });
    });
    it("leaves a future query alone — the guest is expected to have left", () => {
      const b = mk({ date: YDAY, time: "13:00", duration: 90, status: "seated" });
      expect(occupancyEnd(b, 600, YDAY)).toBe(toMins("13:00") + 90); // 10:00, before it starts
    });
  });

  describe("applySeatedShift — CT-2B-01, the one that reached the database", () => {
    it("no longer writes a 24-hour booking", () => {
      withClose25(() => {
        const b = seated2330();
        const r = applySeatedShift(b, 30, [b], TMRW); // seated at 00:30
        // Now IS the scheduled end on the shared axis, so there is nothing to
        // shift. Before: newDuration = 1470 − 30 = 1440.
        expect(r).toBe(null);
      });
    });
    it("refuses a shift it could not represent, rather than moving the booking a day back", () => {
      withClose25(() => {
        // Seated at 00:15 off a 23:30 booking that runs to 01:00. There IS room
        // to shift, but the new start would be minute 1455 of YDAY, and a start
        // is stored as HH:MM against its own date — toTime wraps to "00:15",
        // which on YDAY is 24 hours in the past.
        const b = mk({ date: YDAY, time: "23:30", duration: 90, status: "seated", tables: ["7"] });
        expect(applySeatedShift(b, 15, [b], TMRW)).toBe(null);
      });
    });
    it("still shifts normally within a single day", () => {
      const b = mk({ date: YDAY, time: "13:00", duration: 90, tables: ["7"] });
      const r = applySeatedShift(b, 795, [b], YDAY);
      expect(r.newTime).toBe("13:15");
      expect(r.newDuration).toBe(75);
      expect(r.direction).toBe("late");
    });
    it("refuses a duration the schedule cannot mean (the second line of defence)", () => {
      // The axis fix makes this unreachable; it guards the one point that writes.
      const b = mk({ date: YDAY, time: "13:00", duration: 90, tables: ["7"] });
      expect(applySeatedShift(b, NaN, [b], YDAY)).toBe(null);
    });
  });

  describe("syncLiveDurations / freeingSoon across midnight", () => {
    it("keeps accruing a party seated before midnight", () => {
      withClose25(() => {
        const b = seated2330();
        const out = syncLiveDurations([b], TMRW, 45); // 00:45 — 75 min in
        expect(out[0].duration).toBe(75);
        // Before, the `b.date === today` filter made this a no-op forever.
        expect(syncLiveDurations([b], TMRW, 45)[0].duration).not.toBe(60);
      });
    });
    it("offers a table freeing at 00:45 to the freeing-soon list", () => {
      withClose25(() => {
        const b = mk({ date: YDAY, time: "23:30", duration: 75, status: "seated", tables: ["7"] });
        // 00:35 → 10 minutes before their 00:45 end.
        const out = freeingSoon([b], TMRW, 35, 15);
        expect(out.map((x) => x.inMin)).toEqual([10]);
      });
    });
    it("still ignores a booking whose end is long past", () => {
      expect(freeingSoon([mk({ date: YDAY, time: "13:00", status: "seated" })], "2099-07-06", 600, 15)).toEqual([]);
    });
  });

  describe("pastCloseMins — now public, and the same answers as before", () => {
    it("reports the close once it has passed, and null before", () => {
      expect(pastCloseMins(YDAY, YDAY, 22 * 60)).toBe(1320);
      expect(pastCloseMins(YDAY, YDAY, 21 * 60)).toBe(null);
    });
    it("is null for a future date, whose close cannot have passed", () => {
      expect(pastCloseMins(TMRW, YDAY, 600)).toBe(null);
    });
    it("fires for yesterday once its own close is reached", () => {
      withClose25(() => {
        expect(pastCloseMins(YDAY, TMRW, 30)).toBe(null);   // 00:30, close is 01:00
        expect(pastCloseMins(YDAY, TMRW, 75)).toBe(1500);   // 01:15, passed
      });
    });
  });

  // v17.16.12: every surface that OFFERS "seated" asks this first. The point is
  // that it is EXACTLY the close-time auto-complete's own condition — two
  // conditions that merely agree today are two conditions, and the app offering
  // a status it then takes back is what this version exists to stop.
  describe("seatingClosed", () => {
    it("is the exact negation of pastCloseMins being null", () => {
      // Pinned as an identity, not as a set of remembered answers: the guarantee
      // is that the two can never drift, and only this shape states that.
      for (const [d, t, n] of [
        [YDAY, YDAY, 22 * 60], [YDAY, YDAY, 21 * 60],
        [TMRW, YDAY, 600], [YDAY, TMRW, 30], [YDAY, TMRW, 75],
      ]) {
        expect(seatingClosed(d, t, n)).toBe(pastCloseMins(d, t, n) !== null);
      }
    });
    it("closes seating on a past day and leaves a future one open", () => {
      expect(seatingClosed(YDAY, TMRW, 600)).toBe(true);
      expect(seatingClosed(TMRW, YDAY, 600)).toBe(false);
    });
    it("closes seating TODAY once the day's own close has passed", () => {
      // The restaurant closes at 22:00 in the seed, and the auto-complete fires
      // for today too — so a 22:30 tap on today's booking is just as futile.
      expect(seatingClosed(YDAY, YDAY, 21 * 60 + 59)).toBe(false);
      expect(seatingClosed(YDAY, YDAY, 22 * 60)).toBe(true);
    });
    it("follows a PAST-MIDNIGHT close rather than the date rollover", () => {
      withClose25(() => {
        // Yesterday's service runs to 01:00. At 00:30 it is a new calendar day
        // and seating is still open; at 01:15 it is not.
        expect(seatingClosed(YDAY, TMRW, 30)).toBe(false);
        expect(seatingClosed(YDAY, TMRW, 75)).toBe(true);
      });
    });
  });

  describe("lateMins", () => {
    it("measures against the booking's own midnight", () => {
      withClose25(() => {
        // A 23:45 booking, nobody arrived, now 00:15 the next day → 30 min late.
        expect(lateMins({ date: YDAY, time: "23:45" }, 15, TMRW)).toBe(30);
      });
    });
  });
});

// ── v17.16.2 /code-review — two regressions the axis fix introduced ──────────
//
// Both were found by reviewing the diff rather than by any failing test, and
// both are the same shape: a guard that USED to hold for an incidental reason
// stopped holding once `now` was projected. Worth pinning precisely because the
// old code was safe by accident, so nothing pointed at either.
describe("v17.16.2 /code-review — regressions of the axis fix", () => {
  const D2 = "2099-06-15";
  const YEST = "2099-06-14";
  const LATER = "2099-07-06";

  // Seating a booking dated in the FUTURE projects `now` NEGATIVE. The first
  // guard only bounded the upper end, so every remaining test passed and
  // toTime(-60) wrote "-1:00" as the booking's time.
  it("refuses to shift a booking dated in the future, instead of writing a negative time", () => {
    const b = mk({ date: D2, time: "13:00", duration: 90, tables: ["7"] });
    // now = 23:00 on the day BEFORE the booking
    expect(applySeatedShift(b, 1380, [b], YEST)).toBe(null);
  });
  it("still refuses past the other end of the day", () => {
    const b = mk({ date: YEST, time: "23:30", duration: 90, status: "seated", tables: ["7"] });
    expect(applySeatedShift(b, 15, [b], D2)).toBe(null);
  });
  it("and still shifts normally inside the booking's own day", () => {
    const b = mk({ date: D2, time: "13:00", duration: 90, tables: ["7"] });
    expect(applySeatedShift(b, 795, [b], D2).newTime).toBe("13:15");
  });

  // Dropping `b.date === today` let syncLiveDurations rewrite HISTORICAL
  // records: the cap bounded the value (540 vs a stored 90) but never
  // authorised the write.
  it("leaves a booking left seated on a past day completely alone", () => {
    const stale = mk({ date: D2, time: "13:00", status: "seated", duration: 90, tables: ["7"] });
    const out = syncLiveDurations([stale], LATER, 600);
    expect(out[0]).toBe(stale);            // same reference — no patch child
    expect(out[0].duration).toBe(90);
  });
  it("still grows today's seated booking", () => {
    const b = mk({ date: D2, time: "13:00", status: "seated", duration: 30, tables: ["7"] });
    expect(syncLiveDurations([b], D2, 15 * 60)[0].duration).toBe(120);
  });
  it("draws the stored duration for a stale booking, so the bar and the write agree", () => {
    const stale = mk({ date: D2, time: "13:00", status: "seated", duration: 90 });
    expect(liveBarDur(stale, 600, LATER)).toBe(90);
  });

  describe("seatedIsLive", () => {
    it("is true for today at any hour, because auto-complete owns the gap", () => {
      expect(seatedIsLive(mk({ date: D2 }), D2, 23 * 60)).toBe(true);
    });
    it("is false for a past day whose close has gone", () => {
      expect(seatedIsLive(mk({ date: D2 }), LATER, 600)).toBe(false);
    });
  });
});

// ── v18.0.0 — voucherCode joins the THREE lists a booking field must join ────
//
// The plan calls `UNDO_FIELDS` "the silent one", and it is right: nothing fails
// and no test goes red when a field is missing from it. The defect only appears
// when somebody attaches a voucher and then presses undo. So these tests exist
// specifically to make the silent case loud — each one fails if `voucherCode` is
// removed from its list, and nothing else would.

describe("voucherCode is in all three booking-field lists (v18.0.0)", () => {
  const vb = (o = {}) => Object.assign({
    id: "v1", name: "Pau", phone: "", date: "2026-09-01", time: "20:00",
    size: 2, duration: 90, status: "confirmed", tables: ["3"],
  }, o);

  it("sanitize KEEPS it, and normalises it through the one normaliser", () => {
    // Without the whitelist entry the field does not survive a read at all.
    expect(sanitize({ voucherCode: "abcd-2345" }).voucherCode).toBe("ABCD2345");
    expect(sanitize({ voucherCode: "ABCD2345" }).voucherCode).toBe("ABCD2345");
    // Two spellings of one code must never resolve to two vouchers.
    expect(sanitize({ voucherCode: "abcd 2345" }).voucherCode)
      .toBe(sanitize({ voucherCode: "ABCD-2345" }).voucherCode);
    expect(sanitize({}).voucherCode).toBe("");
    expect(sanitize({ voucherCode: null }).voucherCode).toBe("");
  });

  it("UNDO_FIELDS notices it — attach a voucher, press undo, get the link back", () => {
    // THE silent one. A field absent from UNDO_FIELDS reads as "nothing
    // changed", so undoSnapshots takes NO snapshot and the action is quietly
    // un-undoable. This test is the only thing that would say so.
    const before = sanitize(vb({ voucherCode: "" }));
    const after = sanitize(vb({ voucherCode: "ABCD2345" }));
    const snap = undoSnapshots([before], [after]);
    expect(snap.map((x) => x.id)).toEqual(["v1"]);
    // And the undo actually restores the previous link.
    expect(applyUndo([after], snap).find((b) => b.id === "v1").voucherCode).toBe("");
  });

  it("UNDO_FIELDS notices a voucher being SWAPPED, not only added or cleared", () => {
    const a = sanitize(vb({ voucherCode: "ABCD2345" }));
    const b = sanitize(vb({ voucherCode: "QRST6789" }));
    expect(undoSnapshots([a], [b]).map((x) => x.id)).toEqual(["v1"]);
    // A code that only differs in SPELLING is the same voucher and is not a change.
    const c = sanitize(vb({ voucherCode: "abcd-2345" }));
    expect(undoSnapshots([a], [c])).toEqual([]);
  });

  it("dayBookingsSig sees it too — it shares UNDO_FIELDS' field set", () => {
    const a = sanitize(vb({ voucherCode: "" }));
    const b = sanitize(vb({ voucherCode: "ABCD2345" }));
    expect(dayBookingsSig([a], a.date)).not.toBe(dayBookingsSig([b], b.date));
  });

  it("diffBooking says what happened, instead of 'saved (no field changes)'", () => {
    const orig = sanitize(vb({ voucherCode: "" }));
    expect(diffBooking(orig, { ...orig, voucherCode: "ABCD2345" }, 2))
      .toMatch(/voucher none→ABCD-2345/);
    expect(diffBooking(sanitize(vb({ voucherCode: "ABCD2345" })),
      { ...vb(), voucherCode: "" }, 2)).toMatch(/voucher ABCD-2345→none/);
    // A re-spelling is not a change and must not appear in the history entry.
    const same = sanitize(vb({ voucherCode: "ABCD2345" }));
    expect(diffBooking(same, { ...same, voucherCode: "abcd-2345" }, 2))
      .toBe("saved (no field changes)");
  });
});

// ── The FIVE places a booking field has to appear, not three ────────────────
//
// v18.0.0, and this one was found by RUNNING the app, not by reading it. The
// three lists above (`sanitize`, `UNDO_FIELDS`, `diffBooking`) are what makes a
// field survive a read, an undo and a history entry — and none of them makes it
// get WRITTEN. `doSaveNew` and `doSaveEdit` build the booking object field by
// field, and `openEdit` builds the form draft the same way, so a field missing
// from those three never reaches storage at all.
//
// Live symptom: the voucher attached in the form, the booking saved, and the
// completion produced no redeem prompt — because the stored booking had no
// `voucherCode`. The `openEdit` one is worse and would have shipped silently:
// without it, opening and re-saving any booking WIPES its voucher, which is the
// `UNDO_FIELDS` failure mode one layer up.
//
// `deposit` is in all five, which is what makes them findable — so this scans
// App.jsx for `deposit` and requires `voucherCode` in the same expression. A
// grep, like the `isReadableBlock` consumer sweep, because nothing else in the
// repo can see this class: there are no component tests, and every unit test
// above passes with all three sites missing.
describe("a booking field reaches STORAGE, not just a read (v18.0.0)", () => {
  const APP = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

  // Each entry is a fragment unique to one site, so a failure names WHICH.
  const SITES = [
    ["openEdit — seeds the form draft", /deposit:b\.deposit\?String\(b\.deposit\):""[^\n]*?voucherCode:/],
    ["doSaveEdit — writes the edit", /Object\.assign\(\{\},b,\{name:f\.name[\s\S]{0,400}?voucherCode:/],
    ["doSaveNew — writes the create", /const nb=\{id:newId[\s\S]{0,400}?voucherCode:/],
  ];

  SITES.forEach(([name, re]) => {
    it(name + " carries voucherCode", () => {
      expect(re.test(APP)).toBe(true);
    });
  });

  it("every `deposit:` in a booking-shaped literal has a voucherCode beside it", () => {
    // The general form of the rule, so the NEXT field added is caught too.
    // A booking literal is one that sets `deposit:` and `status:` together.
    const lines = APP.split("\n");
    const offenders = lines
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /deposit:/.test(l) && /status:/.test(l) && !/voucherCode:/.test(l))
      .map(({ n }) => n);
    expect(offenders).toEqual([]);
  });
});

describe("plannedDuration — the length a booking was BOOKED for (v18.0.0 session 7)", () => {
  // Book Again's source. The seated shift is driven for REAL below rather than
  // hand-copied into a fixture, so these fail if the shift ever stops pinning
  // the scheduled end — the one property the recovery depends on — and not
  // only when the helper itself changes.
  it("a booking never seated keeps its stored length", () => {
    expect(plannedDuration(mk({ time: "20:30", scheduledTime: "20:30", duration: 150, originalDuration: 150 }))).toBe(150);
  });

  it("seated EARLY through the real applySeatedShift: the plan comes back, not the shifted length", () => {
    const b = mk({ time: "20:30", scheduledTime: "20:30", duration: 150, originalDuration: 150 });
    const shift = applySeatedShift(b, toMins("20:15"), [b], D);
    expect(shift).toMatchObject({ newTime: "20:15", newDuration: 165 });
    const seated = Object.assign({}, b, { status: "seated", time: shift.newTime, duration: shift.newDuration, originalDuration: shift.newDuration });
    expect(plannedDuration(seated)).toBe(150);
  });

  it("seated LATE through the real shift: the same recovery the other way", () => {
    const b = mk({ time: "20:30", scheduledTime: "20:30", duration: 150, originalDuration: 150 });
    const shift = applySeatedShift(b, toMins("20:50"), [b], D);
    expect(shift).toMatchObject({ newTime: "20:50", newDuration: 130 });
    const seated = Object.assign({}, b, { status: "seated", time: shift.newTime, duration: shift.newDuration, originalDuration: shift.newDuration });
    expect(plannedDuration(seated)).toBe(150);
  });

  it("completion and an overstay rewrite `duration`, never the plan", () => {
    // Completed after an early seat: `duration` truncated to the 130-minute stay.
    expect(plannedDuration(mk({ status: "completed", time: "20:15", scheduledTime: "20:30", duration: 130, customDur: 130, stayedMin: 130, originalDuration: 165 }))).toBe(150);
    // Still seated and overstaying: `duration` grown live by syncLiveDurations.
    expect(plannedDuration(mk({ status: "seated", time: "20:30", scheduledTime: "20:30", duration: 200, customDur: 200, originalDuration: 150 }))).toBe(150);
  });

  it("a legacy row with no originalDuration or scheduledTime falls back to what it has", () => {
    expect(plannedDuration({ time: "13:00", duration: 120 })).toBe(120);
  });

  it("never invents a length — an unreadable time, or an end not after the start, keeps the stored one", () => {
    expect(plannedDuration({ time: "8 in the evening", scheduledTime: "20:30", duration: 90, originalDuration: 90 })).toBe(90);
    expect(plannedDuration({ time: "13:00", scheduledTime: "20:30", duration: 60, originalDuration: 60 })).toBe(60);
  });

  it("is null only when there is no length at all", () => {
    expect(plannedDuration(null)).toBe(null);
    expect(plannedDuration({ time: "13:00" })).toBe(null);
    expect(plannedDuration({ time: "13:00", duration: 0, originalDuration: 0 })).toBe(null);
  });
});

describe("seatNoteFor — what the seat note shows (v18.0.0 session 7)", () => {
  // One predicate for both doors a booking is seated through, so this is where
  // "when does the popover open" is decided — and the only place it can be pinned.
  it("a move INTO seated with a note returns a snapshot of the booking as it will stand", () => {
    const b = mk({ id: "s1", name: "Maria López", size: 4, time: "20:15", scheduledTime: "20:30", tables: ["5A"], notes: "  Birthday — cake with dessert.\nNut allergy.  " });
    expect(seatNoteFor("confirmed", "seated", b)).toEqual({
      id: "s1", name: "Maria López", size: 4, time: "20:30", tables: ["5A"],
      notes: "Birthday — cake with dessert.\nNut allergy.",
    });
  });

  it("the time is the BOOKED time — the seated shift has just moved `time` to now", () => {
    expect(seatNoteFor("confirmed", "seated", mk({ time: "20:15", scheduledTime: "20:30", notes: "x" })).time).toBe("20:30");
    // A legacy row with no scheduledTime still names a time.
    expect(seatNoteFor("confirmed", "seated", { id: "l", time: "13:00", size: 2, notes: "x" }).time).toBe("13:00");
  });

  it("is null for anything that is not a seat", () => {
    const b = mk({ notes: "Nut allergy" });
    expect(seatNoteFor("seated", "seated", b), "re-saving a party already seated").toBe(null);
    expect(seatNoteFor("confirmed", "completed", b)).toBe(null);
    expect(seatNoteFor("seated", "confirmed", b)).toBe(null);
    expect(seatNoteFor("confirmed", "cancelled", b)).toBe(null);
  });

  it("is null when there is nothing to read", () => {
    expect(seatNoteFor("confirmed", "seated", mk({ notes: "" }))).toBe(null);
    expect(seatNoteFor("confirmed", "seated", mk({ notes: "   \n " }))).toBe(null);
    expect(seatNoteFor("confirmed", "seated", mk({ notes: undefined }))).toBe(null);
    expect(seatNoteFor("confirmed", "seated", null), "a booking gone from the list").toBe(null);
  });

  it("the snapshot is a copy — mutating the booking afterwards cannot change what is on screen", () => {
    const b = mk({ tables: ["1A", "1B"], notes: "Wheelchair" });
    const snap = seatNoteFor("confirmed", "seated", b);
    b.tables.push("2");
    expect(snap.tables).toEqual(["1A", "1B"]);
  });
});

// ── v18.0.0 session 8 (item 3) — a booking SAVED as seated keeps its tables ──
describe("tablesPinned", () => {
  it("pins the three statuses whose tables are a fact, not a proposal", () => {
    expect(tablesPinned("seated", false, false), "the party is at them").toBe(true);
    expect(tablesPinned("completed", false, false), "v17.15.5 — a record").toBe(true);
    expect(tablesPinned("cancelled", false, false)).toBe(true);
    expect(tablesPinned("confirmed", false, false)).toBe(false);
    expect(tablesPinned("pending", false, false)).toBe(false);
  });

  it("an explicit manual assignment or an explicit clear still wins", () => {
    expect(tablesPinned("seated", true, false), "somebody chose tables").toBe(false);
    expect(tablesPinned("seated", false, true), "somebody cleared them").toBe(false);
    expect(tablesPinned("completed", true, false)).toBe(false);
  });
});

describe("seatedFitRefusal", () => {
  it("refuses a party that no longer fits the table it is sitting at", () => {
    // Table 3 is one of the eight outdoor 2-tops in the MGT seed.
    expect(seatedFitRefusal(5, ["3"])).toContain("Party of 5 doesn't fit table 3 (seats 2)");
    expect(seatedFitRefusal(5, ["3"])).toContain("Assign tables that seat 5.");
  });

  it("says nothing when the party fits", () => {
    expect(seatedFitRefusal(2, ["3"])).toBe(null);
    expect(seatedFitRefusal(1, ["3"])).toBe(null);
  });

  it("pluralises the tables it names", () => {
    expect(seatedFitRefusal(99, ["1A", "1B"])).toContain("tables 1A+1B");
    expect(seatedFitRefusal(99, ["3"])).toContain("table 3");
  });

  it("is silent with no tables at all — that is a different refusal", () => {
    expect(seatedFitRefusal(4, [])).toBe(null);
    expect(seatedFitRefusal(4, null)).toBe(null);
    expect(seatedFitRefusal(4, undefined)).toBe(null);
  });
});

describe("seatRefusal", () => {
  it("refuses to seat a booking that has no table", () => {
    expect(seatRefusal(mk({ tables: [] }))).toBe("Assign a table before seating this booking.");
    expect(seatRefusal(mk({ tables: undefined }))).toBe("Assign a table before seating this booking.");
  });

  it("says nothing when there is a table to sit at", () => {
    expect(seatRefusal(mk({ tables: ["3"] }))).toBe(null);
    expect(seatRefusal(mk({ tables: ["1A", "1B"] }))).toBe(null);
  });

  it("survives a booking gone from the list", () => {
    expect(seatRefusal(null)).toBe(null);
    expect(seatRefusal(undefined)).toBe(null);
  });
});

// ── v18.0.0 session 8 (C7) — the last start is before closing ───────────────
describe("lastStartMins", () => {
  it("is a quarter of an hour before close", () => {
    expect(lastStartMins(22)).toBe(21 * 60 + 45);
    expect(lastStartMins(23)).toBe(22 * 60 + 45);
    expect(lastStartMins(13)).toBe(12 * 60 + 45);
  });

  it("never lets a booking start after midnight, whatever the close", () => {
    // 24 and 25 are legal closes — an EXTEND window, not a booking window.
    expect(lastStartMins(24)).toBe(23 * 60 + 45);
    expect(lastStartMins(25)).toBe(23 * 60 + 45);
  });
});

// ── v18.0.0 session 8 (C8) — the toast claims only what the action did ──────
describe("savedToast", () => {
  it("never claims a reshuffle for an action that suppressed the optimiser", () => {
    expect(savedToast("saved", true), "a seat, on a day with the optimiser on").toBe("Booking saved.");
    expect(savedToast("saved", false)).toBe("Booking saved.");
  });

  it("keeps the old derivation for every other action", () => {
    expect(savedToast(true, true)).toBe("Tables re-optimised.");
    expect(savedToast(true, false)).toBe("Booking saved.");
  });
});

// ── v18.0.0 session 8 (R6) — the kitchen asks about kitchen things ──────────
describe("kitchenRelevant", () => {
  const orig = mk({ time: "20:00", date: D, size: 2, duration: 90, originalDuration: 90 });
  const same = { date: D, time: "20:00", customDur: null, status: "confirmed" };

  it("always asks about a new booking", () => {
    expect(kitchenRelevant(null, same, 2)).toBe(true);
  });

  it("does NOT ask when nothing the kitchen sees has moved", () => {
    expect(kitchenRelevant(orig, same, 2), "a notes-only edit").toBe(false);
    expect(kitchenRelevant(orig, { ...same, status: "seated" }, 2), "seating adds no start").toBe(false);
  });

  it("asks about when, for how many, and for how long", () => {
    expect(kitchenRelevant(orig, { ...same, time: "20:15" }, 2)).toBe(true);
    expect(kitchenRelevant(orig, { ...same, date: "2099-06-16" }, 2)).toBe(true);
    expect(kitchenRelevant(orig, same, 4), "a bigger party").toBe(true);
    expect(kitchenRelevant(orig, { ...same, customDur: 120 }, 2), "a longer sitting").toBe(true);
  });

  it("asks again when a booking comes back from cancelled or completed", () => {
    const off = mk({ ...orig, status: "cancelled" });
    const done = mk({ ...orig, status: "completed" });
    expect(kitchenRelevant(off, same, 2)).toBe(true);
    expect(kitchenRelevant(done, same, 2)).toBe(true);
  });

  it("does not ask when a booking is LEAVING the count", () => {
    expect(kitchenRelevant(orig, { ...same, status: "cancelled" }, 2)).toBe(false);
    expect(kitchenRelevant(orig, { ...same, status: "completed" }, 2)).toBe(false);
  });

  it("a size change that re-derives the default length still asks once", () => {
    // size 5 moves the default length 90 → 120; both terms fire, and the answer
    // is one prompt either way.
    expect(kitchenRelevant(orig, same, 5)).toBe(true);
  });
});

// ── v18.0.0 session 8 (R5) — history stops recording a phone nobody typed ───
describe("enteredPhone", () => {
  it("treats empty, a bare + and the untouched prefix as no phone", () => {
    expect(enteredPhone("", "+34")).toBe("");
    expect(enteredPhone("+", "+34")).toBe("");
    expect(enteredPhone("+34", "+34"), "the seed, untouched").toBe("");
    expect(enteredPhone("  +34  ", "+34")).toBe("");
    expect(enteredPhone(null, "+34")).toBe("");
    expect(enteredPhone(undefined, "+34")).toBe("");
  });

  it("keeps a number somebody actually typed", () => {
    expect(enteredPhone("+34600111222", "+34")).toBe("+34600111222");
    expect(enteredPhone(" 600111222 ", "+34")).toBe("600111222");
    expect(enteredPhone("+345", "+34"), "a prefix plus one digit is a number").toBe("+345");
  });
});

describe("diffBooking and the phone that never changed (R5)", () => {
  // The form as `openEdit` builds it for a booking with no phone: the prefix is
  // seeded into the field, and nothing else is touched.
  function untouchedForm(orig, phone) {
    return {
      name: orig.name, size: orig.size, time: orig.time, date: orig.date,
      preference: orig.preference, phone: phone, customDur: null,
      status: orig.status, notes: "", deposit: "", voucherCode: "",
      manualTables: [], preferredTables: [],
    };
  }

  it("records nothing when the only 'change' is the seeded prefix", () => {
    const orig = mk({ phone: "" });
    expect(diffBooking(orig, untouchedForm(orig, "+34"), orig.size, "+34"))
      .toBe("saved (no field changes)");
  });

  it("records nothing for a bare + either", () => {
    const orig = mk({ phone: "" });
    expect(diffBooking(orig, untouchedForm(orig, "+"), orig.size, "+34"))
      .toBe("saved (no field changes)");
  });

  it("still records a phone that really was added", () => {
    const orig = mk({ phone: "" });
    expect(diffBooking(orig, untouchedForm(orig, "+34600111222"), orig.size, "+34"))
      .toContain("phone none→+34600111222");
  });

  it("still records one that was removed", () => {
    const orig = mk({ phone: "+34600111222" });
    expect(diffBooking(orig, untouchedForm(orig, "+34"), orig.size, "+34"))
      .toContain("phone +34600111222→none");
  });
});

// ── v18.0.0 session 8 (C) — a window change re-checks the placement ─────────
describe("tablesFreeFor", () => {
  const busy = mk({ id: "sitting", time: "13:00", duration: 90, tables: ["3"] });
  const from = 13 * 60, to = 13 * 60 + 90;

  it("says no when another booking holds the table in that window", () => {
    expect(tablesFreeFor([busy], D, "other", ["3"], from, to, [])).toBe(false);
  });

  it("excludes the booking being saved from its own busy set", () => {
    expect(tablesFreeFor([busy], D, "sitting", ["3"], from, to, [])).toBe(true);
  });

  it("says yes outside that booking's window", () => {
    expect(tablesFreeFor([busy], D, "other", ["3"], 15 * 60, 15 * 60 + 90, [])).toBe(true);
  });

  it("a finished visit frees the table — the same rule every other busy-set uses", () => {
    const done = mk({ id: "done", time: "13:00", duration: 90, tables: ["3"], status: "completed" });
    const gone = mk({ id: "gone", time: "13:00", duration: 90, tables: ["3"], status: "cancelled" });
    expect(tablesFreeFor([done], D, "other", ["3"], from, to, [])).toBe(true);
    expect(tablesFreeFor([gone], D, "other", ["3"], from, to, [])).toBe(true);
  });

  it("another day does not stand in the way", () => {
    expect(tablesFreeFor([busy], "2099-06-16", "other", ["3"], from, to, [])).toBe(true);
  });

  it("no tables is not free", () => {
    expect(tablesFreeFor([busy], D, "other", [], from, to, [])).toBe(false);
    expect(tablesFreeFor([busy], D, "other", null, from, to, [])).toBe(false);
  });
});

describe("trialFits displacement check (C5)", () => {
  // Two tables that join into one 4-top, so a party of 4 can only be seated by
  // taking BOTH — which is the smallest arrangement where "it fits" and "it
  // fits without throwing somebody out" are different answers.
  afterEach(() => setLayout(DEFAULT_LAYOUT));
  function twoTables() {
    setLayout(Object.assign({}, DEFAULT_LAYOUT, {
      tables: [{ id: "A", capacity: 2, zone: "outdoor" }, { id: "B", capacity: 2, zone: "outdoor" }],
      joinGroups: [["A", "B"]],
      comboCaps: {},
      megaCombos: [],
      priorities: { v: 1 },      // present-but-empty → the generic capacity path
    }));
  }

  it("refuses an EDIT that would leave another booking with no table", () => {
    twoTables();
    const day = [
      mk({ id: "x", time: "13:00", duration: 90, size: 2, tables: ["A"] }),
      mk({ id: "y", time: "13:00", duration: 90, size: 2, tables: ["B"] }),
    ];
    // Growing x to 4 needs A+B, which leaves y with nowhere to go.
    expect(trialFits(day, D, "13:00", 4, "auto", 90, [], "x", null, false)).toBe(null);
  });

  it("still fits the same edit when there is nobody to displace", () => {
    twoTables();
    const day = [mk({ id: "x", time: "13:00", duration: 90, size: 2, tables: ["A"] })];
    expect(trialFits(day, D, "13:00", 4, "auto", 90, [], "x", null, false)).toEqual(["A", "B"]);
  });
});

// ── v18.0.0 session 8 (item 5b) — the ROADMAP entry, replayed ───────────────
describe("seatedShiftFor", () => {
  // R2's own numbers, measured live 2026-09-11: a 16:15 booking for 90, one
  // save setting Seated AND 120 minutes, at 15:56.
  const r2 = () => mk({ date: today, time: "16:15", duration: 90, originalDuration: 90, tables: ["2"] });
  const at = 15 * 60 + 56;

  it("pins the end from the length being SAVED, not the one stored", () => {
    const b = r2();
    const fixed = seatedShiftFor(b, at, [b], today, 120);
    expect(fixed.newDuration, "15:56 → an 18:15 end").toBe(139);
    expect(fixed.newTime).toBe("15:56");
    expect(fixed.direction).toBe("early");
  });

  it("reproduces the defect when the length is NOT being changed", () => {
    const b = r2();
    // 0 means "no new length" — the stored 90 pins a 17:45 end, which is the
    // 109 that was actually written to the database.
    expect(seatedShiftFor(b, at, [b], today, 0).newDuration).toBe(109);
    expect(seatedShiftFor(b, at, [b], today).newDuration, "and with no argument at all").toBe(109);
  });

  it("agrees with applySeatedShift whenever the length has not moved", () => {
    const b = r2();
    expect(seatedShiftFor(b, at, [b], today, 90)).toEqual(applySeatedShift(b, at, [b], today));
  });

  it("ignores a length that is not a length", () => {
    const b = r2();
    const stored = applySeatedShift(b, at, [b], today);
    expect(seatedShiftFor(b, at, [b], today, "many")).toEqual(stored);
    expect(seatedShiftFor(b, at, [b], today, -30)).toEqual(stored);
    expect(seatedShiftFor(b, at, [b], today, null)).toEqual(stored);
  });

  it("keeps every refusal applySeatedShift makes", () => {
    const b = r2();
    expect(seatedShiftFor(null, at, [b], today, 120)).toBe(null);
    expect(seatedShiftFor(b, 20 * 60, [b], today, 120), "seated past its own end").toBe(null);
  });
});

describe("seatClashParties", () => {
  const room = [
    mk({ id: "sitting", name: "López", status: "seated", time: "19:02", tables: ["3"] }),
    mk({ id: "later", name: "Pau", time: "21:00", tables: ["3"] }),
    mk({ id: "elsewhere", name: "Rita", status: "seated", time: "19:30", tables: ["4"] }),
  ];

  it("names the party still at the table", () => {
    const out = seatClashParties(["3"], D, "arriving", room);
    expect(out.length).toBe(1);
    expect(out[0].booking.name).toBe("López");
    expect(out[0].tables).toEqual(["3"]);
  });

  it("ignores a booking that is not SEATED — that is the optimiser's problem", () => {
    const out = seatClashParties(["3"], D, "arriving", room);
    expect(out.map((e) => e.booking.id)).not.toContain("later");
  });

  it("ignores a seated party at a different table, date, or the booking itself", () => {
    expect(seatClashParties(["4"], D, "elsewhere", room), "itself").toEqual([]);
    expect(seatClashParties(["5A"], D, "arriving", room), "another table").toEqual([]);
    expect(seatClashParties(["3"], "2099-06-16", "arriving", room), "another day").toEqual([]);
  });

  it("reports only the tables actually shared", () => {
    const out = seatClashParties(["3", "4"], D, "arriving", room);
    expect(out.map((e) => e.booking.name).sort()).toEqual(["López", "Rita"]);
    expect(out.find((e) => e.booking.name === "Rita").tables).toEqual(["4"]);
  });

  it("has nothing to say with no tables", () => {
    expect(seatClashParties([], D, "arriving", room)).toEqual([]);
    expect(seatClashParties(null, D, "arriving", room)).toEqual([]);
    expect(seatClashParties(["3"], D, "arriving", null)).toEqual([]);
  });
});

describe("completedSeatedPatch", () => {
  it("is the seated→completed arithmetic, from one place", () => {
    const b = mk({ date: today, time: "13:00", status: "seated", duration: 90 });
    const patch = completedSeatedPatch(b, today, 13 * 60 + 47);
    expect(patch).toEqual({ status: "completed", duration: 47, customDur: 47, stayedMin: 47 });
  });

  it("keeps the 15-minute floor a party that just sat down would otherwise break", () => {
    const b = mk({ date: today, time: "13:00", status: "seated", duration: 90 });
    expect(completedSeatedPatch(b, today, 13 * 60 + 2).duration).toBe(15);
  });
});

describe("pinnedClashParties / pinnedClashRefusal", () => {
  // One seated party pinned to table 3; a confirmed booking that can be moved
  // off it, and a walk-in that cannot.
  function day() {
    return [
      mk({ id: "seat", name: "Ana", status: "seated", time: "13:00", tables: ["3"] }),
      mk({ id: "move", name: "Pau", time: "13:30", tables: ["3"] }),
      mk({ id: "lock", name: "López", time: "14:00", tables: ["3"], _locked: true }),
    ];
  }

  it("splits the clashing parties by whether they can be moved", () => {
    const out = pinnedClashParties(day(), D, "seat");
    expect(out.movable.map((e) => e.booking.id)).toEqual(["move"]);
    expect(out.locked.map((e) => e.booking.id)).toEqual(["lock"]);
    expect(out.movable[0].tables, "the shared table, for the wording").toEqual(["3"]);
  });

  it("ignores a clash the pinned booking is not part of", () => {
    const out = pinnedClashParties(day(), D, "move");
    expect(out.locked.map((e) => e.booking.id).sort()).toEqual(["lock", "seat"]);
    expect(out.movable).toEqual([]);
  });

  it("is empty when nothing overlaps", () => {
    const clean = [
      mk({ id: "seat", status: "seated", time: "13:00", tables: ["3"] }),
      mk({ id: "other", time: "13:30", tables: ["4"] }),
    ];
    const out = pinnedClashParties(clean, D, "seat");
    expect(out.locked).toEqual([]);
    expect(out.movable).toEqual([]);
  });

  it("names the table, the party and why it cannot be asked to move", () => {
    const out = pinnedClashParties(day(), D, "seat");
    const msg = pinnedClashRefusal(out.locked[0]);
    expect(msg).toContain("Table 3 is also held by López at 14:00");
    expect(msg).toContain("locked to it");
    expect(pinnedClashRefusal({ booking: mk({ name: "Ana", status: "seated", time: "13:00" }), tables: ["3"] }))
      .toContain("who is seated");
  });

  it("does not write a sentence with no table in it", () => {
    // findClashes returns an EMPTY intersection when two bookings need the same
    // physical join without sharing an id — reachable in a custom layout.
    const msg = pinnedClashRefusal({ booking: mk({ name: "Pau", time: "13:30" }), tables: [] });
    expect(msg).toContain("Those tables are also held by Pau");
    expect(msg).not.toContain("Table  is");
  });

  it("survives a booking that is no longer in the list", () => {
    expect(pinnedClashRefusal(null)).toBe(null);
    expect(pinnedClashRefusal({ tables: ["3"] })).toBe(null);
  });
});

describe("replacePinnedClashes", () => {
  it("moves the other booking and leaves the seated party where it is sitting", () => {
    const list = [
      mk({ id: "seat", name: "Ana", status: "seated", time: "13:00", tables: ["3"] }),
      mk({ id: "move", name: "Pau", time: "13:30", tables: ["3"] }),
    ];
    const out = replacePinnedClashes(list, D, "seat", [], true);
    expect(out.find((b) => b.id === "seat").tables, "the party did not move").toEqual(["3"]);
    const moved = out.find((b) => b.id === "move").tables;
    expect(moved.length).toBeGreaterThan(0);
    expect(moved).not.toEqual(["3"]);
    expect(findConflicts(out, D), "and the day is clean").toEqual([]);
  });

  it("does the same with the optimiser OFF, which is where the clash used to survive", () => {
    // Today + autoOptimizer false is the only combination that takes the
    // optimiser-OFF branch, which keeps EVERY booking's tables — so before this
    // the clash was saved and the reconciler moved somebody afterwards.
    const list = [
      mk({ id: "seat", date: today, name: "Ana", status: "seated", time: "13:00", tables: ["3"] }),
      mk({ id: "move", date: today, name: "Pau", time: "13:30", tables: ["3"] }),
    ];
    const out = replacePinnedClashes(list, today, "seat", [], false);
    expect(out.find((b) => b.id === "seat").tables).toEqual(["3"]);
    expect(out.find((b) => b.id === "move").tables).not.toEqual(["3"]);
  });

  it("returns its INPUT when there is nothing to move (the identity contract)", () => {
    const clean = [
      mk({ id: "seat", status: "seated", time: "13:00", tables: ["3"] }),
      mk({ id: "other", time: "13:30", tables: ["4"] }),
    ];
    expect(replacePinnedClashes(clean, D, "seat", [], true)).toBe(clean);
  });

  it("gives up rather than looping when the only clash is with a locked party", () => {
    const stuck = [
      mk({ id: "seat", status: "seated", time: "13:00", tables: ["3"] }),
      mk({ id: "lock", time: "13:30", tables: ["3"], _locked: true }),
    ];
    const out = replacePinnedClashes(stuck, D, "seat", [], false);
    expect(out.find((b) => b.id === "lock").tables, "left for the refusal to name").toEqual(["3"]);
  });
});

// ── v18.0.0 session 8 (C1) — leaving seated puts the booked plan back ────────
describe("unseatRestore", () => {
  it("undoes the seated shift exactly — the booked start and the booked length", () => {
    // 20:30 for 150 min, seated at 20:15: applySeatedShift pinned the 23:00 end
    // and stored 20:15 for 165.
    const b = mk({ scheduledTime: "20:30", time: "20:15", duration: 165, originalDuration: 165 });
    expect(unseatRestore(b, 2)).toEqual({ time: "20:30", duration: 150, originalDuration: 150, customDur: 150 });
  });

  it("follows openEdit's rule for customDur — a default length is not a custom one", () => {
    // Restores to 90, which IS the size-2 default.
    const b = mk({ scheduledTime: "20:30", time: "20:15", duration: 105, originalDuration: 105 });
    expect(unseatRestore(b, 2).customDur, "90 is getDur(2)").toBe(null);
    expect(unseatRestore(b, 2).duration).toBe(90);
  });

  it("reads the size the save is writing, not the size that was stored", () => {
    // Restores to 120 — custom for a party of 2, the default for a party of 5.
    const b = mk({ size: 2, scheduledTime: "20:30", time: "20:00", duration: 150, originalDuration: 150 });
    expect(unseatRestore(b, 2).customDur).toBe(120);
    expect(unseatRestore(b, 5).customDur, "120 is getDur(5)").toBe(null);
  });

  it("is null when there is nothing to put back", () => {
    expect(unseatRestore(mk({ scheduledTime: "20:30", time: "20:30", duration: 90, originalDuration: 90 })),
      "never shifted").toBe(null);
    expect(unseatRestore(mk({ scheduledTime: "", time: "20:15", duration: 165 })),
      "pre-v14, no scheduledTime").toBe(null);
    expect(unseatRestore(mk({ scheduledTime: "20:30", time: "8 in the evening", duration: 165 })),
      "an unreadable time is not arithmetic").toBe(null);
    expect(unseatRestore(mk({ scheduledTime: "20:30", time: "20:15", duration: 0, originalDuration: 0 })),
      "no recoverable length").toBe(null);
    expect(unseatRestore(null)).toBe(null);
  });

  it("restores an EARLY seat too, where the shift made the booking longer", () => {
    // 20:30 for 90, seated at 20:00 → stored 20:00 for 120.
    const b = mk({ scheduledTime: "20:30", time: "20:00", duration: 120, originalDuration: 120 });
    const r = unseatRestore(b, 2);
    expect(r.time).toBe("20:30");
    expect(r.duration).toBe(90);
  });
});
