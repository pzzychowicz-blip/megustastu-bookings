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

// v18.14.0 (correction 35, Patryk): a sweep of the code rather than of taps. The census
// only sees what it can press, so these were found by reading every bare `? <x> : null`
// under src/components. Each is a hint, a warning or a button, and each now eases.
describe("what the census could not reach", () => {
  const src = read;
  it("takes the row's gap with it: Manual's Clear, the Regulars stepper, the log's hint, No show, a time's ×", () => {
    expect(src("ManualModal.jsx")).toContain("<RowSlot show={selected.length > 0} gap={8}>");
    expect(src("CustomersSettings.jsx")).toContain('<RowSlot show={filter === "regulars" && !searching} gap={6}>');
    expect(src("ActivityLogModal.jsx")).toContain("<RowSlot show={allTime} gap={SP.base}>");
    expect(src("ListView.jsx")).toContain("<RowSlot show={!!acts.noShow} gap={6}>");
    expect(src("ReminderEditor.jsx")).toContain("<RowSlot show={draft.times.length > 1} gap={6}>");
  });
  it("keeps Manual's row as tall as Clear, because a sideways fold cannot ease a row's height", () => {
    expect(src("ManualModal.jsx")).toContain('minHeight: H.control, display: "flex", flexDirection: "column", justifyContent: "center"');
  });
  it("folds what sits between lines, with its space inside the fold", () => {
    const form = src("BookingFormModal.jsx");
    expect(form).toContain("<Reveal show={dateLocked}>{dateLocked?<div id={DATE_LOCK_ID}");
    expect(form).toContain("color:S.muted,paddingTop:4}}>Change the status to change the date");
    expect(src("VoucherPicker.jsx")).toContain("<Reveal show={!!(suggestions && suggestions.length)}>");
    const layout = src("LayoutSettings.jsx");
    expect(layout).toContain("<Reveal show={open} inert={!open}>");
    expect(layout).toContain("<Reveal show={pickFor === gi} inert={pickFor !== gi}>");
    expect(layout).toContain("<Reveal show={!!addDup || addIds.length === 1}>");
    const floor = src("FloorPlanEditor.jsx");
    expect(floor).toContain("<Reveal show={totalChairs !== cap}>");
    expect(floor).toContain("<Reveal show={!!inspector} inert={!inspector}>");
  });
  it("folds a reminder's times by place, because a time has no id", () => {
    const rem = src("ReminderEditor.jsx");
    expect(rem).toContain("<FoldRows items={draft.times} idOf={(t, i) => String(i)}>");
    expect(rem).not.toContain("draft.times.map(");
  });
  it("fades the two search crosses both ways", () => {
    const fade = 'inClass="mgt-appear" outClass="mgt-ghost-out"';
    expect(src("atoms.jsx")).toContain("<Presence show={has} " + fade);
    expect(src("whatsapp/InboxPanel.jsx")).toContain("<Presence show={!!query} " + fade);
  });
  // v18.16.0 (Patryk): the linked booking's summary faded in and out with the card's
  // fold. On a tablet the card is a fixed strip now and the line is always there; on a
  // phone it was never drawn. Nothing shows or hides it, so there is nothing to fade,
  // and a Presence left on it would be a transition with no trigger.
  it("the linked booking's summary is a plain line: no tap shows or hides it", () => {
    const linked = src("whatsapp/LinkedBookingCard.jsx");
    expect(linked).not.toContain("<Presence");
    expect(linked).toMatch(/\{narrow \? null : <span style=\{\{[^\n]*minWidth: SUMMARY_MIN[^\n]*\}\}>\{summary\}<\/span>\}/);
  });
  it("eases the usage panel's answer alone, so Refresh under it glides", () => {
    const s = src("Settings.jsx");
    const at = s.indexOf("function WaCostSection()");
    const close = s.indexOf("</AutoHeight>", at);
    expect(close).toBeGreaterThan(-1);
    expect(s.indexOf("<AutoHeight>", at)).toBeLessThan(close);
    expect(s.indexOf('{loading ? "Asking…" : "Refresh"}', at)).toBeGreaterThan(close);
  });
});
