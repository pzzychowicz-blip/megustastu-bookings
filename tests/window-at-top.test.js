// tests/window-at-top.test.js — v18.4.2
//
// iOS scrolls the WINDOW to show a focused field and can leave it scrolled
// when the keyboard closes; a dialog opened then is drawn cut off and the app
// sits above the screen (src/hooks/useWindowAtTop.js). The arithmetic is fed
// the numbers the iOS 27 Simulator reported (REFACTOR_LOG v18.4.2), and the
// wiring is read from the source. Comments stripped (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { windowStrayOf } from "../src/hooks/useWindowAtTop.js";
import { keyboardInsetOf, KB_MIN } from "../src/hooks/useKeyboardInset.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => stripComments(readFileSync(join(ROOT, ...p), "utf8")).join("\n");
const App = read("src", "App.jsx");
const Hook = read("src", "hooks", "useWindowAtTop.js");

const win = (full, height, top, scrollY) => ({ scrollY, document: { documentElement: { clientHeight: full } }, visualViewport: { height, pageTop: top, offsetTop: top } });

describe("the window is not left scrolled once the keyboard is down", () => {
  it("is not stray without a window, a visualViewport or a document", () => {
    expect(windowStrayOf(null)).toBe(false);
    expect(windowStrayOf({ scrollY: 249 })).toBe(false);
    expect(windowStrayOf({ scrollY: 249, visualViewport: { height: 894 } })).toBe(false);
  });

  it("is stray in the measured state: the keyboard closed and scrollY stayed at 249", () => {
    expect(windowStrayOf(win(894, 894, 249, 249))).toBe(true);
  });

  it("leaves iOS's own scroll alone while the keyboard is up (scrollY 374 under a 479px visible area)", () => {
    const up = win(894, 479, 374, 374);
    expect(windowStrayOf(up)).toBe(false);
    expect(894 - 479).toBeGreaterThan(KB_MIN);
    expect(keyboardInsetOf(up)).toEqual({ bottom: 41 });
  });

  it("is not stray at the top, with or without a keyboard", () => {
    expect(windowStrayOf(win(894, 894, 0, 0))).toBe(false);
    expect(windowStrayOf(win(894, 479, 0, 0))).toBe(false);
  });

  it("leaves the rubber-band at the top alone (a negative scrollY)", () => {
    expect(windowStrayOf(win(894, 894, 0, -40))).toBe(false);
  });

  it("treats a toolbar-sized gap as no keyboard, as the inset does", () => {
    expect(windowStrayOf(win(762, 762 - KB_MIN, 50, 50))).toBe(true);
    expect(windowStrayOf(win(762, 762 - KB_MIN - 1, 50, 50))).toBe(false);
  });

  it("reads Android as never stray: the layout viewport shrinks and the window does not scroll", () => {
    expect(windowStrayOf(win(231, 231, 0, 0))).toBe(false);
  });
});

describe("the wiring", () => {
  it("BookingApp calls the hook", () => {
    expect(App).toMatch(/import \{ useWindowAtTop \} from "\.\/hooks\/useWindowAtTop";/);
    expect(App.match(/\buseWindowAtTop\(\);/g)).toHaveLength(1);
  });

  it("the hook listens for the keyboard closing and for the scroll itself, and measures once on mount", () => {
    expect(Hook).toMatch(/vv\.addEventListener\("resize", settle\)/);
    expect(Hook).toMatch(/vv\.addEventListener\("scroll", settle\)/);
    expect(Hook).toMatch(/window\.addEventListener\("scroll", settle, \{ passive: true \}\)/);
    expect(Hook).toMatch(/if \(windowStrayOf\(window\)\) window\.scrollTo\(0, 0\);/);
    expect(Hook.match(/removeEventListener/g)).toHaveLength(3);
  });

  it("never reads innerHeight, which moves with the page scroll on iOS (v18.3.5)", () => {
    expect(Hook).not.toMatch(/innerHeight/);
  });
});
