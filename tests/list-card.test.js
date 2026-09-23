// tests/list-card.test.js — v18.2.0: the List card offers the NEXT step, and
// the rest lives behind ⋯ (the quick-status card).
//
// The design critique measured six equal-weight buttons on every card and four
// bookings per tablet screen. Patryk chose: time first, one status button (the
// next step), everything else — other statuses, Cancelled, Delete — in the
// quick-status card the timeline and plan open on a hold.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { nextStatusOf, seatingClosed } from "../src/lib/booking-logic.js";

const TODAY = "2026-10-03";
const b = (status, date = TODAY) => ({ id: "x", date, time: "20:00", status });

describe("nextStatusOf", () => {
  it("walks a visit forward one step", () => {
    expect(nextStatusOf(b("pending"), TODAY, 12 * 60)).toBe("confirmed");
    expect(nextStatusOf(b("confirmed"), TODAY, 12 * 60)).toBe("seated");
    expect(nextStatusOf(b("seated"), TODAY, 12 * 60)).toBe("completed");
  });

  it("a finished visit has no next step", () => {
    expect(nextStatusOf(b("completed"), TODAY, 12 * 60)).toBeNull();
    expect(nextStatusOf(b("cancelled"), TODAY, 12 * 60)).toBeNull();
    expect(nextStatusOf(null, TODAY, 0)).toBeNull();
  });

  it("never offers Seated where seatingClosed refuses it — it offers Completed", () => {
    // A past day is past its close by definition, whatever the clock says.
    const past = b("confirmed", "2026-09-01");
    expect(seatingClosed(past.date, TODAY, 12 * 60)).toBe(true);
    expect(nextStatusOf(past, TODAY, 12 * 60)).toBe("completed");
  });
});

describe("the card and the popup", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
  const List = read("components/ListView.jsx");
  const Popup = read("components/QuickStatusPopup.jsx");

  it("the card renders ONE status button, from nextStatusOf", () => {
    expect(List).toMatch(/const nextSt = nextStatusOf\(b, today, nowMins\);/);
    expect(List, "the old per-status button row is back").not.toMatch(/const statusBtns =/);
    expect(List, "Delete is back on the card").not.toMatch(/onClick=\{stopped\(\(\) => onDelete\(b\.id\)\)\}/);
  });

  it("⋯ is named, says it opens something, and goes through stopped()", () => {
    expect(List).toMatch(/aria-label="More actions"/);
    expect(List).toMatch(/aria-haspopup="dialog"/);
    expect(List).toMatch(/onClick=\{stopped\(\(\) => setMenuFor\(b\.id\)\)\}/);
  });

  it("the card mounts the quick-status card armed, with Delete", () => {
    const tag = List.slice(List.indexOf("<QuickStatusPopup"), List.indexOf("/>", List.indexOf("<QuickStatusPopup")));
    expect(tag).toMatch(/onDelete=\{onDelete\}/);
    expect(tag).toMatch(/\bstartArmed\b/);
  });

  it("the popup's new hooks run BEFORE its early return (rules of hooks)", () => {
    const early = Popup.indexOf("if (!booking) return null;");
    expect(early).toBeGreaterThan(-1);
    for (const h of ["useArmAfterRelease()", "useRef(null)", "useRef(onClose)", "useEffect(function () {"]) {
      const at = Popup.indexOf(h);
      expect(at, h).toBeGreaterThan(-1);
      expect(at, h + " must precede the early return").toBeLessThan(early);
    }
  });

  it("a click-opened popup is armed at once; a hold-opened one still waits", () => {
    expect(Popup).toMatch(/const armed = startArmed \|\| armedByRelease;/);
    expect(Popup).toMatch(/startArmed = false/);
  });
});
