// tests/compact-shell.test.js
// v18.14.0 (H7): the compact layout's one question, and what hangs off it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { appCode } from "./app-source.js";
import { isCompact, COMPACT_HEIGHT } from "../src/lib/compact-shell";

const read = (f) => stripComments(readFileSync(new URL("../src/" + f, import.meta.url), "utf8")).join("\n");

describe("isCompact", () => {
  it("is the tablet with and without Chrome's bars", () => {
    expect(isCompact(507, false)).toBe(true);
    expect(isCompact(570, false)).toBe(true);
  });
  it("leaves a laptop's browser window alone", () => {
    expect(isCompact(650, false)).toBe(false);
    expect(isCompact(COMPACT_HEIGHT, false)).toBe(false);
    expect(isCompact(COMPACT_HEIGHT - 1, false)).toBe(true);
  });
  it("is never a phone, which has its own layout", () => {
    expect(isCompact(507, true)).toBe(false);
  });
});

describe("the toolbar has one home at a time", () => {
  const App = appCode();
  const Timeline = read("components/TimelineView.jsx");
  const SummarySrc = read("components/Summary.jsx");

  it("folds on a lone Timeline only, so a split's panes keep their own", () => {
    expect(App).toMatch(/const toolbarFolded=compact&&!split&&view==="timeline";/);
  });
  it("the card drops its row exactly when the header and the Summary take it", () => {
    expect(Timeline).toMatch(/\{toolbarFolded \? null : \(/);
    expect(App).toMatch(/show=\{toolbarFolded\}/);
    expect(App).toMatch(/showOptimiser=\{toolbarFolded&&viewDate===todayStr\(\)\}/);
  });
  it("the Summary takes scalars and stable functions, never an element (its memo)", () => {
    expect(App).not.toMatch(/optimiser=\{</i);
    expect(SummarySrc).toMatch(/<OptimiserControls autoOptimizer=\{autoOptimizer\}/);
  });
  it("the 9px drop does not apply, with nothing taller to centre against", () => {
    expect(App).toMatch(/const dateCtrlShift=\(compact\|\|/);
  });
});
