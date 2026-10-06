// tests/print-timeline.test.js
//
// v18.4.0 — the printed timeline (components/TimelineSheet.jsx, the print
// chooser, the `data-print` switch in index.css).

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { stripComments } from "../scripts/strip-comments.mjs";
import { PRINT_FILL, spanIn, printRange } from "../src/lib/print-timeline.js";

const raw = (rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
const code = (rel) => stripComments(raw(rel)).join("\n");
const css = raw("src/index.css");

describe("the printed status colours are the light theme's", () => {
  // Print stays light in any theme, so the sheet cannot use `var(--block-*)`:
  // under the dark theme those resolve to the dark values. A literal copy of
  // the light ones is the kind of copy that drifts, so each is held to `:root`.
  const root = css.slice(css.indexOf(":root"), css.indexOf('[data-theme="dark"] {'));
  for (const st of Object.keys(PRINT_FILL)) {
    it(st, () => {
      const m = root.match(new RegExp("--block-" + st + ":\\s*([^;]+);"));
      expect(m, "--block-" + st + " in :root").not.toBeNull();
      expect(PRINT_FILL[st]).toBe(m[1].trim());
    });
  }
  it("covers every status the sheet draws, and not cancelled", () => {
    expect(Object.keys(PRINT_FILL).sort()).toEqual(["completed", "confirmed", "pending", "seated"]);
  });
});

describe("spanIn: a span in percent of the printed range", () => {
  const F = 13 * 60, T = 23 * 60;
  it("inside the range", () => {
    expect(spanIn(18 * 60, 19.5 * 60, F, T)).toEqual({ left: 50, width: 15, cutL: false, cutR: false });
  });
  it("cut by either end, and says which", () => {
    expect(spanIn(12 * 60, 14 * 60, F, T)).toEqual({ left: 0, width: 10, cutL: true, cutR: false });
    expect(spanIn(22 * 60, 24 * 60, F, T)).toEqual({ left: 90, width: 10, cutL: false, cutR: true });
  });
  it("outside it, touching it, or on an empty range: nothing", () => {
    expect(spanIn(10 * 60, 12 * 60, F, T)).toBeNull();
    expect(spanIn(11 * 60, 13 * 60, F, T)).toBeNull();
    expect(spanIn(23 * 60, 24 * 60, F, T)).toBeNull();
    expect(spanIn(14 * 60, 15 * 60, F, F)).toBeNull();
    expect(spanIn(NaN, 15 * 60, F, T)).toBeNull();
  });
});

describe("printRange: what the chooser opens with", () => {
  const H = { open: 13, close: 22, gridClose: 23 };
  it("opening to closing", () => {
    expect(printRange(H, 0)).toEqual({ from: 13, to: 22, min: 13, max: 23 });
    expect(printRange(H, NaN)).toEqual({ from: 13, to: 22, min: 13, max: 23 });
  });
  it("to the end of a booking that runs past closing, rounded up", () => {
    expect(printRange(H, 23 * 60 + 45)).toEqual({ from: 13, to: 24, min: 13, max: 24 });
  });
  it("never an empty range, never past the grid's limit", () => {
    expect(printRange({ open: 13, close: 13, gridClose: 14 }, 0).to).toBe(14);
    expect(printRange(H, 40 * 60).to).toBe(26);
  });
});

describe("which sheet prints", () => {
  const print = css.slice(css.lastIndexOf("@media print"));
  it("no attribute prints the day sheet, as the browser's own print always did", () => {
    expect(print).toMatch(/\.mgt-print-sheet \{ display: block !important; \}/);
    expect(css).toMatch(/\.mgt-print-timeline \{ display: none; \}/);
  });
  it("timeline hides the day sheet; timeline and both show the grid", () => {
    expect(print).toMatch(/html\[data-print="timeline"\] \.mgt-print-sheet \{ display: none !important; \}/);
    expect(print).toMatch(/html\[data-print="timeline"\] \.mgt-print-timeline,\s*html\[data-print="both"\] \.mgt-print-timeline \{\s*display: block !important;/);
  });
  it("the page is free to paginate: App's inline height and overflow are lifted", () => {
    // Measured in Chrome's PDF output: with them, a 120-booking day sheet
    // printed one page of four, and no page break took effect.
    expect(print).toMatch(/html, body \{ height: auto !important; overflow: visible !important; \}/);
    expect(print).toMatch(/break-before: page;/);
  });
  it("the fills are printed, on a landscape page of the grid's own", () => {
    expect(print).toMatch(/print-color-adjust: exact;/);
    expect(print).toMatch(/page: mgt-timeline;/);
    expect(print).toMatch(/@page mgt-timeline \{ size: A4 landscape;/);
  });
});

describe("the print call", () => {
  const app = code("src/App.jsx");
  const fn = app.slice(app.indexOf("function doPrint(job){"), app.indexOf("const printModal="));
  it("mounts the sheet, stamps the kind, then prints, inside the click", () => {
    const order = ["flushSync(function(){setPrintJob(job);});", 'setAttribute("data-print",job.kind)', "window.print();"].map((s) => fn.indexOf(s));
    expect(order.every((i) => i >= 0), "all three steps").toBe(true);
    expect(order).toEqual(order.slice().sort((a, b) => a - b));
  });
  it("afterprint takes the attribute and the sheet back", () => {
    expect(app).toMatch(/function done\(\)\{document\.documentElement\.removeAttribute\("data-print"\);setPrintJob\(null\);\}\s*window\.addEventListener\("afterprint",done\);/);
  });
  it("the timeline is mounted only for a print that asked for it", () => {
    expect(app).toMatch(/const TimelineSheet=printJob&&printJob\.kind!=="sheet"\?printJob\.Sheet:null;/);
  });
  it("neither the chooser nor the sheet is in the startup bundle", () => {
    expect(app).not.toMatch(/import \{[^}]*\} from "\.\/components\/(PrintModal|TimelineSheet)"/);
    expect(app).toMatch(/const PrintModal = lazyChunk\(function\(\)\{return import\("\.\/components\/PrintModal"\)/);
    expect(code("src/components/PrintModal.jsx")).toMatch(/Sheet: TimelineSheet/);
  });
  it("the Summary's Print opens the chooser through the ref, with the viewed day's range", () => {
    expect(app).toMatch(/onPrint:function\(\)\{R\.current\.openPrint\(\);\}/);
    expect(app).toMatch(/function openPrint\(\)\{setPrintAsk\(printRange\(hoursFor\(viewDate\),viewLatestEnd\)\);\}/);
  });
});

describe("the sheet", () => {
  const sheet = code("src/components/TimelineSheet.jsx");
  it("draws the screen's flags and the screen's unplaced rule", () => {
    expect(sheet).toMatch(/import \{ railFlagsOf \} from "\.\/blockFlags";/);
    expect(sheet).toMatch(/packLanes\(unplacedOf\(day, gridIds\)/);
  });
  it("holds no theme token: print stays light", () => {
    expect(sheet).not.toMatch(/var\(--/);
  });
  it("a print of the timeline alone is named for it", () => {
    expect(code("src/components/DaySheet.jsx")).toMatch(/getAttribute\("data-print"\) === "timeline" \? "mgt-timeline" : "mgt-day-sheet"/);
  });
});
