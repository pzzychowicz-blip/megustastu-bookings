// tests/scroll-lock.test.js — v18.4.2
//
// The page behind a phone's sheet is locked by a COUNT and a class
// (src/lib/scroll-lock.js). The saved inline value it replaces went stale when
// two sheets were open at once and left the page unscrollable after Discard.
// Comments stripped (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { lockPageScroll } from "../src/lib/scroll-lock.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const Atoms = stripComments(raw("src", "components", "atoms.jsx")).join("\n");
const Css = raw("src", "index.css").replace(/\/\*[\s\S]*?\*\//g, "");

function fakeDoc() {
  const set = new Set();
  return { set, documentElement: { classList: { add: (c) => set.add(c), remove: (c) => set.delete(c) } } };
}
const locked = (doc) => doc.set.has("mgt-scroll-lock");

describe("lockPageScroll", () => {
  it("locks on the first sheet and unlocks on the last, in either closing order", () => {
    const doc = fakeDoc();
    const form = lockPageScroll(doc);
    const confirm = lockPageScroll(doc);
    expect(locked(doc)).toBe(true);
    form();
    expect(locked(doc)).toBe(true);
    confirm();
    expect(locked(doc)).toBe(false);

    const a = lockPageScroll(doc);
    const b = lockPageScroll(doc);
    b();
    expect(locked(doc)).toBe(true);
    a();
    expect(locked(doc)).toBe(false);
  });

  it("counts a release once, so an effect cleaned up twice cannot unlock another sheet", () => {
    const doc = fakeDoc();
    const a = lockPageScroll(doc);
    const b = lockPageScroll(doc);
    a();
    a();
    expect(locked(doc)).toBe(true);
    b();
    expect(locked(doc)).toBe(false);
  });

  it("does nothing without a document", () => {
    expect(() => lockPageScroll(null)()).not.toThrow();
  });
});

describe("the wiring", () => {
  it("Overlay locks through it and writes no overflow on <body> itself", () => {
    expect(Atoms).toMatch(/if \(!mob\) return undefined;\s*return lockPageScroll\(document\);/);
    expect(Atoms).not.toMatch(/document\.body\.style\.overflow/);
  });

  it("the rule beats the shell's inline overflow, on screen only (print needs the body to run on)", () => {
    expect(Css).toMatch(/@media screen \{\s*html\.mgt-scroll-lock body \{ overflow: hidden !important; \}\s*\}/);
    expect(Css.match(/mgt-scroll-lock/g)).toHaveLength(1);
  });
});
