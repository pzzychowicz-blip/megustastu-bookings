// tests/walkin.test.js
//
// v18.3.3 (B4): a walk-in added after closing was written SEATED, and the
// close-time auto-complete (usePersistence) flipped it to completed on the next
// 15s tick, because it maps over every seated booking whose day's close has
// passed. The other four ways to seat somebody already refuse then
// (`seatingClosed`); the walk-in was the fifth door. `walkinRefusal` is the one
// answer, and both of the walk-in's doors ask it: the Seat button's
// `saveWalkin` and `doSaveWalkin`, which the kitchen confirm re-enters directly.
// The dates are arguments compared with each other, not with a live clock.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { walkinRefusal, pastCloseMins } from "../src/lib/booking-logic.js";
import { setWeekHours, DEFAULT_WEEK_HOURS } from "../src/lib/constants.js";

const DAY = "2026-10-01";   // a Thursday; default hours 13:00–22:00

describe("walkinRefusal", () => {
  it("lets a walk-in in while the day is open", () => {
    expect(walkinRefusal(DAY, DAY, 13 * 60)).toBe(null);
    expect(walkinRefusal(DAY, DAY, 22 * 60 - 1)).toBe(null);
  });
  it("refuses from the minute the close-time auto-complete would take it back", () => {
    // Exactly the auto-complete's condition, never its own idea of "past".
    expect(pastCloseMins(DAY, DAY, 22 * 60)).not.toBe(null);
    expect(walkinRefusal(DAY, DAY, 22 * 60)).toMatch(/past closing/);
    expect(walkinRefusal(DAY, DAY, 23 * 60 + 30)).toMatch(/past closing/);
  });
  it("still says Closed on a closed day, whatever the time", () => {
    try {
      setWeekHours(Object.assign({}, DEFAULT_WEEK_HOURS, { 4: { open: 13, close: 22, closed: true } }));
      expect(walkinRefusal(DAY, DAY, 14 * 60)).toMatch(/^Closed today/);
    } finally { setWeekHours(DEFAULT_WEEK_HOURS); }
  });
  it("follows a close past midnight: 00:30 is still yesterday's service", () => {
    try {
      const late = { open: 13, close: 25, closed: false };
      setWeekHours({ 0: late, 1: late, 2: late, 3: late, 4: late, 5: late, 6: late });
      expect(walkinRefusal(DAY, DAY, 23 * 60 + 30)).toBe(null);
    } finally { setWeekHours(DEFAULT_WEEK_HOURS); }
  });
});

describe("both walk-in doors ask it before writing", () => {
  const HOOK = stripComments(
    readFileSync(new URL("../src/hooks/useWalkin.js", import.meta.url), "utf8")).join("\n");
  const body = (name, next) => HOOK.slice(HOOK.indexOf("function " + name + "("), HOOK.indexOf(next));

  it("doSaveWalkin refuses before saveBookings", () => {
    const b = body("doSaveWalkin", "function saveWalkin(");
    expect(b.indexOf("closedNow()")).toBeGreaterThan(-1);
    expect(b.indexOf("closedNow()")).toBeLessThan(b.indexOf("saveBookings("));
  });
  it("saveWalkin refuses before the kitchen confirm", () => {
    const b = body("saveWalkin", "const walkinDirty");
    expect(b.indexOf("closedNow()")).toBeGreaterThan(-1);
    expect(b.indexOf("closedNow()")).toBeLessThan(b.indexOf("setConfirmKitchen("));
  });
  it("closedNow asks walkinRefusal, and nothing else in the hook decides it", () => {
    expect(HOOK).toMatch(/return walkinRefusal\(/);
    expect(HOOK).not.toMatch(/hoursFor\(/);
  });
});
