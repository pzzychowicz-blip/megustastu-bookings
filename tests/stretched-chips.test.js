// tests/stretched-chips.test.js
// v18.14.0 (correction 3): the availability line and the country codes stretch edge
// to edge where they wrap. What it looks like is in REFACTOR_LOG, because that takes a
// browser. This holds what fails silently: a tablet's one row that stops being one
// row, and a padding that decides the wrap it is meant to follow.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const read = (f) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
const code = (f) => stripComments(read(f)).join("\n");
const Line = code("components/AvailLine.jsx");
const Form = code("components/BookingFormModal.jsx");
const Atoms = code("components/atoms.jsx");

describe("the availability line", () => {
  it("gives a shared row's free space to the sentence, and a wrapped row's to the actions", () => {
    expect(Line).toMatch(/const SENTENCE_GROW = 9999;/);
    expect(Line).toMatch(/flex: SENTENCE_GROW \+ " 1 auto"/);
    expect(Line).toMatch(/<span ref=\{actionsRef\} style=\{\{ display: "flex", flexWrap: "wrap", flex: "1 1 auto"/);
  });
  it("cuts the times into equal cells", () => {
    expect(Line).toMatch(/<TimeChip key=\{t\} time=\{t\} onPick=\{onTapTime\} style=\{\{ flex: "1 1 0"/);
  });
  it("measures the wrap, and the actions stay mounted so the measure always has its two items", () => {
    expect(Line).toMatch(/const wrapped = useSharesLine\(rowRef, sentenceRef, actionsRef\)\.same === false;/);
    // Inside the group, never a conditional sibling of the sentence: the hook takes
    // its nodes once, at mount, and a line can gain its actions without remounting.
    expect(Line.indexOf("ref={actionsRef}")).toBeLessThan(Line.indexOf("times.length > 0 ? ("));
  });
  it("the padding follows the wrap, never the reverse: it is the only thing `wrapped` touches but the bar", () => {
    expect(Line).toMatch(/const padding = !hasActions \? null : wrapped \? "10px 12px" : "4px 4px 4px 14px";/);
    expect(Line.match(/\bwrapped\b/g).length).toBe(3);
    expect(Line).toMatch(/flex: wrapped \? "1 1 100%" : "1 1 auto"/);
  });
});

describe("the country codes", () => {
  it("run under the mark as well as the sentence", () => {
    expect(Form).toMatch(/below=\{codes\.length\?<div style=\{\{display:"grid",gridTemplateColumns:"repeat\("\+codeColumns\(codes\.length,isMobile\)\+",1fr\)"/);
    expect(Atoms).toMatch(/flexWrap: below \? "wrap" : undefined,/);
    expect(Atoms).toMatch(/\{below \? <div style=\{\{ flex: "1 1 100%", minWidth: 0 \}\}>\{below\}<\/div> : null\}/);
  });
});

describe("the two surfaces he did not picture keep their chips", () => {
  it("TimeChip itself does not stretch: the two callers ask", () => {
    const chip = code("components/AvailBanner.jsx");
    const body = chip.slice(chip.indexOf("export function TimeChip"), chip.indexOf("export function AvailBanner"));
    expect(body).not.toMatch(/flex:/);
  });
});
