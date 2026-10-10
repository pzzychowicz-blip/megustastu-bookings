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
import { keyboardInsetOf, coveredTopOf } from "../src/hooks/useKeyboardInset.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const Atoms = stripComments(read("src", "components", "atoms.jsx")).join("\n");
const App = stripComments(read("src", "App.jsx")).join("\n");
const Overlay = Atoms.slice(Atoms.indexOf("export function Overlay("), Atoms.indexOf("\n}\n", Atoms.indexOf("export function Overlay(")));

// `full` is the root element's clientHeight, which the keyboard does not move
// on iOS; `top` is how far the visual viewport sits down the page.
const win = (full, height, top) => ({ document: { documentElement: { clientHeight: full } }, visualViewport: { height, pageTop: top, offsetTop: top } });

// v18.4.2: the layout viewport moved with the window's scroll, so the two
// offsets differ. iOS 27 simulator, home-screen app, Lock navigation off, the
// WhatsApp reply box focused: the panel's rect was [-415, 479].
describe("v18.4.2: a fixed box is measured against the LAYOUT viewport", () => {
  const moved = { document: { documentElement: { clientHeight: 894 } }, visualViewport: { height: 479, offsetTop: 415, pageTop: 614 } };
  it("pads the top by offsetTop, not by pageTop", () => {
    expect(coveredTopOf(moved)).toBe(415);
  });
  it("the same on Patryk's iPhone 12 mini (home-screen app): rect [-405, 357], pageTop 544", () => {
    const phone = { document: { documentElement: { clientHeight: 762 } }, visualViewport: { height: 357, offsetTop: 405, pageTop: 544 } };
    expect(coveredTopOf(phone)).toBe(405);
    expect(keyboardInsetOf(phone)).toEqual({ bottom: 0 });
  });
  it("and the bottom is not covered there", () => {
    expect(keyboardInsetOf(moved)).toEqual({ bottom: 0 });
  });
  it("counts what is covered below when the layout viewport moved part of the way", () => {
    const part = { document: { documentElement: { clientHeight: 894 } }, visualViewport: { height: 479, offsetTop: 100, pageTop: 300 } };
    expect(keyboardInsetOf(part)).toEqual({ bottom: 315 });
    expect(coveredTopOf(part)).toBe(100);
  });
  it("falls back to pageTop where offsetTop is missing", () => {
    expect(coveredTopOf({ document: { documentElement: { clientHeight: 664 } }, visualViewport: { height: 325, pageTop: 339 } })).toBe(339);
  });
});

describe("N1: the keyboard's inset, from the visual viewport", () => {
  it("is nothing without a window, a visualViewport or a document", () => {
    expect(keyboardInsetOf(null)).toEqual({ bottom: 0 });
    expect(keyboardInsetOf({ innerHeight: 800 })).toEqual({ bottom: 0 });
    expect(keyboardInsetOf({ visualViewport: { height: 300, pageTop: 0 } })).toEqual({ bottom: 0 });
  });

  it("is nothing for a gap a browser toolbar makes", () => {
    // Only a gap over 100px is a keyboard, so a toolbar showing or hiding
    // never moves a dialog.
    expect(keyboardInsetOf(win(796, 796, 0))).toEqual({ bottom: 0 });
    expect(keyboardInsetOf(win(796, 740, 0))).toEqual({ bottom: 0 });
    expect(keyboardInsetOf(win(796, 696, 0))).toEqual({ bottom: 0 });
  });

  it("is the keyboard's height, as the iPhone Simulator reported it", () => {
    // Safari, iOS 26: the visual viewport fell from 796 to 447.
    expect(keyboardInsetOf(win(796, 447, 0))).toEqual({ bottom: 349 });
  });

  it("counts a scroll iOS made for the field ONCE (v18.3.1, a real iPhone 12 mini)", () => {
    // Name first, no scroll: the sheet padded 339 and the footer sat on the bar.
    expect(keyboardInsetOf(win(664, 325, 0))).toEqual({ bottom: 339 });
    // Notes with the keyboard down: iOS scrolled 243px (innerHeight 421).
    expect(keyboardInsetOf(win(664, 325, 243))).toEqual({ bottom: 96 });
    // The voucher box: a 57px scroll.
    expect(keyboardInsetOf(win(664, 325, 57))).toEqual({ bottom: 282 });
    // The Simulator's 32px scroll (v18.3.0 phase 17).
    expect(keyboardInsetOf(win(796, 447, 32))).toEqual({ bottom: 317 });
  });

  it("v18.3.5: the settled states measured in the home-screen app and in Safari", () => {
    // [clientHeight, viewport height, pageTop] → the padding that put the
    // footer on the visible bottom in each sample.
    expect(keyboardInsetOf(win(762, 357, 0))).toEqual({ bottom: 405 });    // app: Name
    expect(keyboardInsetOf(win(762, 357, 194))).toEqual({ bottom: 211 });  // app: Notes, scrolled 194
    expect(keyboardInsetOf(win(762, 383, 255))).toEqual({ bottom: 124 });  // app: Deposit's digit pad, scrolled 255
    expect(keyboardInsetOf(win(664, 325, 134))).toEqual({ bottom: 205 });  // Safari: Notes
    expect(keyboardInsetOf(win(664, 351, 195))).toEqual({ bottom: 118 });  // Safari: Deposit
  });

  it("v18.3.5: does not read innerHeight, which moves apart from the viewport", () => {
    // Way (b): the visual viewport panned 26px with the window NOT scrolled, so
    // innerHeight stayed 664. innerHeight − height (v18.3.1) padded 340 and put
    // the footer 26px above the keyboard; the covered part is 314.
    const panned = Object.assign(win(664, 324, 26), { innerHeight: 664 });
    expect(keyboardInsetOf(panned)).toEqual({ bottom: 314 });
    // Mid-change: innerHeight already back at 664 while the viewport still read
    // a 195px offset. Whatever innerHeight says, the answer is the same.
    [664, 469, 0, undefined].forEach((innerHeight) => {
      expect(keyboardInsetOf(Object.assign(win(664, 351, 195), { innerHeight }))).toEqual({ bottom: 118 });
    });
    const Hook = stripComments(read("src", "hooks", "useKeyboardInset.js")).join("\n");
    expect(Hook).not.toContain("innerHeight");
  });

  it("v18.3.5: measures once on subscribing, for an event lost before the effect", () => {
    const Hook = stripComments(read("src", "hooks", "useKeyboardInset.js")).join("\n");
    const effect = Hook.slice(Hook.indexOf("useEffect("));
    expect(effect.indexOf("measure();")).toBeGreaterThan(effect.indexOf('vv.addEventListener("scroll", measure);'));
    expect(effect.indexOf("measure();")).toBeLessThan(effect.indexOf("return function"));
  });

  it("judges the keyboard on its whole height, but pads only what is left", () => {
    // 96px of inset is under the 100px toolbar threshold by itself; the
    // keyboard it belongs to (339) is not.
    expect(keyboardInsetOf(win(664, 325, 243))).toEqual({ bottom: 96 });
    // Scrolled by the whole keyboard: the sheet already ends at the bar.
    expect(keyboardInsetOf(win(664, 325, 339))).toEqual({ bottom: 0 });
    // A small scroll with no keyboard is still nothing.
    expect(keyboardInsetOf(win(780, 700, 40))).toEqual({ bottom: 0 });
  });

  it("v18.4.0: says how much of a full-screen box iOS moved above the visible area", () => {
    // Patryk's iPhone, the WhatsApp reply box focused: Safari, then the app.
    expect(coveredTopOf(win(664, 325, 339))).toBe(339);
    expect(coveredTopOf(win(762, 357, 405))).toBe(405);
    // On the way there (innerHeight 392, the page 272 down).
    expect(coveredTopOf(win(664, 325, 272))).toBe(272);
    // Keyboard up and nothing moved; no keyboard; Android; no window.
    expect(coveredTopOf(win(664, 325, 0))).toBe(0);
    expect(coveredTopOf(win(780, 700, 40))).toBe(0);
    expect(coveredTopOf(win(289, 289, 0))).toBe(0);
    expect(coveredTopOf(null)).toBe(0);
  });
  it("v18.4.0: the panel on a phone pads its top by it, and the hook carries both", () => {
    expect(Overlay).toContain("paddingTop: mob ? kb.top : 0,");
    const hook = stripComments(read("src", "hooks", "useKeyboardInset.js")).join("\n");
    expect(hook).toContain("return { bottom: keyboardInsetOf(win).bottom, top: coveredTopOf(win) };");
    expect(hook).toContain("prev.bottom === next.bottom && prev.top === next.top ? prev : next");
  });

  it("is nothing where the keyboard resizes the layout viewport itself (Android)", () => {
    // interactive-widget=resizes-content shrinks the root with the keyboard.
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
    // v18.4.0: with the inset it is still SP.wide; only the uncovered case slims while typing.
    expect(Overlay).toContain('paddingBottom: kb.bottom ? SP.wide : (tight ? SP.snug : "max(12px, env(safe-area-inset-bottom))")');
    // The no-footer sheet: its scroller is absolutely placed (padding cannot
    // move it), so the scroller is inset and the sheet paints under it.
    expect(Overlay).toContain('position: "absolute", top: 0, left: 0, right: 0, bottom: kb.bottom');
    expect(Overlay).toMatch(/className=\{sheetCls\} style=\{\{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, background: "var\(--bg-sheet-mobile\)" \}\}/);
    // The scrims pad, so a card centres in what is visible.
    expect(Overlay).toContain("paddingBottom: SP.wide + kb.bottom");
    expect(Overlay).toContain("paddingBottom: scrimPad + (mob ? 0 : kb.bottom)");
    // One top inset, the phone panel's padding (v18.4.0, below). The sheets
    // and cards take none: their bodies scroll and iOS places the field.
    expect(Overlay.match(/kb\.top/g)).toHaveLength(1);
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

describe("v18.4.0: a footed dialog makes room while a field is typed into on a short screen", () => {
  it("is tight only for a focused text field AND a short viewport", () => {
    expect(Overlay).toMatch(/const short = useShortViewport\(\);/);
    expect(Overlay).toMatch(/const tight = short && !!field;/);
    expect(Overlay).toMatch(/if \(raisesKeyboard\(e\.target\)\) setField\(e\.target\);/);
  });

  it("does not grow the footer back under a finger pressing Save", () => {
    expect(Overlay).toMatch(/if \(!\(e\.relatedTarget && e\.currentTarget\.contains\(e\.relatedTarget\)\)\) setField\(null\);/);
  });

  it("slims both footers, eased", () => {
    expect(Overlay).toContain('padding: tight ? "6px 24px" : "16px 24px", transition: "padding " + M.shift');
    expect(Overlay).toContain('paddingTop: tight ? SP.snug : SP.wide');
    // Both footed dialogs take the focus handlers; the panel and the bare sheet do not.
    expect(Overlay.match(/\{\.\.\.typingProps\}/g)).toHaveLength(2);
  });

  // v18.6.0: Find a booking gives its Done row up while typing on a short
  // screen. Measured at the tablet's keyboard-up size (998 × 231): three whole
  // result rows where the list had 83px, and the row back when the field loses
  // the focus.
  it("folds a card's footer away while tight when the caller asks, and never a phone sheet's", () => {
    expect(Overlay).toContain('{footerYields ? <Reveal show={!tight} speed="shift" style={{ flexShrink: 0 }}>{cardFoot}</Reveal> : cardFoot}');
    // once: the sheet's footer is the phone's only way out (no scrim there)
    expect(Overlay.match(/footerYields \?/g)).toHaveLength(1);
    const Search = stripComments(read("src", "components", "SearchPanel.jsx")).join("\n");
    expect(Search).toContain("<Overlay onClose={onClose} footer={footerEl} footerYields maxWidth={FIND_CARD_W}>");
  });

  it("places the focused field with its label, and only where the layout was resized", () => {
    // On iOS the keyboard covers the page and the system places the field
    // (v18.3.5's two ways); a second scroll there was not tried on a device.
    expect(Overlay).toMatch(/if \(!tight \|\| kb\.bottom \|\| !field\) return undefined;/);
    expect(Overlay).toMatch(/const box = field\.closest\("\[" \+ FLD_ATTR \+ "\]"\) \|\| field;/);
    expect(Overlay).toMatch(/behavior: reduceMotionOn\(\) \? "auto" : "smooth"/);
    expect(Atoms).toMatch(/\{\.\.\.\{ \[FLD_ATTR\]: "" \}\}\s*role=\{single \? undefined : "group"\}/);
  });
});
