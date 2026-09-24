// tests/wa-inbox-layout.test.js — v18.2.0, the design critique's WhatsApp
// inbox findings (W1–W5), one phase each.
//
// W1, measured on DEV at 375×812: the compact draft bar read "2 pax · 202…",
// the date and time cut off by HIGH / Accept / Dismiss. After: line one is
// "2 pax · 2026-09-25 · 14:00" whole, line two is HIGH, Accept and Dismiss
// together, right-aligned; at 1280×800 (compact too, the tablet is 800 tall)
// it is still one line.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Draft = read("components/whatsapp/DraftCard.jsx");

describe("W1 — the draft bar never hides what it asks you to accept", () => {
  it("gives the details a basis of their own content, and no shrink", () => {
    expect(Draft).toMatch(/gap: 8, flex: "1 0 auto", maxWidth: "100%", minWidth: 0, cursor: hasDetail \? "pointer" : "default"/);
    expect(Draft, "flex: 1 with min-width 0 is what let the controls squeeze it").not.toMatch(/gap: 8, flex: 1, minWidth: 0, cursor: hasDetail/);
  });

  it("wraps the controls as ONE group, pushed right, so Accept and Dismiss never split", () => {
    const i = Draft.indexOf('<div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0 }}>');
    expect(i).toBeGreaterThan(-1);
    const group = Draft.slice(i, Draft.indexOf("</div>", i));
    expect(group).toMatch(/title=\{confLbl \+ " confidence"\}/);
    expect(group).toMatch(/>Accept<\/button>/);
    expect(group).toMatch(/>Dismiss<\/OutlineChip>/);
  });
});
