// tests/country-menu.test.js — v18.14.0 (correction 31, Patryk)
//
// The country menu fades in and out. Each line here is something the exit could have
// broken without a sound: the search box must mount in the tap's own commit or iOS opens
// no keyboard, the list must not jump while it fades, and the leaving copy must not take
// a tap or a Tab. The frames are in REFACTOR_LOG.md.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const src = stripComments(readFileSync("src/components/CountryPicker.jsx", "utf8")).join("\n");

describe("the country menu", () => {
  it("uses the pair for a popover anchored to its trigger, from the corner under the pill", () => {
    expect(src).toContain('className={open ? "mgt-pop-in" : "mgt-pop-out"}');
    expect(src).toContain('transformOrigin: "top left"');
  });
  it("mounts in the commit that opens it, which Presence would not", () => {
    expect(src).toContain("{open || leaving ? (");
    expect(src).not.toContain("<Presence");
  });
  it("holds for the exit from its first frame, on the token", () => {
    expect(src).toContain('return afterFrame(function () { setLeaving(false); setQ(""); }, EXIT_MS);');
  });
  it("keeps the filter for the exit and clears it for the next open", () => {
    const close = src.slice(src.indexOf("function close("), src.indexOf("function pick("));
    expect(close).not.toContain("function close(refocus) {\n    setOpen(false);\n    setQ");
    const open = src.slice(src.indexOf("function openList("), src.indexOf("Outside press") >= 0 ? src.length : src.length);
    expect(open).toContain('setQ("");');
  });
  it("is inert on its way out", () => {
    expect(src).toContain("inert={!open}");
  });
  // Measured: reopened 80ms into the exit, focus stayed on the pill and typing "bel"
  // reached nothing, because `autoFocus` runs at a mount and that node never left.
  it("is a new menu for every open, so the search box takes the focus on a reopen too", () => {
    expect(src).toContain('<div ref={menuRef} key={opens} className={open ? "mgt-pop-in" : "mgt-pop-out"}');
    expect(src).toContain("autoFocus");
    const open = src.slice(src.indexOf("function openList("));
    expect(open.indexOf("setOpens(")).toBeGreaterThan(-1);
    expect(open.indexOf("setOpens(")).toBeLessThan(open.indexOf("setOpen(true)"));
  });
  // v18.14.2, on an iPad: "pol" raised iOS's "Pół" bubble, and it outlived the form.
  it("asks the keyboard to leave a country's name as it was typed", () => {
    expect(src).toContain('autoCorrect="off"');
    expect(src).toContain('autoCapitalize="none"');
    expect(src).toContain("spellCheck={false}");
  });
});
