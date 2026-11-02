// tests/menu-room.test.js — v18.14.2
//
// With the keyboard up on an iPad Pro simulator, the country menu ran on 82px under
// the booking form's Save bar and the last rows of its list could not be tapped.
// The numbers below are that measurement. The hook's reasons are in its header.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { menuRoom, MENU_ROOM_MIN } from "../src/hooks/useMenuRoom.js";

const hook = stripComments(readFileSync("src/hooks/useMenuRoom.js", "utf8")).join("\n");
const picker = stripComments(readFileSync("src/components/CountryPicker.jsx", "utf8")).join("\n");
const acMenu = stripComments(readFileSync("src/components/AcMenu.jsx", "utf8")).join("\n");
const form = stripComments(readFileSync("src/components/BookingFormModal.jsx", "utf8")).join("\n");
const voucher = stripComments(readFileSync("src/components/VoucherPicker.jsx", "utf8")).join("\n");

describe("menuRoom", () => {
  it("stops above the footer: the iPad's anchor at 169, the port's end at 413", () => {
    expect(menuRoom(169, 413, 502, 320)).toBe(232);
  });
  it("keeps its full height where there is room, and never grows past it", () => {
    expect(menuRoom(169, 1200, 1344, 320)).toBe(320);
  });
  it("stops at the visible bottom when the port reaches past the keyboard", () => {
    expect(menuRoom(169, 900, 400, 320)).toBe(219);
  });
  it("keeps the search box and a row and a half however short the room", () => {
    expect(menuRoom(150, 180, 289, 320)).toBe(MENU_ROOM_MIN);
  });
  it("takes no port at all", () => {
    expect(menuRoom(169, Infinity, 502, 320)).toBe(320);
  });
});

describe("the hook", () => {
  it("never reads the page's pan into the visible bottom, or iOS's rects miss by it", () => {
    expect(hook).toContain("vv ? vv.height : Infinity");
    expect(hook).not.toContain("offsetTop");
    expect(hook).not.toContain("innerHeight");
  });
  // A form that fits has nothing to scroll, and `scrollParentY` would pass over it
  // to the root, which no `scroll` listener hears. The keyboard then arrives.
  it("finds its port by style, so a form that fits when the menu opens still counts", () => {
    expect(hook).toContain("const port = scrollPort(menu);");
    expect(hook).not.toContain("scrollParentY");
  });
  it("measures from the anchor, because the menu's own rect is mid-animation", () => {
    expect(hook).toContain("menu.offsetParent");
    expect(hook).not.toContain("menu.getBoundingClientRect");
  });
  it("follows the keyboard and the form's scroll, and lets both go", () => {
    expect(hook).toContain('port.addEventListener("scroll", measure');
    expect(hook).toContain('port.removeEventListener("scroll", measure');
    expect(hook).toContain('vv.addEventListener("resize", measure');
    expect(hook).toContain('vv.removeEventListener("resize", measure');
    expect(hook).toContain("ro.disconnect()");
  });
  it("is the country menu's", () => {
    expect(picker).toContain("useMenuRoom(menuRef, open, MENU_TALL)");
    expect(picker).toContain("ref={menuRef}");
  });
  // The review's finding: the fix went on one of the four lists that had the fault,
  // and the name list is the one a phone booking opens every time.
  it("is every suggestion list's: none draws AC_MENU itself", () => {
    expect(acMenu).toContain("useMenuRoom(ref, true, AC_MENU.maxHeight)");
    expect(form.match(/<AcMenu>/g)).toHaveLength(2);
    expect(voucher).toContain("<AcMenu menuRef={menuRef}>");
    for (const src of [form, voucher]) expect(src).not.toContain("AC_MENU");
  });
});
