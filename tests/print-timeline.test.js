// tests/print-timeline.test.js
//
// v18.4.0 — the printed timeline (components/TimelineSheet.jsx, the print
// chooser, the `data-print` switch in index.css).

import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { stripComments } from "../scripts/strip-comments.mjs";
import { PRINT_FILL, spanIn, printRange } from "../src/lib/print-timeline.js";
import { onPrintEnd, PRINT_EARLY_MS, printOrReport, PRINT_IGNORED_MS, PRINT_IGNORED_TEXT } from "../src/lib/print-end.js";

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
    const order = ["flushSync(function(){setPrintJob(job);});", 'setAttribute("data-print",job.kind)', "printOrReport(function(){"].map((s) => fn.indexOf(s));
    expect(order.every((i) => i >= 0), "all three steps").toBe(true);
    expect(order).toEqual(order.slice().sort((a, b) => a - b));
  });
  it("the end of the print takes the attribute and the sheet back", () => {
    expect(app).toMatch(/function done\(\)\{document\.documentElement\.removeAttribute\("data-print"\);setPrintJob\(null\);\}\s*const off=onPrintEnd\(done\);/);
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

describe("the printed page is white paper", () => {
  it("body drops its dark fill and its screen-tall minimum in print (Safari prints backgrounds)", () => {
    const print = css.slice(css.lastIndexOf("@media print"));
    expect(print).toMatch(/html, body \{ background: #fff !important; min-height: 0 !important; \}/);
  });
});

describe("the sheet", () => {
  const sheet = code("src/components/TimelineSheet.jsx");
  it("draws the screen's flags and the screen's unplaced rule", () => {
    expect(sheet).toMatch(/import \{ railFlagsOf \} from "\.\/blockFlags";/);
    expect(sheet).toMatch(/packLanes\(unplacedOf\(day, gridIds\)/);
  });
  // v18.4.6 (Patryk): paper has no hover, so the key under the grid says what
  // each flag means, as it does for the statuses.
  it("every flag in the one list says what it means", () => {
    const flags = code("src/components/blockFlags.jsx");
    const entries = flags.match(/\{ k: "\w+", keep: \d+, [^\n]*/g) || [];
    expect(entries.length).toBe(6);
    entries.forEach((e) => expect(e, e.slice(0, 30)).toMatch(/^\{ k: "\w+", keep: \d+, legend: /));
  });
  it("the key lists the flags of the blocks it DREW, one line per meaning", () => {
    expect(sheet).toMatch(/if \(!pos\) return null;\s+const flags = flagsOf\(b\);\s+flags\.forEach\(function \(f\) \{ if \(!drawn\.some\(function \(d\) \{ return d\.legend === f\.legend; \}\)\) drawn\.push\(f\); \}\);/);
    const key = sheet.slice(sheet.indexOf("{statuses.map("));
    expect(key.indexOf("{drawn.map(")).toBeGreaterThan(-1);
    expect(key).toMatch(/\{f\.icon\}<\/span>\s+\{f\.legend\}/);
    // After the rows that fill it: JSX evaluates in source order.
    expect(sheet.indexOf("{drawn.map(")).toBeGreaterThan(sheet.indexOf("TIMELINE_TABLES.map("));
  });
  it("paints finished visits first, so a live booking on the same row prints over them", () => {
    expect(sheet).toMatch(/\.sort\(function \(a, b\) \{ return \(a\.status === "completed" \? 0 : 1\) - \(b\.status === "completed" \? 0 : 1\); \}\)/);
  });
  it("holds no theme token: print stays light", () => {
    expect(sheet).not.toMatch(/var\(--/);
  });
  it("the day sheet says what seating each party asked for, after its tables", () => {
    const day = code("src/components/DaySheet.jsx");
    expect(day.indexOf("<th style={th}>Seating</th>")).toBeGreaterThan(day.indexOf("<th style={th}>Tables</th>"));
    expect(day.indexOf("<th style={th}>Seating</th>")).toBeLessThan(day.indexOf("<th style={th}>Phone</th>"));
    expect(day).toMatch(/\{b\.preference === "indoor" \? "Indoor" : b\.preference === "outdoor" \? "Outdoor" : ""\}/);
  });
  it("a print of the timeline alone is named for it", () => {
    expect(code("src/components/DaySheet.jsx")).toMatch(/getAttribute\("data-print"\) === "timeline" \? "mgt-timeline" : "mgt-day-sheet"/);
  });
});

// iOS fires `afterprint` before its print sheet opens and lays the page out
// again from the live DOM when an option changes (lib/print-end.js).
describe("when a print is over", () => {
  function fakeWin() {
    const ls = {};
    return {
      addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
      removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((x) => x !== f); },
      fire(t) { (ls[t] || []).slice().forEach((f) => f()); },
      count(t) { return (ls[t] || []).length; },
    };
  }
  it("a desktop dialog: afterprint, some time after beforeprint, ends it", () => {
    vi.useFakeTimers();
    const w = fakeWin(); let n = 0; onPrintEnd(() => n++, w);
    w.fire("beforeprint"); vi.advanceTimersByTime(PRINT_EARLY_MS + 1); w.fire("afterprint");
    expect(n).toBe(1);
    vi.useRealTimers();
  });
  it("iOS: an afterprint in the same instant waits for the user to come back to the page", () => {
    vi.useFakeTimers();
    const w = fakeWin(); let n = 0; onPrintEnd(() => n++, w);
    w.fire("beforeprint"); w.fire("afterprint");
    expect(n).toBe(0);
    // The sheet lays the page out again: the pair fires again, still waiting.
    w.fire("beforeprint"); w.fire("afterprint");
    expect(n).toBe(0);
    expect(w.count("pointerdown")).toBe(1);
    w.fire("pointerdown");
    expect(n).toBe(1);
    expect(w.count("pointerdown") + w.count("keydown")).toBe(0);
    vi.useRealTimers();
  });
  it("the browser's own print with no beforeprint seen ends at afterprint, and unsubscribing ends nothing", () => {
    const w = fakeWin(); let n = 0; const off = onPrintEnd(() => n++, w);
    w.fire("afterprint");
    expect(n).toBe(1);
    off();
    expect(w.count("beforeprint") + w.count("afterprint")).toBe(0);
    expect(n).toBe(1);
  });
});

// v18.4.6. An iPhone's Home Screen app drops `window.print()`: no sheet, no
// events (measured on the iOS 27 simulator; a Safari tab on the same device
// opened the sheet). The button did nothing and said nothing.
describe("a print the device ignores is reported", () => {
  // A window that records its listeners and timers; `fires` says whether its
  // print() raises `beforeprint`, as a browser that prints does.
  function fakeWin(standalone, fires) {
    const ls = {}, timers = [];
    const w = {
      navigator: standalone === undefined ? {} : { standalone },
      addEventListener: (t, f) => { (ls[t] = ls[t] || []).push(f); },
      removeEventListener: (t, f) => { ls[t] = (ls[t] || []).filter((x) => x !== f); },
      setTimeout: (f, ms) => { timers.push({ f, ms }); },
      print: () => { w.printed = (w.printed || 0) + 1; if (fires) (ls.beforeprint || []).slice().forEach((f) => f()); },
      ls, timers,
    };
    return w;
  }
  it("a Home Screen app whose print raises no event: reported, after the wait", () => {
    const w = fakeWin(true, false); let told = 0;
    printOrReport(() => { told++; }, w);
    expect(w.printed).toBe(1);
    expect(told, "not before the wait").toBe(0);
    expect(w.timers.map((t) => t.ms)).toEqual([PRINT_IGNORED_MS]);
    w.timers[0].f();
    expect(told).toBe(1);
    expect(w.ls.beforeprint, "the listener is taken back").toEqual([]);
  });
  it("a Home Screen app that DOES print is not told it cannot", () => {
    const w = fakeWin(true, true); let told = 0;
    printOrReport(() => { told++; }, w);
    w.timers[0].f();
    expect(told).toBe(0);
  });
  it("a print event that arrives during the wait counts too", () => {
    const w = fakeWin(true, false); let told = 0;
    printOrReport(() => { told++; }, w);
    w.ls.beforeprint.slice().forEach((f) => f());
    w.timers[0].f();
    expect(told).toBe(0);
  });
  it("anywhere else it is print() and nothing more: no listener, no timer, no report", () => {
    [fakeWin(false, false), fakeWin(undefined, false), fakeWin(false, true)].forEach((w) => {
      let told = 0;
      printOrReport(() => { told++; }, w);
      expect(w.printed).toBe(1);
      expect(w.timers).toEqual([]);
      expect(w.ls.beforeprint || []).toEqual([]);
      expect(told).toBe(0);
    });
  });
  it("App prints through it, takes the job down and says the sentence", () => {
    const app = code("src/App.jsx");
    const fn = app.slice(app.indexOf("function doPrint(job){"), app.indexOf("const printModal="));
    expect(fn).toMatch(/printOrReport\(function\(\)\{\s*document\.documentElement\.removeAttribute\("data-print"\);setPrintJob\(null\);\s*flashRefusal\(PRINT_IGNORED_TEXT\);\s*\}\);/);
    expect(fn).not.toMatch(/window\.print\(\)/);
    expect(PRINT_IGNORED_TEXT).toMatch(/Home Screen app.*Safari/);
  });
});

