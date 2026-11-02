// v18.14.0 (L2): the Plan's phone targets. A box too small is a table nobody can hit,
// and a box too generous is a tap that opens the wrong table, which is worse.
import { describe, it, expect } from "vitest";
import { hitBoxes, PHONE_HIT } from "../src/lib/plan-hit.js";
import { DEFAULT_LAYOUT } from "../src/lib/constants.js";

const roomTables = Object.entries(DEFAULT_LAYOUT.floorPlan.tables).map(([id, e]) => ({ id, ...e }));
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("hitBoxes", () => {
  it("gives a lone table the whole target, centred on it", () => {
    const box = hitBoxes([{ id: "1", x: 100, y: 200, w: 60, shape: "round" }], 124)["1"];
    expect(box).toEqual({ x: 38, y: 138, w: 124, h: 124 });
  });

  it("never shrinks a table wider than the target", () => {
    const box = hitBoxes([{ id: "1", x: 200, y: 200, w: 300, h: 60, shape: "rect" }], 124)["1"];
    expect(box).toEqual({ x: 50, y: 138, w: 300, h: 124 });
  });

  it("splits the gap between neighbours down the middle", () => {
    const b = hitBoxes([
      { id: "a", x: 100, y: 100, w: 60, shape: "square" },
      { id: "b", x: 200, y: 100, w: 60, shape: "square" },
    ], 124);
    expect(b.a.x + b.a.w).toBe(150);
    expect(b.b.x).toBe(150);
    expect(b.a.h).toBe(124);
  });

  it("measures a turned rectangle by what is drawn", () => {
    const b = hitBoxes([{ id: "a", x: 300, y: 300, w: 200, h: 40, shape: "rect", rot: 90 }], 124).a;
    expect(b.w).toBeCloseTo(124);
    expect(b.h).toBeCloseTo(200);
  });

  describe("on the real room", () => {
    const boxes = hitBoxes(roomTables, PHONE_HIT);
    it("has a box for every table, holding the table it stands for", () => {
      expect(Object.keys(boxes)).toHaveLength(roomTables.length);
      for (const e of roomTables) {
        const b = boxes[e.id], half = (e.shape === "rect" ? Math.max(e.w, e.h) : e.w) / 2;
        // A turned table's bounding box sits inside this square whatever its angle.
        if (!e.rot) {
          expect(b.x, e.id).toBeLessThanOrEqual(e.x - e.w / 2);
          expect(b.x + b.w, e.id).toBeGreaterThanOrEqual(e.x + e.w / 2);
        }
        expect(b.w * b.h, e.id).toBeGreaterThanOrEqual(half * half);
      }
    });
    it("lets no two boxes overlap, so a tap has one answer", () => {
      for (let i = 0; i < roomTables.length; i++) {
        for (let j = i + 1; j < roomTables.length; j++) {
          const a = boxes[roomTables[i].id], b = boxes[roomTables[j].id];
          expect(overlap(a, b), roomTables[i].id + " and " + roomTables[j].id).toBe(false);
        }
      }
    });
    it("reaches the bar on a 375px phone, where 900 units are drawn 323px wide", () => {
      const px = 323 / 900;
      for (const e of roomTables) {
        const b = boxes[e.id];
        expect(Math.min(b.w, b.h) * px, e.id).toBeGreaterThanOrEqual(24);
      }
    });
  });
});
