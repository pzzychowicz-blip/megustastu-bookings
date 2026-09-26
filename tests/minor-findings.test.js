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
