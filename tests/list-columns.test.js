// tests/list-columns.test.js — v18.2.0: every status badge, flag and button on
// a List card lines up with the same element on the card above it.
//
// Patryk asked for the Settings → Vouchers treatment (its Copy column). Measured
// at 668px before this: the status badge at x = 175 · 185 · 194 on three cards,
// Assign at 359 · 384. Each width that varied (the name, the badge, the
// next-step button, the border) now takes a fixed one. He chose fixed widths
// over columns sized to each day's entries.
//
// Phase 18 reversed that for the NAME alone: under three short names the 180px
// column read as a gap "too big" before the status badge. It is now the day's
// widest name, capped at 180, and the size ring moved in front of the status
// (Patryk's order: name, covers, status, the rest).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const List = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "ListView.jsx"), "utf8")).join("\n");
const Atoms = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "atoms.jsx"), "utf8")).join("\n");
// v18.2.0 phase 75: STATUS_COL reads SBADGE_W, which moved to atoms.jsx beside
// the badge it measures, so its number is read there.
const num = (name) => name === "STATUS_COL"
  ? (/const STATUS_COL = SBADGE_W;/.test(List) ? Number((Atoms.match(/export const SBADGE_W = (\d+);/) || [])[1]) : NaN)
  : Number((List.match(new RegExp("const " + name + " = (\\d+);")) || [])[1]);

describe("the column widths are the measured ones", () => {
  it("fit the widest thing each column holds", () => {
    expect(num("NAME_COL"), "the CAP: María José Fernández is 178px").toBe(180);
    expect(num("STATUS_COL"), "the Completed badge is 97.8px").toBe(98);
    expect(num("NEXT_COL"), "the Completed button is 115.7px").toBe(116);
    expect(num("NAME_LINE"), "the name's line box and the badge are 20px").toBe(20);
    expect(num("FLAGS_MIN"), "the double-booked chip is 101.3px").toBe(104);
    expect(num("TIME_COL")).toBe(58);
    expect(num("TIME_GAP")).toBe(14);
  });

  it("still fits a status line beside the flags on a 375px phone (245px beside the time)", () => {
    const ring = 18, gap = 8;
    expect(num("STATUS_COL") + gap + ring + gap + num("FLAGS_MIN")).toBeLessThanOrEqual(245);
  });
});

describe("the name row", () => {
  it("the name holds the day's column, wrapping inside it rather than pushing the badge", () => {
    expect(List).toMatch(/flex: "1 0 " \+ nameCol \+ "px", minWidth: 0,[^}]*lineHeight: NAME_LINE \+ "px", overflowWrap: "anywhere"/);
  });

  it("the column is the widest of ALL the day's names — finished cards included — capped at NAME_COL", () => {
    // v18.5.1: `dayAll`, the day BEFORE the tag filter, so a filter does not
    // move the columns.
    expect(List).toMatch(/const nameCol = nameColFor\(dayAll\);/);
    expect(List).toMatch(/return Math\.min\(NAME_COL, w\);/);
    // Measured in the name's own font — the SAME object the name span spreads,
    // so the measured and the rendered font cannot drift apart.
    expect(List).toMatch(/const NAME_FONT = \{ fontWeight: FW\.bold, fontSize: T\.title \};/);
    // Since phase 75 through the shared `textWidth` (atoms.jsx).
    expect(List).toMatch(/return textWidth\(s, NAME_FONT\.fontWeight, NAME_FONT\.fontSize \+ "px", nameFamily\) \|\| NAME_COL;/);
    expect(List).toMatch(/flex: "1 0 " \+ nameCol \+ "px", minWidth: 0, \.\.\.NAME_FONT, color: S\.text,/);
  });

  it("covers come before the status, and the status sits in a STATUS_COL cell", () => {
    const unit = List.slice(List.indexOf("<SizeRing n={b.size}"));
    expect(unit.indexOf("<SizeRing")).toBe(0);
    expect(unit).toMatch(/^<SizeRing n=\{b\.size\} rim="var\(--chip-neutral-border\)" \/>\s*<span style=\{\{ \.\.\.NAME_CELL, width: STATUS_COL, flexShrink: 0 \}\}><SBadge status=\{b\.status\} \/><\/span>/);
  });

  it("beside the name sits ONE box, always rendered, whose basis is the size + status unit", () => {
    expect(List).toMatch(/const UNIT_W = 18 \+ 8 \+ STATUS_COL;/);
    expect(List).toMatch(/<div style=\{\{ flex: "1000 1 " \+ UNIT_W \+ "px", minWidth: 0, display: "flex", alignItems: "flex-start", columnGap: 8, rowGap: 4, flexWrap: "wrap" \}\}>\s*<span style=\{\{ \.\.\.NAME_CELL, flex: "0 0 auto", gap: 8 \}\}>/);
    expect(List, "the box must not be conditional").not.toMatch(/\?\s*\(?\s*<div style=\{\{ flex: "1000 1 " \+ UNIT_W/);
  });

  it("the flags live INSIDE that box, after the unit — a third item on the row let a wrapped flag move the covers (x 222 against 208 at 375px)", () => {
    expect(List).toMatch(/\{hasFlags \? \(\s*<div style=\{\{ \.\.\.NAME_CELL, flex: "1 1 " \+ FLAGS_MIN \+ "px", minWidth: 0, flexWrap: "wrap", gap: "4px 8px" \}\}>\s*\{depositTag\}/);
    const box = List.slice(List.indexOf('flex: "1000 1 " + UNIT_W'));
    expect(box.indexOf("<SBadge status={b.status} />")).toBeLessThan(box.indexOf("{hasFlags ? ("));
  });
});

describe("the actions", () => {
  const group = List.slice(List.indexOf('marginLeft: "auto", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end"'));

  it("the next step is NEXT_COL wide whatever it says, so Assign keeps one x", () => {
    expect(List).toMatch(/justifyContent: "center", gap: 6, minWidth: NEXT_COL \}\)/);
  });

  it("No show, when due, is the FIRST button: the group is right-anchored, so an optional button on the left moves nothing", () => {
    const noShow = group.indexOf("onNoShow(b.id)");
    const assign = group.indexOf("onManual(b.id)");
    expect(noShow).toBeGreaterThan(-1);
    expect(noShow).toBeLessThan(assign);
    expect(group.indexOf("{nextBtn}")).toBeGreaterThan(assign);
    expect(group.indexOf("{moreBtn}")).toBeGreaterThan(group.indexOf("{nextBtn}"));
  });
});

describe("the card", () => {
  it("gives back in padding what a 3px border takes, so a seated card's columns start where a confirmed card's do", () => {
    expect(List).toMatch(/const cardBw = \(clash \|\| warn \|\| lateSt \|\| useStatusColor \|\| isPending\) \? 3 : 1;/);
    expect(List).toMatch(/border: cardBw \+ "px solid " \+ cardBrd,/);
    expect(List).toMatch(/padding: cardBw === 3 \? "12px 14px" : "14px 16px"/);
  });

  it("is a two-column grid whose actions row spans under the time, with its tables indented past it", () => {
    expect(List).toMatch(/gridTemplateColumns: TIME_COL \+ "px minmax\(0, 1fr\)", columnGap: TIME_GAP/);
    expect(List).toMatch(/gridColumn: 1, gridRow: "1 \/ span 2", fontVariantNumeric: "tabular-nums"/);
    expect(List).toMatch(/gridColumn: "1 \/ -1", gridRow: 2,/);
    expect(List).toMatch(/marginLeft: TIME_COL \+ TIME_GAP \}\}>\s*\{\(b\.tables \|\| \[\]\)\.map/);
  });
});

// v18.2.0 phase 75: ONE canvas text measure. Settings' tab bar and this file's
// name column each had their own, and Find a booking was about to be the third;
// `textWidth` in atoms.jsx is the one, and a second `measureText` fails here.
describe("one text measure", () => {
  it("measureText and a 2D context appear only in atoms.jsx's textWidth", () => {
    const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const files = [];
    (function walk(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(e.name)) files.push(p);
      }
    })(SRC);
    const hits = files.filter((f) => /measureText\(|getContext\(/.test(stripComments(readFileSync(f, "utf8")).join("\n")))
      .map((f) => f.slice(SRC.length + 1));
    expect(hits).toEqual(["components/atoms.jsx"]);
    expect(Atoms).toMatch(/export function textWidth\(label, weight, size, family\) \{/);
  });
});
