// tests/wipe-window.test.js
//
// v18.3.0 (phase 3 follow-up) — the status-change overlay's window starts when
// the overlay MOUNTS. See src/lib/wipe-window.js for the measurement behind it.
// The property that matters: from the moment armWipe runs, the overlay stays
// open for exactly exitHold("wipe"), however long the render before it took.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { pendingWipe, wipeOpen, armWipe } from "../src/lib/wipe-window.js";
import { exitHold, M } from "../src/lib/constants.js";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_700_000_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe("the wipe window", () => {
  it("is open while pending, and its hold starts at the mount, not at detection", () => {
    const rerender = vi.fn();
    const a = pendingWipe({ type: "wipe" }, rerender);
    expect(a.type).toBe("wipe");
    expect(wipeOpen(a, Date.now())).toBe(true);

    vi.advanceTimersByTime(300);            // a slow render before the overlay attaches
    armWipe(a);
    expect(a.until).toBe(Date.now() + exitHold("wipe"));

    // Still open where a window counted from detection would already have closed.
    vi.advanceTimersByTime(exitHold("wipe") - 1);
    expect(wipeOpen(a, Date.now())).toBe(true);
    expect(rerender).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(rerender).toHaveBeenCalledTimes(1);
    expect(wipeOpen(a, Date.now())).toBe(false);
  });

  it("outlasts the keyframe it holds", () => {
    expect(exitHold("wipe")).toBeGreaterThan(M.dur.wipe);
  });

  it("arms once, whatever number of overlays or ref calls attach", () => {
    const rerender = vi.fn();
    const a = pendingWipe({ from: "confirmed" }, rerender);
    armWipe(a);
    const until = a.until;
    vi.advanceTimersByTime(100);
    armWipe(a);                              // a second row of the same booking, or a re-render's new ref
    expect(a.until).toBe(until);
    vi.advanceTimersByTime(exitHold("wipe"));
    expect(rerender).toHaveBeenCalledTimes(1);
  });

  it("lapses without a re-render when no overlay ever mounts", () => {
    const rerender = vi.fn();
    const a = pendingWipe({ type: "fill" }, rerender);
    vi.advanceTimersByTime(exitHold("wipe"));
    expect(wipeOpen(a, Date.now())).toBe(false);
    expect(rerender).not.toHaveBeenCalled();
  });

  it("treats a missing entry as closed", () => {
    expect(wipeOpen(undefined, Date.now())).toBe(false);
    expect(() => armWipe(undefined)).not.toThrow();
  });

  it("both views arm from the overlay's ref and hand-type no hold", () => {
    for (const f of ["src/components/TimelineView.jsx", "src/components/ListView.jsx"]) {
      const src = stripComments(readFileSync(f, "utf8")).join("\n");
      expect(src, f + " must arm its overlay's window on mount").toMatch(/ref=\{function \(el\) \{ if \(el\) armWipe\(/);
      expect(src, f + " must not count the window from the detecting effect").not.toMatch(/until: now \+/);
    }
  });

  // v18.3.2: keyed on `bookings`, the List's detector missed a date change that
  // changed no booking (the week view's day pick), kept the previous day's
  // statuses, and the first status change on the new day played no wipe
  // (measured on DEV: 0, then 1).
  it("the List's detector follows the day's list, which follows the date", () => {
    const src = stripComments(readFileSync("src/components/ListView.jsx", "utf8")).join("\n");
    expect(src, "the day's list must be memoised on the bookings and the date").toMatch(/const day = useMemo\(\(\) => bookings[\s\S]*?\}\), \[bookings, date\]\);/);
    expect(src, "the detector must be keyed on the day's list").toMatch(/__listPrev = m;\s*\}, \[day\]\);/);
  });
});
