// tests/keyboard-inset.test.js — v18.3.0 phase 17 (N1)
//
// The on-screen keyboard no longer hides a modal's Save. Two halves, neither
// visible to build, lint or a render test: the arithmetic that turns the
// visual viewport into an inset (fed here the numbers the iOS Simulator
// reported, REFACTOR_LOG v18.3.0 phase 17), and the wiring that makes every
// Overlay branch take it as PADDING rather than moving its edges (Patryk's
// pick: moved edges let the page show through iOS 26's see-through keyboard
// bar). Comments stripped (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { keyboardInsetOf } from "../src/hooks/useKeyboardInset.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const Atoms = stripComments(read("src", "components", "atoms.jsx")).join("\n");
const App = stripComments(read("src", "App.jsx")).join("\n");
const Overlay = Atoms.slice(Atoms.indexOf("export function Overlay("), Atoms.indexOf("\n}\n", Atoms.indexOf("export function Overlay(")));

const win = (innerHeight, height, offsetTop) => ({ innerHeight, visualViewport: { height, offsetTop } });

describe("N1: the keyboard's inset, from the visual viewport", () => {
  it("is nothing without a window or a visualViewport", () => {
    expect(keyboardInsetOf(null)).toEqual({ top: 0, bottom: 0 });
    expect(keyboardInsetOf({ innerHeight: 800 })).toEqual({ top: 0, bottom: 0 });
  });

  it("is nothing for a gap a browser toolbar makes", () => {
    // Only a gap over 100px is a keyboard, so a toolbar showing or hiding
    // never moves a dialog.
    expect(keyboardInsetOf(win(796, 796, 0))).toEqual({ top: 0, bottom: 0 });
    expect(keyboardInsetOf(win(796, 740, 0))).toEqual({ top: 0, bottom: 0 });
    expect(keyboardInsetOf(win(796, 696, 0))).toEqual({ top: 0, bottom: 0 });
  });

  it("is the keyboard's height, as the iPhone Simulator reported it", () => {
    // Safari, iOS 26: innerHeight stayed 796 while the visual viewport fell to 447.
    expect(keyboardInsetOf(win(796, 447, 0))).toEqual({ top: 0, bottom: 349 });
    // A field iOS scrolled the page for: innerHeight 764, the viewport 32px down.
    expect(keyboardInsetOf(win(764, 447, 32))).toEqual({ top: 32, bottom: 285 });
    expect(keyboardInsetOf(win(796, 447.4, 0.6))).toEqual({ top: 1, bottom: 348 });
  });

  it("is nothing where the keyboard resizes the layout viewport itself (Android)", () => {
    // interactive-widget=resizes-content shrinks innerHeight with the keyboard.
    expect(keyboardInsetOf(win(430, 430, 0))).toEqual({ top: 0, bottom: 0 });
  });
});

describe("N1: every Overlay branch takes the inset as padding", () => {
  it("reads the hook once, above every branch", () => {
    expect(Overlay.match(/useKeyboardInset\(\)/g)).toHaveLength(1);
    expect(Overlay.indexOf("const kb = useKeyboardInset();")).toBeLessThan(Overlay.indexOf("if (panel)"));
  });

  it("pads the full-screen boxes instead of moving their edges", () => {
    // The footer sheet: the box stays top 0 / bottom 0 and pads by the inset,
    // and the footer drops the home-indicator inset the keyboard covers.
    expect(Overlay).toContain('position: "fixed", top: 0, left: 0, right: 0, bottom: 0, paddingTop: kb.top, paddingBottom: kb.bottom');
    expect(Overlay).toContain('paddingBottom: kb.bottom ? SP.wide : "max(12px, env(safe-area-inset-bottom))"');
    // The no-footer sheet: its scroller is absolutely placed (padding cannot
    // move it), so the scroller is inset and the sheet paints under it.
    expect(Overlay).toContain('position: "absolute", top: kb.top, left: 0, right: 0, bottom: kb.bottom');
    expect(Overlay).toMatch(/className=\{sheetCls\} style=\{\{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, background: "var\(--bg-sheet-mobile\)" \}\}/);
    // The scrims pad, so a card centres in what is visible.
    expect(Overlay).toContain("paddingTop: SP.wide + kb.top, paddingBottom: SP.wide + kb.bottom");
    expect(Overlay).toContain("paddingTop: scrimPad + (mob ? 0 : kb.top), paddingBottom: scrimPad + (mob ? 0 : kb.bottom)");
    // No fixed box moves an edge by the inset.
    expect(Overlay).not.toMatch(/position: "fixed"[^}]*\b(top|bottom): kb\./);
  });

  it("lets a card fill the visible area only while the keyboard is up", () => {
    expect(Overlay).toContain('const cardMaxH = kb.bottom ? (top ? "calc(100% - " + TOP_ANCHOR + ")" : "100%") : "90dvh";');
    expect(Overlay.match(/maxHeight: cardMaxH/g)).toHaveLength(2);
    expect(Overlay).not.toMatch(/maxHeight: "90dvh"/);
  });
});

describe("N1: Android resizes the layout viewport", () => {
  it("the runtime viewport asks for resizes-content", () => {
    expect(App).toContain('meta.content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover,interactive-widget=resizes-content";');
  });

  it("index.html's viewport, which the login screen runs on, is left alone", () => {
    expect(read("index.html")).not.toContain("interactive-widget");
  });
});
