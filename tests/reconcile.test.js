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
import { dirtyDates, reconcile } from "../src/lib/reconcile.js";
import { verifyClean } from "../src/lib/booking-logic.js";

const D = "2026-09-01";                                   // a future date
const today = new Date().toISOString().slice(0, 10);

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
