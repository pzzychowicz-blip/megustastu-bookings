// tests/keyboard.test.js — v18.2.0: lib/keyboard.js's `activatesItself`.
//
// The global Enter chain (useKeyboardShortcuts.js) maps Enter to the topmost
// modal's primary action, and used to do it whatever held focus — Enter on a
// focused Back button in the booking form SAVED the booking. It now leaves the
// key to any element that activates on Enter by itself. No DOM in this suite
// (tests/CLAUDE.md), so the elements are the minimal shape the helper reads.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { activatesItself, isTyping } from "../src/lib/keyboard.js";

function el(tagName, attrs = {}) {
  return {
    tagName,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
  };
}

describe("activatesItself", () => {
  it("is true for the things Enter already presses", () => {
    expect(activatesItself(el("BUTTON"))).toBe(true);
    expect(activatesItself(el("A", { href: "#main" }))).toBe(true);
    expect(activatesItself(el("DIV", { role: "button" }))).toBe(true); // timeline block
    expect(activatesItself(el("g", { role: "button" }))).toBe(true);   // plan table
    expect(activatesItself(el("BUTTON", { role: "switch" }))).toBe(true); // Toggle atom
  });

  it("is false where the modal's Enter must still apply", () => {
    expect(activatesItself(el("DIV", { tabindex: "-1" })), "Overlay focuses the dialog container").toBe(false);
    expect(activatesItself(el("INPUT")), "Enter in a text field still saves").toBe(false);
    expect(activatesItself(el("SELECT"))).toBe(false);
    expect(activatesItself(el("A")), "an anchor without href is not a link").toBe(false);
    expect(activatesItself(el("DIV", { role: "dialog" }))).toBe(false);
    expect(activatesItself(null)).toBe(false);
  });

  it("does not overlap isTyping — a field is one or the other", () => {
    for (const t of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isTyping(el(t)) && activatesItself(el(t))).toBe(false);
    }
  });

  it("is consulted by the Enter branch BEFORE the modal loop", () => {
    const src = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "useKeyboardShortcuts.js"), "utf8")).join("\n");
    const enter = src.indexOf('if(k==="Enter"){');
    expect(enter).toBeGreaterThan(-1);
    const guard = src.indexOf("if(activatesItself(e.target)) return;", enter);
    const loop = src.indexOf("for(let i=0;i<MODAL_ENTER_ORDER.length;i++)", enter);
    expect(guard, "the guard is in the Enter branch").toBeGreaterThan(enter);
    expect(guard, "and runs before any modal's Enter action").toBeLessThan(loop);
  });
});
