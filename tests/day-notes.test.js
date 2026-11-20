// tests/day-notes.test.js — v18.18.0
//
// ── THE DAY'S NOTES, IN THE OPENED SUMMARY ──────────────────────────────────
// `dayNotes` (src/lib/day-notes.js) decides which of a date's bookings the
// Summary lists and what each entry says. Patryk (2026-11-19): tags and notes,
// every booking that has either; cancelled ones out, finished ones in; in time
// order; a row opens its booking. This file holds the helper to that, and App
// and the Summary to using it.
//
// It reads `Summary.jsx` and App comment-stripped (tests/test-hygiene.test.js).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { sanitize } from "../src/lib/booking-fields.js";
import { guestTagMap, bookingTags, tagLine } from "../src/lib/customers.js";
import { DEFAULT_TAG_LIST } from "../src/lib/tags.js";
import { addDays, todayStr } from "../src/lib/day.js";
import { dayNotes } from "../src/lib/day-notes.js";
import { appCode } from "./app-source.js";

const D = addDays(todayStr(), 10), OTHER = addDays(todayStr(), 11);
const LIST = DEFAULT_TAG_LIST;
const ANA = "+34 600 111 222";

function bk(id, o) {
  return sanitize(Object.assign({
    id, name: "Guest " + id, phone: "", date: D, time: "20:00", size: 2,
    status: "confirmed", tables: [], history: [],
  }, o), id);
}
const notesOf = (list) => dayNotes(list, D, guestTagMap(list), LIST);
const ids = (list) => notesOf(list).map((n) => n.id);

describe("dayNotes: which bookings", () => {
  it("lists a booking with a note, a guest tag or an occasion tag, and none without", () => {
    const list = [
      bk("note", { notes: "No nuts" }),
      bk("occ", { tags: ["o-birthday"] }),
      bk("guest", { phone: ANA, guestTags: ["g-allergy"], guestTagsAt: 100 }),
      bk("plain", {}),
    ];
    expect(ids(list).sort()).toEqual(["guest", "note", "occ"]);
  });
  it("lists a guest's tags stated on another booking, another day's included", () => {
    // The guest's statement sits on their booking next week; tonight's booking
    // carries none of its own and is still listed, with the guest's tags.
    const list = [
      bk("tonight", { phone: ANA }),
      bk("later", { phone: ANA, date: OTHER, guestTags: ["g-vip"], guestTagsAt: 100 }),
    ];
    const got = notesOf(list);
    expect(got.map((n) => [n.id, n.tags])).toEqual([["tonight", "VIP"]]);
  });
  it("leaves out a note that is only whitespace", () => {
    expect(ids([bk("blank", { notes: "   \n  " })])).toEqual([]);
  });
  it("leaves out a cancelled booking and keeps every other status, finished ones included", () => {
    const list = ["confirmed", "pending", "seated", "completed", "cancelled"].map((s) => bk(s, { status: s, notes: "x" }));
    expect(ids(list).sort()).toEqual(["completed", "confirmed", "pending", "seated"]);
  });
  it("leaves out another date's bookings", () => {
    expect(ids([bk("there", { date: OTHER, notes: "x" })])).toEqual([]);
  });
  it("answers an empty list for no bookings, and reads a missing map and list as no tags", () => {
    expect(dayNotes(null, D, null, null)).toEqual([]);
    expect(dayNotes(undefined, D)).toEqual([]);
    const list = [bk("n", { notes: "x", tags: ["o-birthday"] })];
    // No tag list: the note still lists, and the tag has no label to show.
    expect(dayNotes(list, D, null, null).map((n) => [n.id, n.tags, n.note])).toEqual([["n", "", "x"]]);
  });
});

describe("dayNotes: what each entry says", () => {
  it("the tags are the day sheet's line, guest tags first, and the note is trimmed", () => {
    const b = bk("a", { phone: ANA, guestTags: ["g-allergy", "g-vip"], guestTagsAt: 100, tags: ["o-birthday"], notes: "  Cake with dessert \n" });
    const [n] = notesOf([b]);
    expect(n.tags).toBe("Allergy, VIP · Birthday");
    expect(n.tags).toBe(tagLine(bookingTags(b, guestTagMap([b]), LIST)));
    expect(n.note).toBe("Cake with dessert");
  });
  it("names the booking: name, booked time, size and tables, and carries the stored row", () => {
    const b = bk("a", { name: "Noel", size: 1, time: "19:00", tables: ["9"], notes: "x" });
    const [n] = notesOf([b]);
    expect([n.name, n.time, n.size, n.tables]).toEqual(["Noel", "19:00", 1, ["9"]]);
    expect(n.booking).toBe(b);
    // A copy: the row is never reached through the entry's list.
    n.tables.push("1");
    expect(b.tables).toEqual(["9"]);
  });
  it("shows a seated party at the time it booked, not the minute it sat down", () => {
    const b = bk("s", { status: "seated", time: "20:15", scheduledTime: "20:30", notes: "x" });
    expect(notesOf([b])[0].time).toBe("20:30");
  });
});

describe("dayNotes: order", () => {
  it("runs by the time it shows, then by id", () => {
    const list = [
      bk("c", { time: "21:00", notes: "x" }),
      bk("b2", { time: "19:30", notes: "x" }),
      // Sat down at 18:50 for a 20:00 booking: listed at 20:00.
      bk("s", { status: "seated", time: "18:50", scheduledTime: "20:00", notes: "x" }),
      bk("b1", { time: "19:30", notes: "x" }),
      bk("a", { time: "13:00", notes: "x" }),
    ];
    expect(ids(list)).toEqual(["a", "b1", "b2", "s", "c"]);
    // The same answer whatever order the bookings arrive in.
    expect(ids(list.slice().reverse())).toEqual(["a", "b1", "b2", "s", "c"]);
  });
});

describe("the Summary lists them, and a row opens its booking", () => {
  const summary = stripComments(readFileSync(fileURLToPath(new URL("../src/components/Summary.jsx", import.meta.url)), "utf8")).join("\n");
  const app = appCode();
  const mount = app.slice(app.indexOf("const summaryPanel=<Summary"));
  const tag = mount.slice(0, mount.indexOf("/>"));

  it("reads the day's notes through dayNotes, from the props App passes", () => {
    expect(summary).toContain("dayNotes(bookings, date, guestTags, tagList)");
    expect(tag).toContain("guestTags={guestTags}");
    expect(tag).toContain("tagList={tagList}");
    // A STABLE function (src/CLAUDE.md, React.memo × live module bindings):
    // an inline closure here would re-render the Summary on every App render.
    expect(tag).toContain("onEdit={VA.onEdit}");
  });
  it("a row hands its booking to onEdit, which opens the edit form", () => {
    expect(summary).toContain("onEdit(n.booking)");
    expect(app).toContain("onEdit:function(b){R.current.openEdit(b);}");
  });
  it("with Lock navigation on, the opened body scrolls inside a slot that may shrink", () => {
    // Measured at 998×507 before this (v18.18.0): a day with notes put Print and
    // More 63px below the screen, out of reach, because the slot never shrank.
    expect(tag).toContain("fit={shellFixed}");
    expect(app).toContain("style={shellFixed?SUMMARY_SLOT_FIT:{flexShrink:0}}");
    expect(app).toContain('const SUMMARY_SLOT_FIT={flexShrink:1,minHeight:0,display:"flex",flexDirection:"column"};');
    // The scroller is the flex item that shrinks, and it WRAPS the Reveal: a
    // Reveal made a flex item sizes its fr row against its own flexed height.
    expect(summary).toMatch(/const FIT_SCROLL = \{\s*flex: "0 1 auto", minHeight: 0, overflowY: "auto",/);
    expect(summary).toContain("const placed = <div ref={scrollRef} style={fit ? FIT_SCROLL : undefined}>{body}</div>;");
    expect(summary).toContain("{bodySlot ? createPortal(placed, bodySlot) : placed}");
    expect(summary).toMatch(/const body = \(\s*<Reveal show=\{open\}>/);
  });
});
