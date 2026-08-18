// tests/auto-height.test.js — v17.10.0
//
// AutoHeight's clamped-range arithmetic (`clampRange` in atoms.jsx). The
// component itself is DOM-bound and untestable here; this is the part that is
// pure, and it is the part that has been got wrong twice — v17.9.1 clamped the
// `watch` swap and left the ResizeObserver path unclamped on the stated belief
// that the observer was "already served correctly", which is what left Settings
// → Layout spending 700ms of an 864ms animation below the fold.
import { describe, it, expect } from "vitest";
import { clampRange } from "../src/components/atoms.jsx";

describe("clampRange", () => {
  it("is the plain measure when there is no cap", () => {
    expect(clampRange(321, 2602, null)).toEqual({ from: 321, to: 2602, pending: null, moves: true });
  });

  it("leaves a change that fits inside the port completely alone", () => {
    // The Week↔Month body — Patryk's reference for how a resize should feel.
    expect(clampRange(397, 361, 900)).toEqual({ from: 397, to: 361, pending: null, moves: true });
  });

  it("clamps a grow to the ceiling and remembers the true height", () => {
    // Settings → Layout, opening Combos: 321 → 2602 in a port that stops
    // showing anything past 508.
    expect(clampRange(321, 2602, 508)).toEqual({ from: 321, to: 508, pending: 2602, moves: true });
  });

  it("reports no movement when both ends are above the ceiling", () => {
    // The General tab: already overflowing at rest, so opening a section cannot
    // move a pixel. `moves: false` is what stops the port being clipped for a
    // third of a second to animate that.
    const r = clampRange(2308, 2693, 508);
    expect(r.moves).toBe(false);
    expect(r.from).toBe(508);
    expect(r.to).toBe(508);
  });

  it("pulls a shrink down to the ceiling before easing the visible part", () => {
    // Collapsing a tall section: the drop from 2602 to the ceiling only removes
    // scroll range, so it is free; the 508 → 321 is the part anyone sees.
    expect(clampRange(2602, 321, 508)).toEqual({ from: 508, to: 321, pending: null, moves: true });
  });

  it("only sets `pending` when the target was actually clamped", () => {
    expect(clampRange(100, 400, 508).pending).toBe(null);   // 400 fits — nothing to retake
    expect(clampRange(100, 900, 508).pending).toBe(900);    // clamped — retake 900 after
  });

  it("treats an equal-height change as no movement", () => {
    expect(clampRange(400, 400, 508).moves).toBe(false);
    expect(clampRange(400, 400, null).moves).toBe(false);
  });
});
