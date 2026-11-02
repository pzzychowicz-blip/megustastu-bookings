// tests/fold-rows.test.js — v18.14.0 (correction 32, Patryk)
//
// A row somebody removes from a list folds, and what sits under it slides. The census
// measured 182px in a frame on the People list and 106 on the templates, and the lists
// it never reached (reminders, tags, special days, standing bookings, tiers, pinned
// countries) did the same. These read the source; the frames are in REFACTOR_LOG.md.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const read = (path) => stripComments(readFileSync(new URL("../src/components/" + path, import.meta.url), "utf8")).join("\n");

describe("FoldRows", () => {
  const fold = read("FoldRows.jsx");
  it("folds on ROW_FOLD with a hold named for the same speed", () => {
    expect(fold).toContain("{ speed: ROW_FOLD }");
    expect(fold).toContain("speed={ROW_FOLD}");
  });
  it("eases a newcomer open, since nothing here slides the rest for it", () => {
    expect(fold).not.toContain("instantIn");
  });
  it("keeps a leaving row in its place, inert", () => {
    expect(fold).toContain("useLeavingOrder(ids, renderIds)");
    expect(fold).toContain("inert={at < 0}");
  });
  it("opens sideways in a row of chips, on the slot that hands the gap back", () => {
    expect(fold).toContain("<RowSlot key={id} show={openIds.has(id)} gap={gap}>");
  });
});

describe("every list you can remove a row from", () => {
  const LISTS = [
    ["AdminSettings.jsx", "<FoldRows items={rows}"],
    ["whatsapp/TemplatesEditor.jsx", "<FoldRows items={list}"],
    ["Reminders.jsx", "<FoldRows items={list}"],
    ["TagListEditor.jsx", "<FoldRows items={tags}"],
    ["Settings.jsx", "<FoldRows items={upcoming}"],
    ["Settings.jsx", "<FoldRows items={recurring.rules || []}"],
    ["Settings.jsx", "<FoldRows items={tiers}"],
    ["Settings.jsx", "<FoldRows items={list.filter(countryByIso)} idOf={(iso) => iso} gap={SP.snug}>"],
  ];
  it.each(LISTS)("%s: %s", (file, site) => {
    expect(read(file)).toContain(site);
  });
  it("hands an emptied list over to its empty line, which opens", () => {
    expect(read("Reminders.jsx")).toContain("<Reveal show={list.length === 0}>");
    const settings = read("Settings.jsx");
    expect(settings).toContain("<Reveal show={upcoming.length === 0}>");
    expect(settings).toContain("<Reveal show={(recurring.rules || []).length === 0}>");
    expect(settings).toContain("<Reveal show={list.length === 0}>");
  });
  it("carries a tier's gap inside its row, and hands the last one back", () => {
    const settings = read("Settings.jsx");
    expect(settings).toContain('<div style={{ marginBottom: -14 }}>');
    expect(settings).toContain('alignItems: "flex-end", paddingBottom: 14 }}>');
  });
});

describe("the templates editor's swap", () => {
  it("fades in, as a Settings tab's body does", () => {
    const editor = read("whatsapp/TemplatesEditor.jsx");
    expect(editor).toContain('<div key="edit" className="mgt-fade-in"');
    expect(editor).toContain('<div key="list" className="mgt-fade-in">');
  });
});
