// tests/keeps-its-side.test.js
// v18.18.0 commits 17 and 18 (Patryk): a control keeps the side it has on a big
// screen when its row wraps on a smaller one (DESIGN.md, "A control keeps its
// side"). He called it a preference, not a rule, so check:style does not hold it.
// These are the rows that were measured to flip, or read to flip once their
// content outgrows the line, each pinned where it now holds its side. Giving
// one up should be a decision, made by editing its pin, never an accident.
// Drag hold is pinned in drag-hold.test.js and the draft card's chip in
// minor-findings.test.js, beside what they already held.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const read = (f) => stripComments(readFileSync(new URL("../src/" + f, import.meta.url), "utf8")).join("\n");

describe("the notification strip's rows (commit 17)", () => {
  // Measured at 375 x 812: Running late's No show and ✕ went to the two
  // edges, and Not on the grid's Assign to the left. The other four share the
  // row and got the same change.
  for (const f of ["Late", "Overlap", "Clash", "Unplaced", "Unsettled", "WaitAvail"]) {
    it(f + "Banner keeps its buttons together at the right", () => {
      const src = read("components/" + f + "Banner.jsx");
      expect(src).toContain('<div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>');
      expect(src).not.toContain('justifyContent: "space-between"');
    });
  }
});

describe("modals, forms and Settings (commit 18)", () => {
  it("the booking form's Back and Save, one group at the right", () => {
    // Measured: an edit at 375 and a new booking at 320 put them at the left.
    const src = read("components/BookingFormModal.jsx");
    expect(src).toContain('<div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{historyBtn}');
    expect(src).toContain('<div style={{display:"flex",gap:8,marginLeft:"auto"}}><button');
  });
  it("Assign and Walk-in: Clear at the right of the selection", () => {
    // Clear is a RowSlot in Assign, whose own margin cancels the gap, so the
    // row packs to its end and the summary takes the slack. Measured with a
    // long status forced in at 375: Clear at x 33 before, 284 after.
    expect(read("components/ManualModal.jsx")).toMatch(/display: "flex", alignItems: "center", justifyContent: "flex-end",\s*gap: 8, flexWrap: "wrap",/);
    expect(read("components/ManualModal.jsx")).toContain('justifyContent: "center", marginRight: "auto" }}>');
    expect(read("components/WalkinForm.jsx")).toMatch(/display: "flex", alignItems: "center", justifyContent: "flex-end",\s*gap: 8, flexWrap: "wrap",/);
    expect(read("components/WalkinForm.jsx")).toContain('<div style={{ marginRight: "auto" }}>');
  });
  it("More's Close and the Reminders tab's New reminder", () => {
    expect(read("components/WeekView.jsx")).toContain('style={mkBtn({ minHeight: 40, padding: "8px 18px", background: BTN.quiet, marginLeft: "auto" })}>Close</button>');
    expect(read("components/Reminders.jsx")).toContain('style={mkBtn({ minHeight: 36, padding: "6px 14px", background: "var(--accent)", marginLeft: "auto" })}');
  });
  it("Settings: a special day's Change, Backup's download, the kitchen limit", () => {
    // Backup and Kitchen limit measured at 375 and 320; Change read from source
    // (DEV has no special days to list).
    const settings = read("components/Settings.jsx");
    expect(settings).toContain('background: BTN.quiet, marginLeft: "auto" })}>Change</button>');
    expect(settings).toContain('style={mkBtn({ fontSize: T.body, minHeight: 40, padding: "8px 16px", background: BTN.quiet, display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" })}');
    expect(read("components/LayoutSettings.jsx")).toContain('<div style={{ marginLeft: "auto" }}><Stepper value={kitchenLimit}');
  });
  it("Admin: Open the log", () => {
    // Measured: x 33 at 375 before, 235 to the row's edge after; 765 at 1024 both.
    expect(read("components/AdminSettings.jsx")).toContain('style={mkBtn({ background: BTN.quiet, flexShrink: 0, display: "inline-flex", alignItems: "center", marginLeft: "auto" })}');
  });
});
