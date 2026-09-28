// tests/blur-budget.test.js — v18.3.0 phase 11 (A9)
//
// CLAUDE.md's UI rule: at most FOUR simultaneous `backdrop-filter: blur()`.
// It is a real production perf bug on the restaurant's tablet, which once ran
// 51. Nothing counted them. The v18.3.0 census in the rig found SIX live at
// once (Split View + booking form + discard confirm), and two of them were the
// Timeline and Plan view cards, blurring the flat `--bg-app` to no visible
// effect (1/255, both themes). With those gone the worst stack is 4.
//
// A budget is spent at RUNTIME, so no source test can add it up. What one can
// do is make every NEW blurred surface a decision: each file that declares a
// blur is listed here with how many it declares and whose they are, and a
// blur anywhere else fails until somebody has counted it against that stack.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// file (relative to src/) → the number of `backdropFilter` declarations in it.
// Each count is a set of surfaces that are never on screen together more than
// the stack above allows; change one only after re-running that census.
const ALLOWED = {
  // Overlay: the scrim and the card, on each of its paths (panel mode's scrim
  // and panel, the pinned-footer card, the plain card). One modal = 2.
  "components/atoms.jsx": 5,
  // The login card, alone on screen: nothing else renders before sign-in.
  "components/LoginScreen.jsx": 1,
};

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name))
      : /\.jsx?$/.test(e.name) ? [join(dir, e.name)] : []);
}

describe("the blur budget: every backdrop-filter is a counted one", () => {
  it("only the files listed here declare a blur, each exactly as often as listed", () => {
    const found = {};
    for (const f of walk(SRC)) {
      const src = stripComments(readFileSync(f, "utf8")).join("\n");
      // `backdropFilter` and not `WebkitBackdropFilter` (capital B): the
      // prefixed twin always rides on the same line, so it is one surface.
      const n = (src.match(/\bbackdropFilter\s*:/g) || []).length;
      if (n) found[f.slice(SRC.length + 1)] = n;
    }
    expect(found, "a new blurred surface spends the tablet's budget of 4 — count the worst stack in the rig first, then list it here").toEqual(ALLOWED);
  });

  it("the stylesheet declares none", () => {
    // CSS, so read raw: stripComments is the JS/JSX stripper (tests/test-hygiene).
    const css = readFileSync(join(SRC, "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/backdrop-filter\s*:/);
  });

  it("the view cards stay unblurred (v18.3.0, A9)", () => {
    for (const view of ["TimelineView", "PlanView"]) {
      const src = stripComments(readFileSync(join(SRC, "components", view + ".jsx"), "utf8")).join("\n");
      expect(src, view + ": its card sits over the flat --bg-app, where a blur is invisible and still costs one of 4").not.toMatch(/backdropFilter/);
    }
  });
});
