// tests/summary-freeing.test.js — v18.2.0: the Summary's freeing-soon list
// prints each table as a TABLE BADGE (`TBadge`), the one the List card uses,
// where it printed "5A+5B (~6m)" as text (Patryk).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const Summary = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "Summary.jsx"), "utf8")).join("\n");

describe("the freeing-soon list", () => {
  it("imports the List card's badge rather than drawing its own", () => {
    expect(Summary).toMatch(/import \{ mkBtn, Reveal, TBadge \} from "\.\/atoms";/);
  });

  it("renders one TBadge per table of each entry", () => {
    expect(Summary).toMatch(/tables\.map\(function\(t\)\{ return <TBadge key=\{t\} id=\{t\} \/>; \}\)/);
    expect(Summary, "the text form is back").not.toMatch(/tables\.join\("\+"\)/);
    expect(Summary).not.toMatch(/freeingParts/);
  });

  it("a booking with no table keeps its '?' as TEXT — a badge would give it an outdoor fill", () => {
    expect(Summary).toMatch(/\{tables \? tables\.map\([^)]*\)[^:]*: "\?"\}/);
  });

  it("still shows three entries, then '+N'", () => {
    expect(Summary).toMatch(/const FREEING_SHOWN = 3;/);
    expect(Summary).toMatch(/freeing\.slice\(0, FREEING_SHOWN\)\.map/);
    expect(Summary).toMatch(/freeing\.length > FREEING_SHOWN \? ", \+" \+ \(freeing\.length - FREEING_SHOWN\) : null/);
  });

  it("the entry component is declared at MODULE scope, never inside Summary (the inline sub-component rule)", () => {
    const entry = Summary.indexOf("function FreeingEntry(");
    expect(entry).toBeGreaterThan(-1);
    expect(entry).toBeLessThan(Summary.indexOf("export const Summary = memo("));
  });

  it("an entry never breaks between its badges and its minutes", () => {
    const body = Summary.slice(Summary.indexOf("function FreeingEntry("), Summary.indexOf("export const Summary = memo("));
    expect(body).toMatch(/whiteSpace: "nowrap"/);
  });
});
