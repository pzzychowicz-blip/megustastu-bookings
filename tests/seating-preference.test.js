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
    expect(app).toMatch(/if\(ok\) flash\(null,placedNew\?offZoneNote\(placedNew\):""\);/);
    expect(app).toMatch(/flash\(seatingNow\?"saved":null,zoneNote\);/);
    expect(app).toMatch(/setReshuffledMsg\(savedToast\(k,active\)\+\(note\?" "\+note:""\)\);/);
  });
  it("the waitlist no longer filters out the other zone", () => {
    expect(read("lib/waitlist-match.js")).not.toMatch(/inZone/);
  });
});
