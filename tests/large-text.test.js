// tests/large-text.test.js
// v18.14.0 (H2): Larger text. What it looks like is in REFACTOR_LOG, because that
// takes a browser. This holds what fails silently: a reader that still has the
// normal size, which draws a block that does not fit its row and no error.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { appCode } from "./app-source.js";

const read = (f) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
const code = (f) => stripComments(read(f)).join("\n");
const Timeline = code("components/TimelineView.jsx");

describe("one geometry, and nothing on the grid reads around it", () => {
  it("ROW_H is read once, by the normal set", () => {
    expect(Timeline.match(/\bROW_H\b/g).length).toBe(2);   // the import, and TL_NORMAL
    expect(Timeline).toMatch(/const TL_NORMAL = \{\s*rowH: ROW_H,/);
  });
  it("no text on the grid names a size outside the two sets and the hour pill's default", () => {
    const body = Timeline.slice(Timeline.indexOf("const TL_LARGE"));
    const rest = body.slice(body.indexOf("};") + 2);
    expect(rest).not.toMatch(/fontSize: T\.(micro|small|body|lead)/);
  });
  it("the widths are read through it", () => {
    const after = Timeline.slice(Timeline.indexOf("const TL_LARGE"));
    const rest = after.slice(after.indexOf("};") + 2);
    expect(rest).not.toMatch(/\b(CHIP_PX|RING_PX|FREE_PX|NAME_MIN_PX|LINE_TWO_PX)\b/);
  });
  it("every block, ghost and blocked bar is handed it", () => {
    expect(Timeline.match(/<TimelineBlock /g).length).toBe(Timeline.match(/<TimelineBlock sz=\{sz\}/g).length);
    expect(Timeline).toMatch(/<WaitGhost\s+sz=\{sz\}/);
    expect(Timeline).toMatch(/<BlockBar key=\{"blk" \+ i\} bl=\{bl\} totalMins=\{totalMins\} sz=\{sz\} \/>/);
  });
  it("is one comparison of a scalar, so the view's memo holds", () => {
    expect(Timeline).toMatch(/const sz = largeText \? TL_LARGE : TL_NORMAL;/);
    expect(appCode()).toMatch(/largeText=\{largeText\}/);
  });
  it("the row's height eases both ways, on every part of the row", () => {
    expect(Timeline).toMatch(/const TL_MOVE = [^\n]*", height " \+ M\.shift/);
    expect(Timeline).toMatch(/const TL_SETTLE = [^\n]*", height " \+ M\.shift/);
    expect(Timeline.match(/transition: "height " \+ M\.shift/g).length).toBeGreaterThanOrEqual(4);
  });
  it("the ring grows with its digits, and the name's row still ignores it", () => {
    expect(Timeline).toMatch(/ring: 22, ringStyle: \{ width: 22, height: 22, fontSize: T\.body \}/);
    expect(Timeline).toMatch(/height: sz\.ring, marginBottom: 2/);
    // 22 less the name's 17 at T.lead is the same 5px as 18 less 13, so one margin
    // holds both sizes. Change either size and this is what must change with it.
    expect(Timeline).toMatch(/marginBlock: -2\.5/);
  });
  it("the print sheet keeps its own geometry", () => {
    const sheet = code("components/TimelineSheet.jsx");
    expect(sheet).not.toMatch(/largeText/);
    expect(sheet).toMatch(/const ROW_H = 26;/);
  });
});

describe("it is this device's, not the account's", () => {
  const hook = code("hooks/useShellPrefs.js");

  it("stores only the non-default value", () => {
    expect(hook).toMatch(/const LARGE_TEXT_KEY="mgt-tl-largetext";/);
    expect(hook).toMatch(/if\(next\) localStorage\.setItem\(LARGE_TEXT_KEY,"1"\); else localStorage\.removeItem\(LARGE_TEXT_KEY\);/);
  });
  it("never reaches the database, so nothing is added to what is stored", () => {
    const toggle = hook.slice(hook.indexOf("function onToggleLargeText"), hook.indexOf("const [appWidth"));
    expect(toggle).not.toMatch(/saveUserPrefs/);
  });
  it("has one switch, in the Timeline group", () => {
    const settings = code("components/Settings.jsx");
    expect(settings).toMatch(/<Toggle label="Larger text" on=\{largeText\} onClick=\{onToggleLargeText\} \/>/);
    expect(settings.indexOf('label="Larger text"')).toBeGreaterThan(settings.indexOf(">Timeline<"));
  });
});
