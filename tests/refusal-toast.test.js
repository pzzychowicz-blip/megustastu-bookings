// tests/refusal-toast.test.js — v18.4.5
//
// The refusal toast is drawn above every modal. It was one of StatusToasts'
// one-slot toasts, at z-index 60 inside the main view, so a tap refused from
// inside a dialog (z 200 and up) drew its answer under the dialog.
//
// What is guarded here is the set of facts that make "above every modal" true
// and keep it true: the layer's z-index against EVERY z-index the app writes
// (counted from the source, not from a list in this file), where it is mounted,
// and that the old slot is gone, so there is one refusal toast and not two.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { toastBox } from "../src/lib/toast-box.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|css)$/.test(n) ? [p] : [];
});

const Layer = read("components/RefusalToast.jsx");
const Toasts = read("components/StatusToasts.jsx");
const App = read("App.jsx");

describe("toastBox", () => {
  it("is the anchor's own box, rounded", () => {
    expect(toastBox({ top: 151.6, left: 12.2, width: 1000.4 }, 1024)).toEqual({ top: 152, left: 12, width: 1000 });
  });
  it("never puts the toast above the viewport (a scrolled, non-fixed shell)", () => {
    expect(toastBox({ top: -340, left: 16, width: 800 }, 832).top).toBe(0);
  });
  it("falls back to the viewport's width with no anchor, or one with no width", () => {
    expect(toastBox(null, 390)).toEqual({ top: 0, left: 0, width: 390 });
    expect(toastBox({ top: 90, left: 40, width: 0 }, 390)).toEqual({ top: 0, left: 0, width: 390 });
    expect(toastBox(undefined, NaN)).toEqual({ top: 0, left: 0, width: 0 });
  });
});

describe("the refusal layer", () => {
  const z = Number((Layer.match(/const REFUSAL_Z\s*=\s*(\d+)/) || [])[1]);

  it("is above every other z-index written under src/", () => {
    expect(z).toBeGreaterThan(0);
    const others = [];
    for (const file of walk(SRC)) {
      if (file.endsWith("RefusalToast.jsx")) continue;
      // CSS is read raw: stripComments is the JS stripper.
      const text = file.endsWith(".css") ? readFileSync(file, "utf8") : stripComments(readFileSync(file, "utf8")).join("\n");
      for (const m of text.matchAll(/z-?index["']?\s*:\s*["']?(\d+)/gi)) others.push(Number(m[1]));
    }
    // The scan has to be finding things, or "above everything" is vacuous: the
    // popup scrim (300) and its cards (301) are the top of the app's ladder.
    expect(others).toContain(300);
    expect(others).toContain(301);
    expect(Math.max(...others)).toBeLessThan(z);
  });

  it("is fixed, takes no taps, is a live region, and blurs nothing", () => {
    expect(Layer).toMatch(/position:\s*"fixed"/);
    expect(Layer).toMatch(/pointerEvents:\s*"none"/);
    expect(Layer).toMatch(/role="status"/);
    expect(Layer).toMatch(/aria-live="polite"/);
    expect(Layer).toMatch(/zIndex:\s*REFUSAL_Z/);
    expect(Layer).not.toMatch(/backdrop/i);
  });

  it("is mounted once, always, outside <main> and outside the inert view", () => {
    expect(App.match(/<RefusalToast\b/g)).toHaveLength(1);
    const at = App.indexOf("<RefusalToast");
    // Unconditional: the element is not the branch of a ternary or an `&&`.
    expect(App.slice(at - 3, at)).not.toMatch(/[?:&]\s*$/);
    expect(at).toBeGreaterThan(App.lastIndexOf("</main>"));
    expect(App.slice(at)).not.toMatch(/<\/main>/);
  });

  it("is the ONLY refusal toast: StatusToasts no longer has the slot", () => {
    expect(Toasts).not.toMatch(/permMsg|permmsg/);
    expect(App).not.toMatch(/permMsg=\{/);
  });

  it("keeps the text and the box while it fades out", () => {
    // The timer turns `show` off; it must not null the message, or the pill
    // would jump to the corner and empty during its exit.
    const flash = App.slice(App.indexOf("function flashRefusal"), App.indexOf("function refused"));
    expect(flash).toMatch(/show:\s*false/);
    expect(flash).not.toMatch(/setPermMsg\(null\)/);
    expect(flash).toMatch(/toastBox\(/);
  });
});
