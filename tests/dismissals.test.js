// tests/dismissals.test.js - v17.14.0
//
// The pure core of the shared dismissal Sets. The two properties worth guarding
// are both about IDENTITY, because both were free when these were four separate
// `useState`s and are easy to lose when they become one object: nothing-changed
// must return the same reference (React bails out; the clash prune effect
// cannot re-enter), and an untouched key must keep ITS Set by reference (or
// dismissing an overlap row invalidates the late banner's memo).
import { describe, it, expect } from "vitest";
import { dismissIn, pruneIn, resetIn, DISMISS_KEYS } from "../src/hooks/useDismissals.js";

const empty = () => {
  const s = {};
  DISMISS_KEYS.forEach((k) => { s[k] = new Set(); });
  return s;
};

describe("dismissIn", () => {
  it("adds to the named Set only", () => {
    const a = empty();
    const b = dismissIn(a, "late", "b1");
    expect([...b.late]).toEqual(["b1"]);
    expect(b.overlap.size).toBe(0);
  });

  it("carries every untouched Set through BY REFERENCE", () => {
    const a = empty();
    const b = dismissIn(a, "late", "b1");
    expect(b.overlap).toBe(a.overlap);
    expect(b.wait).toBe(a.wait);
    expect(b.clash).toBe(a.clash);
  });

  it("re-dismissing the same id returns the same object", () => {
    const a = dismissIn(empty(), "late", "b1");
    expect(dismissIn(a, "late", "b1")).toBe(a);
  });

  it("an unknown key is a no-op rather than a crash", () => {
    const a = empty();
    expect(dismissIn(a, "nope", "x")).toBe(a);
  });
});

describe("pruneIn", () => {
  it("drops ids that are no longer live", () => {
    const a = dismissIn(dismissIn(empty(), "clash", "pr"), "clash", "xy");
    const out = pruneIn(a, "clash", new Set(["pr"]));
    expect([...out.clash]).toEqual(["pr"]);
  });

  it("returns the SAME object when nothing drops - the anti-re-entry property", () => {
    // The clash prune runs in an effect that depends on the Set it writes. If a
    // no-op pass produced a new reference the effect would re-run forever, which
    // is the v17.10.2 lesson one file along.
    const a = dismissIn(empty(), "clash", "pr");
    expect(pruneIn(a, "clash", new Set(["pr", "other"]))).toBe(a);
  });

  it("an empty Set is a no-op", () => {
    const a = empty();
    expect(pruneIn(a, "clash", new Set())).toBe(a);
  });
});

describe("resetIn", () => {
  it("empties the named keys and leaves the others alone", () => {
    let a = dismissIn(empty(), "late", "b1");
    a = dismissIn(a, "clash", "pr");
    const out = resetIn(a, ["late", "overlap", "wait"]);
    expect(out.late.size).toBe(0);
    expect([...out.clash]).toEqual(["pr"]);   // clash survives a day change
    expect(out.clash).toBe(a.clash);
  });

  it("returns the same object when every named key is already empty", () => {
    const a = dismissIn(empty(), "clash", "pr");
    expect(resetIn(a, ["late", "overlap", "wait"])).toBe(a);
  });
});
