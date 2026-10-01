// tests/seating-preference.test.js — v18.3.1
//
// A booking's seating preference is a WISH on every path (Patryk): the
// preferred zone is tried first, the other zone is used when it is full, and a
// party seated outside its zone is flagged. Before, `findFreeSlot` (the path
// with the optimiser off: today, after the cutoff) refused such a party while
// the optimiser seated it outdoors on every other day. Comments stripped
// (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { findFreeSlot, offZone, offZoneLabel, offZoneNote, isAllIn, isAllOut } from "../src/lib/booking-logic.js";
import { ALL_TABLES } from "../src/lib/constants.js";

const D = "2030-06-12";
const INDOOR = ALL_TABLES.map((t) => t.id).filter((id) => isAllIn([id]));
const occupy = (ids) => ids.map((id, i) => ({ id: "x" + i, date: D, time: "19:30", duration: 180, status: "confirmed", tables: [id], size: 2 }));

describe("findFreeSlot: the preferred zone first, then any", () => {
  it("still seats an indoor party indoors when indoor has room", () => {
    const t = findFreeSlot([], D, "20:00", 2, "indoor", 90, [], null, null);
    expect(isAllIn(t)).toBe(true);
  });

  it("seats it outdoors when indoor is full, where it used to refuse", () => {
    const t = findFreeSlot(occupy(INDOOR), D, "20:00", 2, "indoor", 90, [], null, null);
    expect(t && t.length).toBeGreaterThan(0);
    expect(isAllOut(t)).toBe(true);
  });

  // /code-review: with the preferred zone full, the guest's own tables in the
  // other zone come before any other table there.
  it("with the zone full, tries the guest's preferred tables before any other", () => {
    const outs = ALL_TABLES.map((t) => t.id).filter((id) => isAllOut([id]));
    const fav = outs[outs.length - 1];
    const cap = ALL_TABLES.find((t) => t.id === fav).capacity;
    const t = findFreeSlot(occupy(INDOOR), D, "20:00", Math.min(2, cap), "indoor", 90, [], null, [fav]);
    expect(t).toEqual([fav]);
  });

  it("returns null only when no zone has room", () => {
    const all = ALL_TABLES.map((t) => t.id);
    expect(findFreeSlot(occupy(all), D, "20:00", 2, "indoor", 90, [], null, null)).toBe(null);
  });
});

describe("offZone and its words", () => {
  const out = INDOOR.length ? ALL_TABLES.map((t) => t.id).filter((id) => isAllOut([id]))[0] : null;
  it("is true only for a stated zone the tables are not all in", () => {
    expect(offZone({ preference: "indoor", tables: [out] })).toBe(true);
    expect(offZone({ preference: "indoor", tables: [INDOOR[0]] })).toBe(false);
    expect(offZone({ preference: "outdoor", tables: [INDOOR[0]] })).toBe(true);
    expect(offZone({ preference: "auto", tables: [out] })).toBe(false);
    expect(offZone({ preference: "indoor", tables: [] })).toBe(false);
    expect(offZone(null)).toBe(false);
  });
  // /code-review: `isIn` reads an unknown id as outdoor, so a booking left on a
  // renamed indoor table read "seated outdoor" from the Unplaced row.
  it("is false for a table the layout does not have", () => {
    expect(offZone({ preference: "indoor", tables: ["no-such-table"] })).toBe(false);
    expect(offZone({ preference: "indoor", tables: [INDOOR[0], "no-such-table"] })).toBe(false);
    expect(offZoneLabel({ preference: "indoor", tables: ["no-such-table"] })).toBe("");
  });
  it("names the flag and the save note", () => {
    const b = { preference: "indoor", tables: [out] };
    expect(offZoneLabel(b)).toBe("Wanted indoor, seated outdoor");
    expect(offZoneNote(b)).toBe("Seated outdoor: indoor was full.");
    const mixed = { preference: "indoor", tables: [INDOOR[0], out] };
    expect(offZoneLabel(mixed)).toBe("Wanted indoor, seated partly outdoor");
    expect(offZoneLabel({ preference: "indoor", tables: [INDOOR[0]] })).toBe("");
  });
});

describe("where it shows", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
  it("the rail's zone flag becomes the alert mark, in the same entry", () => {
    const tv = read("components/TimelineView.jsx");
    expect(tv).toMatch(/icon: offZone\(b\) \? <AlertIcon size=\{IC\.control\} \/> :/);
    expect(tv).toMatch(/title: offZone\(b\) \? offZoneLabel\(b\) :/);
  });
  it("the List card's tag turns warning ink", () => {
    expect(read("components/ListView.jsx")).toMatch(/<CardFlag ink=\{zoneOff \? FLAG_WARN : FLAG_NEUTRAL\} title=\{zoneOff \? offZoneLabel\(b\) :/);
  });
  it("both saves hand the note to the toast", () => {
    const app = read("App.jsx");
    expect(app).toMatch(/if\(ok\) flash\(null,!mt\.length&&placedNew\?offZoneNote\(placedNew\):""\);/);
    // v18.3.4: the edit's note is decided in `applyEdit` and handed to the
    // toast by App's wrapper.
    const save = read("lib/booking-save.js");
    expect(save).toMatch(/const zoneNote=!mt\.length&&edited&&offZone\(edited\)/);
    expect(save).toMatch(/flash:\(needsR\|\|swapAffected\|\|f\.status==="completed"\|\|seatingNow\|\|zoneNote\)\?\{kind:seatingNow\?"saved":null,note:zoneNote\}:null,/);
    expect(app).toMatch(/if\(plan\.flash&&ok\) flash\(plan\.flash\.kind,plan\.flash\.note\);/);
    expect(app).toMatch(/setReshuffledMsg\(savedToast\(k,active\)\+\(note\?" "\+note:""\)\);/);
  });
  it("the waitlist no longer filters out the other zone", () => {
    expect(read("lib/waitlist-match.js")).not.toMatch(/inZone/);
  });
});
