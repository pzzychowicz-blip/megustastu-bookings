// tests/date-row.test.js — v18.2.0: the date controls' 9px drop applies only
// while the Summary is BESIDE them, and the Summary sits beside them only when
// it fits there on one line.
//
// Patryk's screenshot at 668px: the Summary had wrapped onto its own line, the
// controls still dropped 9px (DATE_CTRL_DROP), and they sat 1px INTO the
// Summary card with 21px above them. The drop's gate was `!isMobile`, on the
// belief that at >=600 the Summary shrinks rather than wraps.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { sharesLine } from "../src/hooks/useSharesLine.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const App = read("App.jsx");
const Summary = read("components/Summary.jsx");
const Hook = read("hooks/useSharesLine.js");

describe("sharesLine — is b on a's flex line?", () => {
  // The measured 668px case: controls at 125..165 of the row, Summary at 164.
  it("says no once b starts at or below a's bottom edge", () => {
    expect(sharesLine({ offsetTop: 0, offsetHeight: 40 }, { offsetTop: 48 })).toBe(false);
    expect(sharesLine({ offsetTop: 0, offsetHeight: 40 }, { offsetTop: 40 }), "touching is the next line").toBe(false);
  });

  it("says yes when b starts inside a's span — the Summary beside the controls", () => {
    expect(sharesLine({ offsetTop: 0, offsetHeight: 40 }, { offsetTop: 0 })).toBe(true);
    expect(sharesLine({ offsetTop: 9, offsetHeight: 40 }, { offsetTop: 0 }), "a taller neighbour starting above").toBe(true);
  });
});

describe("the hook measures before paint, on the one box whose size moves when the answer can", () => {
  it("uses a layout effect and observes the ROW", () => {
    expect(Hook).toMatch(/useLayoutEffect\(function \(\) \{/);
    expect(Hook).toMatch(/ro\.observe\(row\);/);
    expect(Hook).toMatch(/return function \(\) \{ ro\.disconnect\(\); \};/);
  });

  it("reports `settled` false for the first measurement only, so the first paint never animates", () => {
    expect(Hook).toMatch(/const settled = !first;\s*first = false;/);
  });

  it("hands back the SAME state when nothing moved, so an open/close does not re-render the app per frame", () => {
    expect(Hook).toMatch(/prev\.same === same && prev\.settled === settled \? prev :/);
  });
});

describe("App's date-nav row", () => {
  it("drops the controls only while the Summary is measured beside them, and never while it is open", () => {
    expect(App).toMatch(/const summaryLine=useSharesLine\(dateRowRef,dateNavRef,summarySlotRef\);/);
    expect(App).toMatch(/const dateCtrlShift=\(summaryLine\.same!==true\|\|summaryOpen\)\?"none":"translateY\("\+DATE_CTRL_DROP\+"px\)";/);
    const shift = App.slice(App.indexOf("const dateCtrlShift="), App.indexOf(";", App.indexOf("const dateCtrlShift=")));
    expect(shift, "the width breakpoint was the bug — the gate is the measurement").not.toMatch(/isMobile/);
  });

  it("switches the transition on only once the first measurement has painted", () => {
    expect(App).toMatch(/const dateCtrlMotion=summaryLine\.settled\?"transform "\+M\.shift:"none";/);
    // Both control groups move together, so both take it.
    expect((App.match(/transform:dateCtrlShift,transition:dateCtrlMotion\}\}/g) || []).length).toBe(2);
  });

  it("wires the three refs to the row, the date nav and the Summary's slot", () => {
    expect(App).toMatch(/ref=\{dateRowRef\}\s+style=\{\{display:"flex",alignItems:"flex-start",gap:8,marginBottom:12,flexWrap:"wrap",flexShrink:0\}\}><nav aria-label="Date" ref=\{dateNavRef\}/);
    expect(App).toMatch(/<div ref=\{summarySlotRef\} style=\{\{flexGrow:1,flexShrink:1,flexBasis:"auto",minWidth:0\}\}>\{summaryPanel\}<\/div>/);
  });

  it("sizes the Summary by its own one-line width, not a fixed 360", () => {
    expect(App).not.toMatch(/flexBasis:isMobile\?"100%":360/);
  });
});

describe("the Summary breaks its own line where the date row expects it to", () => {
  // Measured at 800px: the slot sat beside the date controls (its one-line
  // width counts the headline's ~138px of content) while the card broke its
  // row on the headline's 200px basis, so it drew the two-line card the
  // slot's rule exists to prevent, from about 784 to 846px wide.
  it("gives the headline its content as its basis, not a fixed 200px", () => {
    expect(Summary).toMatch(/flex: "1 1 auto", minWidth: 0, boxSizing: "border-box", padding: 0,/);
    expect(Summary).not.toMatch(/flex: "1 1 200px"/);
  });
});

describe("the Summary's opened body stays out of that width", () => {
  it("contains the Reveal's inline size, or opening it would bounce the panel onto the next line", () => {
    expect(Summary).toMatch(/<Reveal show=\{open\} style=\{\{ contain: "inline-size" \}\}>/);
  });
});
