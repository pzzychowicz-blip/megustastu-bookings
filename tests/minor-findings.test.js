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
