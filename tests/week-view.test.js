// tests/week-view.test.js — v18.2.0, the design critique's X2 (and the X3 + S3
// phase after it): the Week / Month / Stats popover.
//
// X2, measured on DEV: the month's day cells were rgba(255,255,255,0.5) over a
// translucent sheet, so the page behind the modal coloured the calendar —
// days 18–20 and 25–27 amber over the Timeline, grey over the List — and the
// blue busyness shading had no key. After: every cell rgb(251, 252, 253)
// (light) at opacity 1, the out-of-month days fading only their number (0.4),
// and "Fewer covers ▭ More" under the grid.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Week = read("components/WeekView.jsx");
const CSS = readFileSync(join(SRC, "index.css"), "utf8");

describe("X2 — the calendar is opaque, and its shading has a key", () => {
  it("defines an opaque cell in both themes", () => {
    const light = CSS.slice(0, CSS.indexOf('[data-theme="dark"] {'));
    const dark = CSS.slice(CSS.indexOf('[data-theme="dark"] {'));
    expect(light).toMatch(/--bg-cal-cell: #[0-9a-f]{6};/);
    expect(dark).toMatch(/--bg-cal-cell: #[0-9a-f]{6};/);
  });

  it("paints every cell with it, and none with the translucent input fill", () => {
    expect(Week).toMatch(/const CELL = "var\(--bg-cal-cell\)";/);
    expect(Week).not.toMatch(/background: "var\(--bg-input\)"/);
  });

  it("fades an out-of-month day's number, never the cell, which would be see-through again", () => {
    expect(Week).not.toMatch(/opacity: c\.inMonth \? 1 : 0\.4/);
    expect(Week).toMatch(/<div style=\{\{ position: "relative", opacity: c\.inMonth \? 1 : OUT_OF_MONTH \}\}>/);
  });

  it("draws the key from the SAME scale the cells use", () => {
    expect(Week).toMatch(/opacity: intensity \* HEAT/);
    expect(Week).toMatch(/color-mix\(in srgb, var\(--accent\) " \+ \(HEAT \* 100\) \+ "%, " \+ CELL \+ "\)\)"/);
    expect(Week).toMatch(/<span>Fewer covers<\/span>/);
  });
});
