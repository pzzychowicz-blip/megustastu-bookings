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
    expect(keyboardInsetOf(null)).toEqual({ bottom: 0 });
    expect(keyboardInsetOf({ innerHeight: 800 })).toEqual({ bottom: 0 });
  });

  it("is nothing for a gap a browser toolbar makes", () => {
    // Only a gap over 100px is a keyboard, so a toolbar showing or hiding
    // never moves a dialog.
    expect(keyboardInsetOf(win(796, 796, 0))).toEqual({ bottom: 0 });
    expect(keyboardInsetOf(win(796, 740, 0))).toEqual({ bottom: 0 });
    expect(keyboardInsetOf(win(796, 696, 0))).toEqual({ bottom: 0 });
  });

  it("is the keyboard's height, as the iPhone Simulator reported it", () => {
    // Safari, iOS 26: innerHeight stayed 796 while the visual viewport fell to 447.
    expect(keyboardInsetOf(win(796, 447, 0))).toEqual({ bottom: 349 });
    expect(keyboardInsetOf(win(796, 447.4, 0.6))).toEqual({ bottom: 349 });
  });

  it("counts a scroll iOS made for the field ONCE (v18.3.1, a real iPhone 12 mini)", () => {
    // Name first, no scroll: the sheet padded 339 and the footer sat on the bar.
    expect(keyboardInsetOf(win(664, 325, 0))).toEqual({ bottom: 339 });
    // Notes with the keyboard down: iOS scrolled 243px and innerHeight shrank
    // to 421. innerHeight − (height + offsetTop) is negative, so v18.3.0 padded
    // nothing and the footer (352–421) sat under the ⌃⌄✓ bar.
    expect(keyboardInsetOf(win(421, 325, 243))).toEqual({ bottom: 96 });
    // The voucher box: a 57px scroll left v18.3.0's footer at 313–382.
    expect(keyboardInsetOf(win(607, 325, 57))).toEqual({ bottom: 282 });
    // The Simulator's 32px scroll (v18.3.0 phase 17), under-padded by 32 then.
    expect(keyboardInsetOf(win(764, 447, 32))).toEqual({ bottom: 317 });
  });

  it("judges the keyboard on its whole height, but pads only what is left", () => {
    // 96px of inset is under the 100px toolbar threshold on its own; the
    // keyboard it belongs to (421 + 243 − 325 = 339) is not.
    expect(keyboardInsetOf(win(421, 325, 243))).toEqual({ bottom: 96 });
    // Scrolled by the whole keyboard: the sheet already ends at the bar.
    expect(keyboardInsetOf(win(325, 325, 339))).toEqual({ bottom: 0 });
    // A small scroll with no keyboard is still nothing.
    expect(keyboardInsetOf(win(740, 700, 40))).toEqual({ bottom: 0 });
  });

  it("is nothing where the keyboard resizes the layout viewport itself (Android)", () => {
    // interactive-widget=resizes-content shrinks innerHeight with the keyboard.
    expect(keyboardInsetOf(win(430, 430, 0))).toEqual({ bottom: 0 });
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
    expect(Overlay).toContain('position: "fixed", top: 0, left: 0, right: 0, bottom: 0, paddingBottom: kb.bottom');
    expect(Overlay).toContain('paddingBottom: kb.bottom ? SP.wide : "max(12px, env(safe-area-inset-bottom))"');
    // The no-footer sheet: its scroller is absolutely placed (padding cannot
    // move it), so the scroller is inset and the sheet paints under it.
    expect(Overlay).toContain('position: "absolute", top: 0, left: 0, right: 0, bottom: kb.bottom');
    expect(Overlay).toMatch(/className=\{sheetCls\} style=\{\{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, background: "var\(--bg-sheet-mobile\)" \}\}/);
    // The scrims pad, so a card centres in what is visible.
    expect(Overlay).toContain("paddingBottom: SP.wide + kb.bottom");
    expect(Overlay).toContain("paddingBottom: scrimPad + (mob ? 0 : kb.bottom)");
    // No top inset anywhere (v18.3.1: iOS's scroll is already out of innerHeight).
    expect(Overlay).not.toMatch(/kb\.top/);
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
