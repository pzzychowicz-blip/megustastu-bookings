// tests/minor-findings.test.js — v18.2.0 phases 70–76: the six minor findings
// of the design critique's round 2 (S7, S9, W6, X4, X6, X7), offered as
// "ROADMAP unless you say otherwise" in round 2 and taken by Patryk on
// 2026-09-26. Evidence for each is in
// `…/megustastu-bookings context/MGT_Bookings_v18.2.0_Design_Critique_Round2.md`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");

// S7: the voucher amount's placeholder "50", in a bare number box, read as an
// amount already entered. Measured on DEV after: "Amount (€)", placeholder
// "e.g. 50", value "".
describe("S7 — the voucher amount's hint reads as an example", () => {
  it("says e.g.", () => {
    const V = read("components/VouchersSettings.jsx");
    expect(V).toMatch(/placeholder="e\.g\. 50"/);
    expect(V).not.toMatch(/placeholder="50"/);
  });
});

// S9: Layout → Tables' zone control was one grey "Outdoor" chip that flipped on
// a tap and read as a label, the ids were plain text where every other surface
// draws a table badge, and "cap" was an abbreviation. Measured on DEV after
// (table 7): Outdoor aria-pressed true in a 32px track, the badge teal
// rgba(26, 94, 107, 0.8); pressing Indoor turned it rgba(124, 58, 157, 0.8)
// with Indoor pressed; pressing Outdoor put both back.
describe("S9 — Layout's table rows: a zone segment, badges, and seats", () => {
  const L = read("components/LayoutSettings.jsx");
  it("the zone is a two-option segment in the one segmented look, its state said", () => {
    expect(L).toMatch(/<div role="group" aria-label=\{"Zone of table " \+ t\.id\} style=\{\{ \.\.\.SEG_TRACK, marginLeft: "auto", flexShrink: 0 \}\}>/);
    expect(L).toMatch(/aria-pressed=\{on\}/);
    expect(L).toMatch(/style=\{\{ \.\.\.segStyle\(on\), padding: "2px 12px", minHeight: H\.chip \}\}/);
    expect(L, "the old one-chip toggle is back").not.toMatch(/rgba\(var\(--tbl-ind-rgb\),0\.18\)/);
  });
  it("the id is a table badge and the word is seats", () => {
    expect(L).toMatch(/<TBadge id=\{t\.id\} \/>/);
    expect(L).toMatch(/fontWeight: FW\.medium \}\}>seats<\/span>/);
    expect(L).not.toMatch(/>cap<\/span>/);
  });
});

// W6: the draft card's confidence chip read "HIGH" (and "HIGH CONFIDENCE" on
// the full card), the parser's level in capitals with nothing saying what a
// level asks of staff. Measured on DEV after (Anna Priks' draft, its stored
// confidence set to each level in turn): "Looks right" green, "Check it",
// "Check carefully" red, each titled "<Level> confidence", text-transform none,
// on the one-line bar at 800×654 and the full card at 1180×1000.
describe("W6 — the draft card's confidence says what to do", () => {
  const D = read("components/whatsapp/DraftCard.jsx");
  it("maps each level to an instruction", () => {
    expect(D).toMatch(/const CONF_SAYS = \{ high: "Looks right", medium: "Check it", low: "Check carefully" \};/);
    expect(D).toMatch(/const confTitle = conf\.charAt\(0\)\.toUpperCase\(\) \+ conf\.slice\(1\) \+ " confidence";/);
  });
  it("both the bar and the card say it, with the level as the tooltip", () => {
    const chips = D.match(/<OutlineChip title=\{confTitle\} tone=\{confTone\} size="small">\{confSays\}<\/OutlineChip>/g) || [];
    expect(chips.length).toBe(2);
    expect(D, "the level in capitals is back").not.toMatch(/textTransform: "uppercase"/);
  });
});

// X4: the Activity log's range and kind chips were OutlineChip's default micro
// size, 19.5px tall with 10px text. Measured on DEV after, at 991px: all
// fourteen 28px tall with 11px text and the hover lift; the kind rows wrap at a
// 32px pitch.
describe("X4 — the Activity log's chips are the app's chip", () => {
  const A = read("components/ActivityLogModal.jsx");
  it("every filter chip is small, H.chip tall and lifts on hover", () => {
    expect(A).toMatch(/const CHIP_H = \{ minHeight: H\.chip \};/);
    const chips = A.match(/as="button" size="small" className="mgt-hover-scale" style=\{CHIP_H\} tone=/g) || [];
    expect(chips.length, "3 range chips, the kind chips' one map, People only").toBe(5);
    expect(A, "a micro-sized filter chip is back").not.toMatch(/as="button" tone=/);
  });
});

// X6: Stats' five tiles were flex items on an 84px basis, so the tablet's
// 530px card held four and stretched "no-shows" alone across a second row;
// table usage read "Table 1" for a table the layout does not have, in text
// where every other surface draws a badge. Measured on DEV after: 1280×800,
// five 99.6px tiles on one row; 600×800 (the narrowest card), five of 98.8px
// with no label overflowing; 375×812, 107.7px × 3 over 165.5px × 2. Table
// usage: nine solid badges and table 1 dashed, "Table 1, not in the layout".
describe("X6 — Stats: a balanced grid of tiles, and tables as badges", () => {
  const W = read("components/WeekView.jsx");
  it("five across on the card, three over two on the phone's sheet", () => {
    expect(W).toMatch(/gridTemplateColumns: isMobile \? "repeat\(6, 1fr\)" : "repeat\(5, 1fr\)"/);
    expect(W).toMatch(/gridColumn: isMobile \? \(i < 3 \? "span 2" : "span 3"\) : "auto"/);
    expect(W, "the greedy flex basis is back").not.toMatch(/flex: "1 1 84px"/);
    expect(read("App.jsx")).toMatch(/<WeekView[\s\S]{0,120}isMobile=\{isMobile\}/);
  });
  it("a table is a badge, dashed when the layout does not have it", () => {
    expect(W).toMatch(/const inLayout = new Set\(TIMELINE_TABLES\.map\(function\(t\)\{ return t\.id; \}\)\);/);
    expect(W).toMatch(/<TBadge id=\{t\.id\} missing=\{!inLayout\.has\(t\.id\)\} \/>/);
    expect(W).not.toMatch(/"Table " \+ t\.id/);
  });
});

// X7: Find a booking's guests, phone and status followed the name's width —
// measured at 1280×800, guests began anywhere from 259 to 265px, 363 on a row
// with no phone — and the 580 card had no room to fix them (names were already
// cut to ~68px beside a year). Patryk's pick: a 720px card, one line, columns.
// Measured on DEV after: all 30 results share each column's x (13 · 114 · 168 ·
// 332 · 393 · 507) at 1280×800 with no name cut; at 375 two lines, guests at
// 275 and the status at 127 on line two in every row.
describe("X7 — Find a booking's results are columns", () => {
  const P = read("components/SearchPanel.jsx");
  it("a 720px card on a tablet, one line per result", () => {
    expect(P).toMatch(/const FIND_CARD_W = 720;/);
    expect(P).toMatch(/<Overlay onClose=\{onClose\} footer=\{footerEl\} maxWidth=\{FIND_CARD_W\}>/);
    expect(P).toMatch(/flexWrap: isMobile \? "wrap" : "nowrap"/);
    expect(read("App.jsx")).toMatch(/<SearchPanel bookings=\{bookings\} todayStr=\{todayStr\(\)\} isMobile=\{isMobile\}/);
  });
  it("each cell is a column sized to the widest in the results, in its own font", () => {
    expect(P).toMatch(/const nameCol = nameW \? Math\.min\(NAME_CAP, Math\.max\(nameW, tagW\)\) : NAME_CAP;/);
    expect(P).toMatch(/const paxCol = widest\(results\.map\(function \(b\) \{ return guestsLabel\(b\.size\); \}\), CELL_FONT\);/);
    // /code-review: "auto" when unmeasurable — `phoneCol` also decides whether
    // the column is drawn, so undefined there hid every phone number.
    expect(P).toMatch(/const phoneCol = phones\.length \? \(widest\(phones, CELL_FONT\) \|\| "auto"\) : 0;/);
    expect(P).toMatch(/\.\.\.CELL_FONT, color: S\.muted, width: paxCol, flexShrink: 0/);
    expect(P).toMatch(/\.\.\.CELL_FONT, color: S\.muted, width: phoneCol, flexShrink: 0, whiteSpace: "nowrap" \}\}>\{b\.phone \? formatPhone\(b\.phone\) : ""\}/);
    expect(P).toMatch(/<span style=\{\{ width: SBADGE_W, flexShrink: 0, display: "flex" \}\}><SBadge status=\{b\.status\} \/><\/span>/);
    expect(P, "the widths must come from the one canvas measure").toMatch(/textWidth\(l, font\.fontWeight, font\.fontSize \+ "px", family\)/);
  });
});
