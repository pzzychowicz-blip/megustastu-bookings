// tests/reconcile.test.js — v17.14.0
//
// The post-sync reconciliation decision, testable at last. Until this version it
// lived in a useEffect in App.jsx, and the only part of it any test could reach
// was the pure `dayBookingsSig` compare v17.10.2 added to stop it spinning.
//
// The property every case here is really about: **a pass that changes nothing
// must return the reference it was given.** That is what lets React bail out,
// and its absence is what made an unresolvable clash burn the tablet's CPU while
// the app looked and behaved perfectly.
import { describe, it, expect } from "vitest";
import { dirtyDates, reconcile, improvesDay } from "../src/lib/reconcile.js";
import { verifyClean, findConflicts } from "../src/lib/booking-logic.js";
import { todayStr, addDays } from "../src/lib/day.js";

// `dirtyDates` only looks at dates >= today, so D has to BE a future date
// rather than have been one when this file was written. It was the literal
// "2026-09-01", which reached its own expiry on 2026-09-02 and turned the whole
// suite red on main — a test that passes for a while and then fails for a
// reason having nothing to do with the code it guards. Derived from `today`
// through the same `addDays` the app navigates dates with, so it cannot expire
// and cannot drift onto the DST day a hand-rolled `setDate` would (v17.16.2).
const today = todayStr();
const D = addDays(today, 30);

const mk = (o) => Object.assign({
  id: "x", name: "Guest", phone: "", date: D, time: "20:00", size: 2,
  duration: 90, preference: "auto", notes: "", status: "confirmed",
  tables: [], history: [], _conflict: false,
}, o);

// Two _locked bookings overlapping on ONE table: unresolvable by any reshuffle,
// because applyOpt copies a locked booking's tables through verbatim. Reachable
// by ordinary use — every walk-in and every drag-drop path sets _locked.
const stuck = () => [
  mk({ id: "p", time: "20:00", tables: ["3"], _locked: true, _manual: true }),
  mk({ id: "r", time: "20:30", tables: ["3"], _locked: true, _manual: true }),
];

describe("dirtyDates", () => {
  it("finds a date whose bookings clash", () => {
    expect(dirtyDates(stuck(), today)).toEqual([D]);
  });

  it("returns nothing for a clean day", () => {
    const clean = [mk({ id: "p", tables: ["3"] }), mk({ id: "r", tables: ["4"] })];
    expect(dirtyDates(clean, today)).toEqual([]);
  });

  it("ignores past dates and table-less bookings", () => {
    const past = stuck().map((b) => ({ ...b, date: "2020-01-01" }));
    expect(dirtyDates(past, today)).toEqual([]);
    const unassigned = stuck().map((b) => ({ ...b, tables: [] }));
    expect(dirtyDates(unassigned, today)).toEqual([]);
  });
});

describe("reconcile — the optimiser branch", () => {
  it("resolves a clash the optimiser CAN fix", () => {
    const prev = [
      mk({ id: "p", time: "20:00", tables: ["3"], _locked: true, _manual: true }),
      mk({ id: "r", time: "20:30", tables: ["3"] }),   // movable
    ];
    const { next, changed } = reconcile(prev, [D], [], true);
    expect(changed).toBe(true);
    expect(next).not.toBe(prev);
    expect(verifyClean(next, D)).toBe(true);
  });

  it("an UNRESOLVABLE clash returns the SAME reference and reports no change", () => {
    // The infinite-loop case. Both bookings are locked, so no reshuffle can
    // separate them; the honest answer is "I changed nothing", and returning a
    // fresh array instead is what made React re-run the effect forever.
    const prev = stuck();
    const { next, changed } = reconcile(prev, [D], [], true);
    expect(next).toBe(prev);
    expect(changed).toBe(false);
    expect(verifyClean(next, D)).toBe(false);   // still dirty, honestly so
  });

  it("is idempotent — reconciling its own output changes nothing further", () => {
    const prev = [
      mk({ id: "p", time: "20:00", tables: ["3"], _locked: true, _manual: true }),
      mk({ id: "r", time: "20:30", tables: ["3"] }),
    ];
    const once = reconcile(prev, [D], [], true).next;
    const twice = reconcile(once, dirtyDates(once, today), [], true);
    expect(twice.next).toBe(once);
    expect(twice.changed).toBe(false);
  });
});

describe("reconcile — the manual branch (optimiser OFF today)", () => {
  const T = today;
  const stuckToday = () => [
    mk({ id: "p", date: T, time: "20:00", tables: ["3"], _locked: true, _manual: true }),
    mk({ id: "r", date: T, time: "20:30", tables: ["3"], _locked: true, _manual: true }),
  ];

  it("only-locked overlaps are left alone, same reference", () => {
    const prev = stuckToday();
    const { next, changed } = reconcile(prev, [T], [], false);
    expect(next).toBe(prev);
    expect(changed).toBe(false);
  });

  it("relocates the NEWEST non-locked booking, deterministically", () => {
    // updatedAt desc with an id tiebreaker, so two devices reconciling the same
    // merge pick the same booking and the per-$id CAS settles the double-write.
    const prev = [
      mk({ id: "p", date: T, time: "20:00", tables: ["3"], updatedAt: 100 }),
      mk({ id: "r", date: T, time: "20:30", tables: ["3"], updatedAt: 200 }),
    ];
    const { next, changed } = reconcile(prev, [T], [], false);
    expect(changed).toBe(true);
    expect(next.find((b) => b.id === "p").tables).toEqual(["3"]);   // older kept its table
    expect(next.find((b) => b.id === "r").tables).not.toEqual(["3"]);
    expect(verifyClean(next, T)).toBe(true);
  });

  it("a clean date is a no-op even when listed as dirty", () => {
    const prev = [mk({ id: "p", date: T, tables: ["3"] })];
    const { next, changed } = reconcile(prev, [T], [], false);
    expect(next).toBe(prev);
    expect(changed).toBe(false);
  });
});

describe("reconcile — no dirty dates at all", () => {
  it("returns its input untouched", () => {
    const prev = [mk({ id: "p", tables: ["3"] })];
    expect(reconcile(prev, [], [], true).next).toBe(prev);
    expect(reconcile(prev, undefined, [], true).changed).toBe(false);
  });
});

// ── v17.16.13 — the termination guarantee ────────────────────────────────────
//
// Identity (v17.10.2/v17.14.0) answers "did this pass change anything". It
// cannot answer "did the change HELP", and a pass that rearranges a dirty day
// without resolving it is accepted, written, and handed straight back through
// the effect's `bookings` dep. `improvesDay` is the third gate: a date's
// pass is taken only if the number of bookings still in a clash STRICTLY
// DECREASED. That count is a non-negative integer, so the loop terminates
// whatever the placement heuristics do.
//
// It is tested directly rather than through `reconcile`, deliberately. Since
// v17.16.5 gave `optimise` a total order, no fixture we could find makes a
// placement pass rearrange a day WITHOUT changing the clash count — 802
// randomly generated dirty days (both branches, 3-9 bookings, a 3-table pool to
// force collisions) produced zero non-converging runs. A reconcile-level test
// would therefore pass identically with the gate removed, which is not a test.
// The predicate carries the contract, so the predicate is what gets pinned.
describe("improvesDay — the termination gate", () => {
  const clash = () => [
    mk({ id: "p", time: "20:00", tables: ["3"] }),
    mk({ id: "r", time: "20:30", tables: ["3"] }),
    mk({ id: "s", time: "20:15", tables: ["4"] }),
    mk({ id: "t", time: "20:45", tables: ["4"] }),
  ];

  it("takes a pass that resolves a clash", () => {
    const before = clash();
    const after = before.map((b) => (b.id === "r" ? { ...b, tables: ["6"] } : b));
    expect(findConflicts(after, D).length).toBeLessThan(findConflicts(before, D).length);
    expect(improvesDay(before, after, D)).toBe(true);
  });

  it("REFUSES a rearrangement that leaves the same number of clashes", () => {
    // The oscillation shape: tables genuinely changed, the day is no cleaner.
    // Swap the two clashing pairs' tables wholesale — 3<->4 — and every pair
    // still overlaps on a shared table.
    const before = clash();
    const swap = { 3: "4", 4: "3" };
    const after = before.map((b) => ({ ...b, tables: b.tables.map((t) => swap[t] || t) }));
    expect(after).not.toEqual(before);
    expect(findConflicts(after, D).length).toBe(findConflicts(before, D).length);
    expect(improvesDay(before, after, D)).toBe(false);
  });

  it("REFUSES a pass that makes the day worse", () => {
    // `findConflicts` returns the SET of bookings in a clash, so "worse" means
    // dragging a booking that was fine INTO one. Building this on `clash()`
    // does the opposite by accident — moving `s` onto table 3 frees `t` on
    // table 4, so the set shrinks from four to three. It has to start from a
    // day with one clash and two clean bookings.
    const before = [
      mk({ id: "p", time: "20:00", tables: ["3"] }),
      mk({ id: "r", time: "20:30", tables: ["3"] }),
      mk({ id: "s", time: "20:15", tables: ["4"] }),
      mk({ id: "t", time: "21:00", tables: ["6"] }),
    ];
    expect(findConflicts(before, D).length).toBe(2);
    const after = before.map((b) => (b.id === "s" ? { ...b, tables: ["3"] } : b));
    expect(findConflicts(after, D).length).toBe(3);
    expect(improvesDay(before, after, D)).toBe(false);
  });

  it("refuses the same reference outright, without scanning it", () => {
    const before = clash();
    expect(improvesDay(before, before, D)).toBe(false);
  });

  it("takes a pass that PLACES an unplaced booking, even when no clash is fixed", () => {
    // The /code-review regression. A day whose clash is UNRESOLVABLE (two
    // `_locked` bookings on one table — every walk-in and drag-drop sets
    // `_locked`) rejected the WHOLE pass on a clash-count-only measure,
    // including the tables it had just found for a different booking. Measured
    // on the clash-only gate: `u` stayed `[]` on every pass, forever, while
    // without any gate it became `["1A"]`. Placement has no other writer.
    const prev = [
      mk({ id: "p", time: "20:00", tables: ["3"], _locked: true, _manual: true }),
      mk({ id: "r", time: "20:30", tables: ["3"], _locked: true, _manual: true }),
      mk({ id: "u", time: "20:00", tables: [] }),
    ];
    const { next, changed } = reconcile(prev, [D], [], true);
    expect(changed).toBe(true);
    expect(next.find((b) => b.id === "u").tables.length).toBeGreaterThan(0);
    // ...and the unresolvable clash is still honestly there.
    expect(findConflicts(next, D).length).toBe(2);
  });

  it("CLASHES DOMINATE — resolving one is worth accepting unplaced bookings", () => {
    // The two counts are lexicographic, not summed, and the difference is
    // reachable: `applyOpt` genuinely leaves a booking unplaced when the day is
    // over-full, and resolving a double-booking is this effect's whole purpose.
    // A summed measure (which passes every other test here) would REFUSE this,
    // leaving two parties on one table to protect a table assignment.
    const before = [
      mk({ id: "p", time: "20:00", tables: ["3"] }),
      mk({ id: "r", time: "20:30", tables: ["3"] }),
    ];
    const after = before.map((b) => ({ ...b, tables: [] }));
    expect(findConflicts(before, D).length).toBe(2);
    expect(findConflicts(after, D).length).toBe(0);
    expect(improvesDay(before, after, D)).toBe(true);
  });

  it("still REFUSES a churn that leaves both counts equal", () => {
    const before = clash();
    const swap = { 3: "4", 4: "3" };
    const after = before.map((b) => ({ ...b, tables: b.tables.map((t) => swap[t] || t) }));
    expect(improvesDay(before, after, D)).toBe(false);
  });

  it("REFUSES a pass that places one booking by UNPLACING another", () => {
    // The second count must not be gameable: same clashes, same unplaced total.
    const before = [
      mk({ id: "p", time: "20:00", tables: ["3"] }),
      mk({ id: "r", time: "20:30", tables: ["3"] }),
      mk({ id: "u", time: "21:00", tables: [] }),
      mk({ id: "v", time: "21:30", tables: ["6"] }),
    ];
    const after = before.map((b) =>
      b.id === "u" ? { ...b, tables: ["6"] } : b.id === "v" ? { ...b, tables: [] } : b);
    expect(improvesDay(before, after, D)).toBe(false);
  });

  it("takes a PARTIAL fix — three clashes down to fewer is progress worth writing", () => {
    // Deliberately not "accept only a CLEAN result": demanding perfection would
    // discard real progress and leave the restaurant with all of it.
    const before = clash();
    const after = before.map((b) => (b.id === "t" ? { ...b, tables: ["6"] } : b));
    expect(verifyClean(after, D)).toBe(false);
    expect(improvesDay(before, after, D)).toBe(true);
  });
});
