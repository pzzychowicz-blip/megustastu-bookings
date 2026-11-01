// tests/reserved-slots.test.js — v18.14.0 (correction 26, Patryk)
//
// Three controls changed width and shoved what sat beside them, in one frame: Follow
// moved the zoom buttons 17px, an armed template Delete took 60px out of its row's text,
// and the duration Reset moved a form's columns 14 to 16px. Each has a reserved slot
// now, so nothing moves at all. These read the source, which says the slot exists; the
// numbers are measurements in the app's font, so re-measure if the font or a size moves.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const read = (path) => stripComments(readFileSync(new URL("../src/components/" + path, import.meta.url), "utf8")).join("\n");

describe("a control that changes width keeps its widest", () => {
  it("Follow keeps \"Following\"'s width", () => {
    const zoom = read("TimelineZoomControls.jsx");
    expect(zoom).toMatch(/const FOLLOW_W = 76;/);
    expect(zoom).toMatch(/minHeight: 36, minWidth: FOLLOW_W,/);
  });
  it("a template's buttons reserve the armed width, and grow leftwards inside it", () => {
    const editor = read("whatsapp/TemplatesEditor.jsx");
    expect(editor).toMatch(/const ARMED_W = 138;/);
    expect(editor).toMatch(/minWidth: ARMED_W, display: "flex", justifyContent: "flex-end", flexShrink: 0/);
  });
});

describe("the duration Reset", () => {
  const reset = read("DurationReset.jsx");
  it("sits on the label line, taking nothing from the row", () => {
    expect(reset).toMatch(/position: "absolute", right: 0, bottom: "100%"/);
  });
  it("comes and goes on both halves of the fade", () => {
    expect(reset).toMatch(/inClass="mgt-appear" outClass="mgt-ghost-out"/);
  });
  it("is the same control on both forms, in a row it can anchor to", () => {
    expect(read("BookingFormModal.jsx")).toMatch(/<Fld label="Duration"><div style=\{\{position:"relative",/);
    expect(read("WalkinForm.jsx")).toMatch(/<Fld label="Duration">\s*<div style=\{\{ position: "relative",/);
    for (const form of ["BookingFormModal.jsx", "WalkinForm.jsx"]) expect(read(form), form).toContain("<DurationReset show={!!");
  });
});

// Correction 27: nothing can reserve a count that is usually absent, so it eases.
describe("the inbox's tab count", () => {
  it("opens sideways with its gap inside it", () => {
    const inbox = read("whatsapp/InboxPanel.jsx");
    expect(inbox).toMatch(/<Reveal horizontal show=\{badge != null && badge > 0\}>/);
    expect(inbox).toMatch(/style=\{\{ marginLeft: 6, fontSize: T\.micro/);
  });
});
