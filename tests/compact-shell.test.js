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

describe("the installed app's top strip covers padding, never the header", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

  // v18.14.2: `.mgt-edge` paints over the page in an installed app, so a shell
  // with less top padding than the strip's height loses the top of its buttons.
  // The Chrome tab has no strip, which is how 8px got through v18.14.0.
  it("every shell's top padding is at least the strip's height", () => {
    const strip = Number(css.match(/\.mgt-edge \{[^}]*?\bheight: (\d+)px/)[1]);
    const shell = appCode().match(/padding:isMobile\?"(\d+)px [^"]*":compact\?"(\d+)px [^"]*":"(\d+)px"/);
    expect(shell).not.toBeNull();
    const [, phone, compact, roomy] = shell.map(Number);
    expect(phone).toBeGreaterThanOrEqual(strip);
    expect(compact).toBeGreaterThanOrEqual(strip);
    expect(roomy).toBeGreaterThanOrEqual(strip);
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
  // v18.14.2 (Patryk): a phone wraps Follow and zoom under the Optimiser, and alone on
  // a line `space-between` leaves an item at the start.
  it("keeps Follow and zoom on the right when they wrap to a line of their own", () => {
    expect(Timeline).toContain('<div style={{ marginLeft: "auto" }}>{zoomBtns}</div>');
  });
  it("the Summary takes scalars and stable functions, never an element (its memo)", () => {
    expect(App).not.toMatch(/optimiser=\{</i);
    expect(SummarySrc).toMatch(/<OptimiserControls autoOptimizer=\{autoOptimizer\}/);
  });
  it("the 9px drop does not apply, with nothing taller to centre against", () => {
    expect(App).toMatch(/const dateCtrlShift=\(compact\|\|/);
  });
});
