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
import { activatesItself, isTyping, stepPress, raisesKeyboard } from "../src/lib/keyboard.js";

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

describe("stepPress — a stepper that steps once per press, from a pointer OR a key", () => {
  const fake = (extra) => Object.assign({ preventDefault() { this.prevented = true; } }, extra);

  it("a pointer press steps once: on pointerdown, and NOT again on its click", () => {
    let n = 0;
    const h = stepPress(() => { n++; });
    const down = fake({});
    h.onPointerDown(down);
    h.onClick(fake({ detail: 1 }));
    expect(n).toBe(1);
    expect(down.prevented, "no focus on a tap, so nothing scrolls under the finger").toBe(true);
  });

  it("a keyboard click (detail 0) steps", () => {
    let n = 0;
    stepPress(() => { n++; }).onClick(fake({ detail: 0 }));
    expect(n).toBe(1);
  });
});

// v18.4.0 `/code-review`: what Overlay and the WhatsApp inbox make room for.
describe("raisesKeyboard — a field somebody types text into", () => {
  const f = (tagName, type) => ({ tagName, type });
  it("is a textarea and the text-like inputs", () => {
    expect(raisesKeyboard(f("TEXTAREA"))).toBe(true);
    for (const t of [undefined, "", "text", "search", "tel", "email", "url", "number", "password", "TEXT"]) {
      expect(raisesKeyboard(f("INPUT", t)), String(t)).toBe(true);
    }
  });
  it("is not a control that is ticked, dragged or picked from", () => {
    for (const t of ["checkbox", "radio", "range", "date", "time", "datetime-local", "month", "week", "file", "color", "button", "submit", "reset", "hidden"]) {
      expect(raisesKeyboard(f("INPUT", t)), t).toBe(false);
    }
    expect(raisesKeyboard(f("SELECT"))).toBe(false);
    expect(raisesKeyboard(f("BUTTON"))).toBe(false);
    expect(raisesKeyboard(null)).toBe(false);
  });
});
