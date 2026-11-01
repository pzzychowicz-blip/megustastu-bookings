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
  // v18.3.3 (/code-review): the test was named for 00:30 and asserted 23:30
  // only. Both now. After midnight a walk-in is filed under the NEW date
  // (`closedNow` asks with `todayStr()` for both days), which is not past its
  // own close, so the late service keeps seating.
  it("follows a close past midnight: 23:30 and 00:30 both seat", () => {
    try {
      const late = { open: 13, close: 25, closed: false };
      setWeekHours({ 0: late, 1: late, 2: late, 3: late, 4: late, 5: late, 6: late });
      expect(walkinRefusal(DAY, DAY, 23 * 60 + 30)).toBe(null);
      const NEXT = "2026-10-02";
      expect(walkinRefusal(NEXT, NEXT, 30)).toBe(null);
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

// v18.14.0 (M4): the picker began below the fold while Seat stayed disabled.
describe("the walk-in form's order", () => {
  const FORM = stripComments(readFileSync(new URL("../src/components/WalkinForm.jsx", import.meta.url), "utf8")).join("\n");
  const at = (s) => {
    const i = FORM.indexOf(s, FORM.indexOf('<ModalTitle marginBottom={4} background="var(--app-walkin)">'));
    expect(i, s).toBeGreaterThan(-1);
    return i;
  };

  it("is Time and guests, then the picker, then the kitchen line, Duration and Notes", () => {
    const order = ['<Fld label="Time">', '<Fld label="Number of guests">', "<TableGrid", "{wKitchenSection}", '<Fld label="Duration">', '<Fld label="Notes">'].map(at);
    expect(order).toEqual(order.slice().sort((a, b) => a - b));
  });

  it("keeps the guests beside the time, and the hint the card already gives is gone", () => {
    expect(FORM).not.toContain("Tap tables to select / deselect.");
    expect(FORM).toContain("Select tables below.");
  });
});

// v18.14.0 (correction 16, Patryk): on a full evening at 998 × 507 the answer was at
// y 906, under the picker, and nothing on screen said there was no table.
describe("the walk-in's answer is the booking form's line", () => {
  const FORM = stripComments(readFileSync(new URL("../src/components/WalkinForm.jsx", import.meta.url), "utf8")).join("\n");
  it("sits in the footer, in a region that stays mounted, above the buttons", () => {
    const foot = FORM.slice(FORM.indexOf("const footerEl=("), FORM.indexOf("<Overlay onClose"));
    const status = foot.indexOf('<div role="status">'), line = foot.indexOf("<AvailLine"), seat = foot.indexOf("Seat");
    expect(status).toBeGreaterThan(foot.indexOf('<div role="alert">'));
    expect(line).toBeGreaterThan(status);
    expect(seat).toBeGreaterThan(line);
    expect(FORM.slice(FORM.indexOf("<Overlay onClose")), "the body keeps no copy of it").not.toMatch(/<AvailLine|Add to waitlist/);
  });
  it("says what the booking form says, in the same tone, with the same ways out", () => {
    expect(FORM).toContain('text={"No table for " + wSize + " at " + wTime}');
    expect(FORM.slice(FORM.indexOf("<AvailLine"), FORM.indexOf("/>", FORM.indexOf("<AvailLine")))).not.toContain("warn");
    expect(FORM).toContain("onAddToWaitlist={onAddToWaitlist || null}");
  });
  it("keeps its band through a re-check, and a picked table settles it at once", () => {
    expect(FORM).toContain("const wLine = useLineBand(wAsking ? wAutoCheck : null, wAsking && wChecking);");
    expect(FORM).toContain("checking={wLine.checking}");
    expect(FORM).toContain("leaving={!wLine.shown}");
    expect(FORM, "the body's cue stays shut under the band").toContain("show={wChecking && wAsking && !wLine.shown}");
  });
});

describe("a busy table in the grid both pickers share", () => {
  const GRID = stripComments(readFileSync(new URL("../src/components/TableGrid.jsx", import.meta.url), "utf8")).join("\n");

  it("is the danger pane's pair, with no opacity to take the text down with it", () => {
    expect(GRID).toMatch(/else if \(blocked\) \{ bg = "var\(--danger-bg\)"; +clr = "var\(--danger-text\)";/);
    expect(GRID).not.toMatch(/opacity:/);
  });

  it("its word takes the same ink as its number", () => {
    expect(GRID).toContain('const subClr = blocked && !isSel ? clr :');
  });
});

