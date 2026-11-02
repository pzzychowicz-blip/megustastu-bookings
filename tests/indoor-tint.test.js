// tests/indoor-tint.test.js
// v18.14.0 (correction 2): the indoor rows' tint and its switch. What it looks like is
// in REFACTOR_LOG, because that takes a browser. This holds what fails silently: a
// switch stored the wrong way round, which turns the tint off for every device, half
// a row painted, and a tint reaching the printed sheet.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { appCode } from "./app-source.js";

const read = (f) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
const code = (f) => stripComments(read(f)).join("\n");
const Timeline = code("components/TimelineView.jsx");
const css = read("index.css");

describe("the rows", () => {
  it("are tinted on the grid and in the label column, from one prop", () => {
    expect(Timeline).toMatch(/backgroundColor: indoorTint && indoor \? "var\(--tl-indoor-bg\)" : undefined,/);
    expect(Timeline).toMatch(/dragHover !== id \? \(indoorTint && isIn\(id\) \? "var\(--tl-indoor-bg\)" : undefined\)/);
    expect(Timeline.match(/var\(--tl-indoor-bg\)/g).length).toBe(2);
  });
  it("is a scalar, so the view's memo holds", () => {
    expect(Timeline).toMatch(/indoorTint = true,/);
    expect(appCode()).toMatch(/indoorTint=\{indoorTint\}\n\s+turnBuffer=/);
  });
  it("eases on both parts of the row, or the label snaps while the grid fades", () => {
    expect(Timeline).toMatch(/backgroundColor: indoorTint && indoor[^\n]*\n\s+transition: "height " \+ M\.shift \+ ", background-color " \+ M\.tap/);
  });
  it("is a shade of the indoor purple in both themes, so a new purple moves it", () => {
    expect(css).toMatch(/--tl-indoor-bg: rgba\(var\(--tbl-ind-rgb\), 0\.08\);/);
    expect(css).toMatch(/--tl-indoor-bg: rgba\(var\(--tbl-ind-rgb\), 0\.12\);/);
  });
  it("stays off the printed sheet", () => {
    const sheet = code("components/TimelineSheet.jsx");
    expect(sheet).not.toMatch(/indoorTint/);
    expect(sheet).not.toMatch(/tl-indoor-bg/);
  });
});

describe("the switch is this device's, not the account's", () => {
  const hook = code("hooks/useShellPrefs.js");

  it("is on unless this device turned it off", () => {
    expect(hook).toMatch(/const INDOOR_TINT_KEY="mgt-tl-indoortint";/);
    expect(hook).toMatch(/return localStorage\.getItem\(INDOOR_TINT_KEY\)!=="0";\}catch\{return true;\}/);
  });
  it("stores only the non-default value", () => {
    expect(hook).toMatch(/if\(next\) localStorage\.removeItem\(INDOOR_TINT_KEY\); else localStorage\.setItem\(INDOOR_TINT_KEY,"0"\);/);
  });
  it("never reaches the database, so nothing is added to what is stored", () => {
    const toggle = hook.slice(hook.indexOf("function onToggleIndoorTint"), hook.indexOf("const [appWidth"));
    expect(toggle.length).toBeGreaterThan(0);
    expect(toggle).not.toMatch(/saveUserPrefs/);
  });
  it("has one switch, in the Timeline group beside Larger text", () => {
    const settings = code("components/Settings.jsx");
    expect(settings).toMatch(/<Toggle label="Tint indoor tables" on=\{indoorTint\} onClick=\{onToggleIndoorTint\} \/>/);
    expect(settings.indexOf('label="Tint indoor tables"')).toBeGreaterThan(settings.indexOf('label="Larger text"'));
    expect(settings.indexOf('label="Tint indoor tables"')).toBeLessThan(settings.indexOf('"zoom when opening the app"'));
  });
});
