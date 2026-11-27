// tests/reorder.test.js — v18.19.1: drag-to-reorder's pure half
// (src/lib/reorder.js): where an item lands, and the tables' zone rule.
import { describe, it, expect } from "vitest";
import { moveItem, slotAt, zoneOrdered, zoneTables, moveWithinZone } from "../src/lib/reorder.js";

describe("moveItem", () => {
  const L = ["a", "b", "c", "d"];
  it("moves down and up", () => {
    expect(moveItem(L, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(L, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("never mutates its input", () => {
    const copy = L.slice();
    moveItem(L, 0, 3);
    expect(L).toEqual(copy);
  });
  it("returns the SAME array when nothing moves", () => {
    expect(moveItem(L, 2, 2)).toBe(L);
    expect(moveItem(L, -1, 2)).toBe(L);
    expect(moveItem(L, 0, 4)).toBe(L);
    expect(moveItem(L, 1.5, 2)).toBe(L);
  });
  it("round-trips: every from/to pair, moved back, is the original", () => {
    for (let f = 0; f < L.length; f++) for (let t = 0; t < L.length; t++) {
      expect(moveItem(moveItem(L, f, t), t, f)).toEqual(L);
    }
  });
});

describe("slotAt — a column", () => {
  // Three other rows, 40 tall, at 0, 50 and 100 (centres 20, 70, 120).
  const rows = [0, 50, 100].map((top) => ({ left: 0, top, width: 300, height: 40 }));
  it("counts the rows whose centre is above the dragged centre", () => {
    expect(slotAt(rows, { x: 10, y: -30 }, "y")).toBe(0);
    expect(slotAt(rows, { x: 10, y: 21 }, "y")).toBe(1);
    expect(slotAt(rows, { x: 10, y: 69 }, "y")).toBe(1);
    expect(slotAt(rows, { x: 10, y: 71 }, "y")).toBe(2);
    expect(slotAt(rows, { x: 10, y: 999 }, "y")).toBe(3);
  });
  it("rows of different heights still cut at each centre", () => {
    const mixed = [{ left: 0, top: 0, width: 300, height: 200 }, { left: 0, top: 210, width: 300, height: 40 }];
    expect(slotAt(mixed, { x: 0, y: 99 }, "y")).toBe(0);
    expect(slotAt(mixed, { x: 0, y: 101 }, "y")).toBe(1);
    expect(slotAt(mixed, { x: 0, y: 231 }, "y")).toBe(2);
  });
  it("answers 0 for nothing to pass", () => {
    expect(slotAt([], { x: 0, y: 0 }, "y")).toBe(0);
    expect(slotAt(null, { x: 0, y: 0 }, "y")).toBe(0);
  });
});

describe("slotAt — a wrapping row (chips)", () => {
  // Line 1: chips at x 0, 60, 120 (y 0–30); line 2: chips at x 0, 60 (y 40–70).
  const chip = (left, top) => ({ left, top, width: 50, height: 30 });
  const chips = [chip(0, 0), chip(60, 0), chip(120, 0), chip(0, 40), chip(60, 40)];
  it("on a line, compares x with each chip's centre", () => {
    expect(slotAt(chips, { x: 10, y: 15 }, "wrap")).toBe(0);
    expect(slotAt(chips, { x: 30, y: 15 }, "wrap")).toBe(1);
    expect(slotAt(chips, { x: 200, y: 15 }, "wrap")).toBe(3);
  });
  it("a whole line above counts", () => {
    expect(slotAt(chips, { x: 10, y: 55 }, "wrap")).toBe(3);
    expect(slotAt(chips, { x: 90, y: 55 }, "wrap")).toBe(5);
  });
  it("between two lines, every chip above counts", () => {
    expect(slotAt(chips, { x: 500, y: 35 }, "wrap")).toBe(3);
  });
});

describe("the tables' zone rule", () => {
  const T = (id, zone) => ({ id, capacity: 2, zone });
  const mixed = [T("1", "outdoor"), T("10", "indoor"), T("2", "outdoor"), T("11", "indoor"), T("3", "outdoor")];
  it("zoneOrdered puts outdoor first and keeps each zone's order", () => {
    expect(zoneOrdered(mixed).map((t) => t.id)).toEqual(["1", "2", "3", "10", "11"]);
  });
  it("zoneOrdered returns the SAME array when already in order", () => {
    const ok = zoneOrdered(mixed);
    expect(zoneOrdered(ok)).toBe(ok);
  });
  it("a table without a zone counts as outdoor, as buildLayout reads it", () => {
    expect(zoneTables([{ id: "x" }], "outdoor").map((t) => t.id)).toEqual(["x"]);
  });
  it("moveWithinZone moves among its own zone only, and saves zone-ordered", () => {
    expect(moveWithinZone(mixed, "3", 0).map((t) => t.id)).toEqual(["3", "1", "2", "10", "11"]);
    expect(moveWithinZone(mixed, "10", 1).map((t) => t.id)).toEqual(["1", "2", "3", "11", "10"]);
  });
  it("an index past the zone's end moves nothing", () => {
    const ok = zoneOrdered(mixed);
    expect(moveWithinZone(ok, "10", 3)).toBe(ok);
  });
  it("an unknown id moves nothing", () => {
    expect(moveWithinZone(mixed, "99", 0)).toBe(mixed);
  });
  it("never changes a table's zone or drops one", () => {
    for (const t of mixed) for (let to = 0; to < 3; to++) {
      const next = moveWithinZone(mixed, t.id, to);
      expect(next.length).toBe(mixed.length);
      expect(next.find((x) => x.id === t.id).zone).toBe(t.zone);
      expect(next.map((x) => x.zone)).toEqual(["outdoor", "outdoor", "outdoor", "indoor", "indoor"]);
    }
  });
});
