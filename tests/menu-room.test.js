// tests/menu-room.test.js — v18.14.2
//
// With the keyboard up on an iPad Pro simulator, the country menu ran on 82px under
// the booking form's Save bar and the last rows of its list could not be tapped.
// The numbers below are that measurement. The hook's reasons are in its header.
//
// v18.18.0: `above`, for the phone refusal's "Other code…", whose list opens UPWARD
// from the form's footer. Its numbers were measured on DEV through the rig (998×507,
// the tablet; 289 and 231 tall, its keyboard as Android takes it; 375×812; 1280×800).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { menuRoom, menuRoomAbove, MENU_ROOM_MIN } from "../src/hooks/useMenuRoom.js";

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

describe("menuRoomAbove", () => {
  it("stops under the card's top: the tablet's pill at 300.6, the card's top at 25.3", () => {
    expect(menuRoomAbove(300.6, 25.3, 320)).toBe(263);
  });
  it("with the keyboard up the form's body is down to its padding, and 121 is left", () => {
    // 231 tall: the pill at 144.6 under a card from 11.6. At 289 the same 121, once
    // the footer's tight padding has eased (the pill at 147.5, the card at 14.5).
    expect(menuRoomAbove(144.6, 11.6, 320)).toBe(121);
    expect(menuRoomAbove(147.5, 14.5, 320)).toBe(121);
  });
  it("on a phone's sheet nothing clips it, and the screen's top is 0", () => {
    expect(menuRoomAbove(555, 0, 320)).toBe(320);
  });
  it("never reaches past the screen's top, where a clip box starts above it", () => {
    expect(menuRoomAbove(150, -60, 320)).toBe(138);
  });
  it("has no floor: past the clip box's top nothing scrolls back into view", () => {
    // No pins, the tablet with its keyboard up: the pill sits a row of codes higher,
    // at 98.6 under a card from 11.6 (231 tall) and at 103.5 under 14.5 (289). The
    // list then scrolls inside the room, and the card cuts nothing off.
    expect(menuRoomAbove(98.6, 11.6, 320)).toBe(75);
    expect(menuRoomAbove(103.5, 14.5, 320)).toBe(77);
    expect(menuRoomAbove(8, 0, 320)).toBe(0);
  });
  it("keeps its full height where there is room", () => {
    expect(menuRoomAbove(579, 40, 320)).toBe(320);
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
    expect(hook).toContain("const port = above ? clipBox(menu) : scrollPort(menu);");
    expect(hook).not.toContain("scrollParentY");
  });
  // `scrollPort` knows only auto and scroll, so it would walk past the card's
  // `overflow: hidden` to the page, and the menu would run on past the card's top.
  it("opening upward, stops at the box that clips it, and at a fixed box, which nothing above can clip", () => {
    const clip = hook.slice(hook.indexOf("function clipBox("), hook.indexOf("export function useMenuRoom("));
    expect(clip).toContain('if (cs.overflowY !== "visible") return p;');
    expect(clip).toContain('if (cs.position === "fixed") return null;');
    expect(hook).toContain("menuRoomAbove(box.top, port ? port.getBoundingClientRect().top : 0, tall)");
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
  // Measured at 289: the footer's tight padding eased after the keyboard's measure,
  // the pill rose 10px, and the menu ran 4px past the card's top.
  it("measures again when an ease inside the port ends, which moves the anchor and no observer hears", () => {
    expect(hook).toContain('port.addEventListener("transitionend", measure)');
    expect(hook).toContain('port.removeEventListener("transitionend", measure)');
  });
  it("is the country menu's", () => {
    expect(picker).toContain("useMenuRoom(menuRef, open, MENU_TALL, above)");
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

// v18.18.0 (Patryk, 2026-11-19): the refusal's last button opens every country (a
// pinned one included, so "spain" finds Spain), and a pick there is a code button's tap.
describe("the phone refusal's Other code…", () => {
  it("opens upward, with every country, and hands its pick to onPickCode", () => {
    const tag = form.slice(form.indexOf('<CountryPicker label="Other code…"'));
    // v18.18.0 (Part 2 batch 4): and its hover description, which CountryPicker
    // asks every call site for (check:style Rule 14).
    expect(tag.slice(0, tag.indexOf("/>"))).toBe('<CountryPicker label="Other code…" description="Choose another country\'s code for the number, and try again" above onPick={onPickCode} style={OTHER_CODE} ');
  });
  it("is a row of its own under the codes, its menu as wide as the row", () => {
    expect(form).toContain('{codeGrid}<div style={{position:"relative"}}><CountryPicker label="Other code…"');
    expect(form).toContain("const OTHER_CODE = { width: \"100%\", height: H.control,");
  });
  it("shows on the code refusal alone, and with no pins it stands alone", () => {
    expect(form).toContain("const noCode=error===NO_CODE_REFUSAL;");
    expect(form).toContain("below={noCode?<div");
    expect(form).toContain("const codeGrid=codes.length?<div");
  });
});
