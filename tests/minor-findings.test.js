// tests/minor-findings.test.js — v18.2.0 phases 70–75: the six minor findings
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
