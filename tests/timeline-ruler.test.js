// tests/timeline-ruler.test.js
// v18.14.0 (H6): the sticky hour ruler. Live behaviour is in REFACTOR_LOG (it needs
// a browser); this holds the parts of the mechanism that fail silently.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { appCode } from "./app-source.js";
import { scrollBounds } from "../src/lib/edge-scroll.js";

const read = (f) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
const code = (f) => stripComments(read(f)).join("\n");

describe("the ruler is one strip, kept over the grid's minute", () => {
  const Timeline = code("components/TimelineView.jsx");

  it("sticks, and is what a drag's edge scroll looks for", () => {
    expect(Timeline).toMatch(/data-sticky-top="" style=\{\{\s*position: "sticky"/);
  });
  it("is painted above the grid and not inside it, whose scroller clips both axes", () => {
    expect(Timeline.indexOf("{ruler}")).toBeGreaterThan(-1);
    expect(Timeline.indexOf("{ruler}")).toBeLessThan(Timeline.indexOf("{labelCol}"));
    expect(Timeline).not.toMatch(/\{headerLabels\}\s*<\/div>\s*\{unplacedGrid\}/);
  });
  it("shares the grid's side padding, so one scrollLeft means one minute", () => {
    expect(Timeline).toMatch(/ref=\{rulerClipRef\} style=\{\{ flex: 1, minWidth: 0, overflow: "hidden", padding: "0 8px" \}\}/);
    expect(Timeline).toMatch(/overflowY: "hidden", padding: "0 8px 8px"/);
  });
  it("is told of every way the grid scrolls", () => {
    const both = String.raw`syncRuler\(scrollRef\.current, rulerClipRef\.current\);`;
    // v18.16.0: the scroll handler's half that the ruler needs is `syncGridScroll`,
    // because a time drag's edge scroll writes scrollLeft from a frame loop and
    // calls it in that frame.
    expect(Timeline).toMatch(new RegExp(String.raw`function syncGridScroll\(\) \{[\s\S]*?` + both + String.raw`\s*\}\s*function onGridScroll\(\) \{\s*syncGridScroll\(\);`));
    expect(Timeline).toMatch(/sc\.scrollLeft = Math\.min\(before \+ next\.step, d\.sxMax\);[\s\S]{0,260}?if \(syncGridScroll\) syncGridScroll\(\);/);
    expect(Timeline).toContain("syncGridScroll={syncGridScroll}");
    expect(Timeline).toMatch(/el\.scrollLeft = fraction \* el\.scrollWidth;\s*syncRuler\(el, rulerClipRef\.current\);/);
    expect(Timeline).toMatch(new RegExp(String.raw`scrollRef\.current\.scrollLeft = scrollPosRef\.current;\s*` + both));
    expect(Timeline).toMatch(new RegExp(String.raw`useLayoutEffect\(\(\) => \{\s*` + both + String.raw`\s*\}, \[gridW, date\]\);`));
  });
});

describe("what the sticking depends on", () => {
  it("no scroller it sticks to carries top padding: Chrome measures from inside it", () => {
    expect(appCode()).not.toMatch(/paddingInline:"4%",paddingBlock/);
    expect(code("components/SplitLayout.jsx")).not.toMatch(/paddingBlock/);
  });
  it("SlideView clips without becoming a scroll container", () => {
    const atoms = code("components/atoms.jsx");
    const slide = atoms.slice(atoms.indexOf("export function SlideView"), atoms.indexOf("useFlip", atoms.indexOf("export function SlideView")));
    expect(slide).toMatch(/overflow: animating \? "clip" : "visible"/);
    expect(slide).not.toMatch(/"hidden"/);
  });
  it("its ground is opaque in both themes: rows pass under it", () => {
    const css = read("index.css");
    const values = [...css.matchAll(/--tl-ruler-bg:\s*([^;]+);/g)].map((m) => m[1]);
    expect(values.length).toBe(2);
    for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("scrollBounds: the top of the band under a stuck ruler", () => {
  afterEach(() => vi.unstubAllGlobals());
  function scrollerWith(rulerRect) {
    vi.stubGlobal("window", { innerHeight: 570 });
    vi.stubGlobal("document", { querySelector: () => null, body: {}, documentElement: {}, scrollingElement: {} });
    return {
      getBoundingClientRect: () => ({ top: 104, bottom: 570 }),
      querySelector: () => ({ getBoundingClientRect: () => rulerRect }),
    };
  }
  it("starts below it while it is stuck", () => {
    expect(scrollBounds(scrollerWith({ top: 100, bottom: 128 })).top).toBe(128);
  });
  it("ignores it at rest, further down the page", () => {
    expect(scrollBounds(scrollerWith({ top: 162, bottom: 190 })).top).toBe(104);
  });
});
