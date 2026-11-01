// tests/row-slots.test.js — v18.14.0 (correction 29, Patryk)
//
// What arrives in a row with a `gap` has to bring the gap with it, or the gap pops
// while the thing eases. And a booking form's Tables row must not blink while the
// scan re-checks: "never show a stale answer" is about the answer, not its room.
// These read the source (the suite mounts nothing, tests/CLAUDE.md); the frames are
// in REFACTOR_LOG.md.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const read = (path) => stripComments(readFileSync(new URL("../src/components/" + path, import.meta.url), "utf8")).join("\n");

describe("RowSlot", () => {
  const atoms = read("atoms.jsx");
  const slot = atoms.slice(atoms.indexOf("export function RowSlot"), atoms.indexOf("export function RowSlot") + 420);
  it("takes the row's gap back and carries its own inside the ease", () => {
    expect(slot).toContain("marginLeft: -gap");
    expect(slot).toContain("paddingLeft: gap");
  });
  it("keeps its content's width through the ease, so a label cannot wrap on the way", () => {
    expect(slot).toContain("flexShrink: 0");
    expect(slot).toContain('whiteSpace: "nowrap"');
  });
  it("makes the leaving copy inert", () => {
    expect(slot).toContain("inert={!show}");
  });
});

describe("the form's status row", () => {
  const form = read("BookingFormModal.jsx");
  it("draws from one fixed order, the one statusTargets offers", () => {
    expect(form).toContain('const STATUS_ROW = ["confirmed", "seated", "completed", "cancelled", "pending"];');
    expect(form).toContain('const base=["confirmed","seated","completed","cancelled"];');
    expect(form).toContain('base.concat(["pending"])');
    expect(form).toContain("STATUS_ROW.map(function(s)");
    expect(form).not.toContain("statusTargets.map(");
  });
  it("offers a status only while statusTargets does", () => {
    expect(form).toContain("const offered=statusTargets.indexOf(s)>=0;");
    expect(form).toContain("<RowSlot key={s} show={offered} gap={6}>{offered?<button");
  });
});

describe("the Tables row", () => {
  const preview = read("TablesPreview.jsx");
  const form = read("BookingFormModal.jsx");
  it("goes through TablesPreview on both forms, with the scan's pending", () => {
    expect(form.match(/<TablesPreview key="tables"/g)).toHaveLength(2);
    expect(form.match(/pending=\{availScan\.pending\} \/>/g)).toHaveLength(2);
    expect(form).not.toContain("(auto)<");
  });
  it("hides an unanswered check in that frame and keeps its room", () => {
    expect(preview).toContain("const waiting = pending && !tables;");
    expect(preview).toContain("const shown = tables || (waiting ? held : null);");
    expect(preview).toContain('transition: waiting ? "none" : "opacity " + M.move');
  });
  it("leaves the tables as children of the row, which is what wraps them on a phone", () => {
    expect(preview).toContain("<>");
    expect(preview).not.toContain("flexWrap");
  });
  it("keeps was: as it was for the length of a check", () => {
    expect(preview).toContain("if (!pending && heldWas !== was) setHeldWas(was);");
    expect(preview).toContain("const wasShown = pending ? heldWas : was;");
  });
});

describe("Preferred table's Clear", () => {
  it("eases, and Done stays where it is", () => {
    const pref = read("PrefPickerModal.jsx");
    expect(pref).toContain("<RowSlot show={prefs.length > 0} gap={8}>");
  });
});
