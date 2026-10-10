// tests/layout-default.test.js
//
// v18.6.1 — the default layout is the restaurant's tables as renumbered on
// 2026-10-10 (1–13; they were 1A 1B 2 3 4 5A 5B 6 7 i1 i2 i3 i4, in that
// order). "2", "3", "4", "6" and "7" are ids in both numberings, so a half
// renamed default still builds and still places bookings. This file is what
// says it is whole.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import {
  DEFAULT_LAYOUT, buildLayout, comboKey, ALL_TABLES, INDOOR, OUTDOOR, TOTAL_SEATS, VALID_COMBOS, CLUSTERS, TABLE_GROUPS, PRIORITIES,
} from "../src/lib/constants.js";
import { sanitizeLayout } from "../src/hooks/useLayout.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const IDS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
const capOf = (ids) => (VALID_COMBOS.find((c) => c.ids.join("|") === ids.join("|")) || {}).cap;

describe("the default layout (v18.6.1)", () => {
  it("is tables 1–13: nine outdoor, four indoor, 28 seats", () => {
    expect(ALL_TABLES.map((t) => t.id)).toEqual(IDS);
    expect(OUTDOOR.map((t) => t.id)).toEqual(IDS.slice(0, 9));
    expect(INDOOR.map((t) => t.id)).toEqual(IDS.slice(9));
    expect(ALL_TABLES.filter((t) => t.capacity !== 2).map((t) => t.id + ":" + t.capacity)).toEqual(["9:4"]);
    expect(TOTAL_SEATS).toBe(28);
  });

  it("joins 3+4+5, 6+7+8, 11+12+13 and 1+2, and nothing else", () => {
    expect(DEFAULT_LAYOUT.joinGroups).toEqual([["3", "4", "5"], ["6", "7", "8"], ["11", "12", "13"], ["1", "2"]]);
    expect(CLUSTERS["4"]).toEqual(["3", "4", "5"]);
    expect(CLUSTERS["2"]).toEqual(["1", "2"]);
    expect(CLUSTERS["9"]).toEqual(["9"]);
    expect(CLUSTERS["10"]).toEqual(["10"]);
  });

  it("builds 40 combos, a joined pair seating 5 except 4+5", () => {
    expect(VALID_COMBOS).toHaveLength(40);
    expect([capOf(["1", "2"]), capOf(["3", "4"]), capOf(["6", "7"]), capOf(["7", "8"]), capOf(["11", "12"]), capOf(["12", "13"])])
      .toEqual([5, 5, 5, 5, 5, 5]);
    expect(capOf(["4", "5"])).toBe(4);
    expect([capOf(["3", "4", "5"]), capOf(["6", "7", "8"]), capOf(["11", "12", "13"])]).toEqual([8, 8, 8]);
  });

  it("names only its own tables, in every part", () => {
    const known = new Set(IDS);
    const named = [].concat(
      DEFAULT_LAYOUT.joinGroups.flat(),
      Object.keys(DEFAULT_LAYOUT.comboCaps).flatMap((k) => k.split("|")),
      DEFAULT_LAYOUT.megaCombos.flatMap((m) => m.ids),
      Object.keys(DEFAULT_LAYOUT.floorPlan.tables),
      DEFAULT_LAYOUT.pickRules.rules.flatMap((r) => r.pair.concat(r.need)),
      PRIORITIES.anchors,
      PRIORITIES.mixedRequire,
      PRIORITIES.swapRules.map((r) => r.table),
      PRIORITIES.comboRules.flatMap((r) => r.key.split("|")),
      PRIORITIES.bands.flatMap((b) => [].concat(b.prefer || [], b.avoid || [])),
    );
    expect(named.filter((id) => !known.has(id))).toEqual([]);
    expect(Object.keys(DEFAULT_LAYOUT.floorPlan.tables).sort()).toEqual(IDS.slice().sort());
    expect(PRIORITIES.anchors).toEqual(["13", "10"]);
  });

  // A key is the SORTED ids joined by "|", and the sort is a string sort: the
  // combo 1+2+9+13 is "1|13|2|9". A key written in counting order names real
  // tables, so the check above passes it, and matches no combo: the rule or the
  // seat count it carries would be dead with nothing to show for it.
  it("every seat override and every combo rule is the key of a combo it builds", () => {
    const keys = new Set(VALID_COMBOS.map((c) => comboKey(c.ids)));
    expect(Object.keys(DEFAULT_LAYOUT.comboCaps).filter((k) => !keys.has(k))).toEqual([]);
    expect(PRIORITIES.comboRules.map((r) => r.key).filter((k) => !keys.has(k))).toEqual([]);
    expect(PRIORITIES.comboRules).toHaveLength(15);
    expect(keys.has("1|13|2|9")).toBe(true);
    expect(keys.has("1|2|9|13")).toBe(false);
  });

  it("survives its own sanitizer, floor plan included", () => {
    const clean = sanitizeLayout(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)));
    expect(clean.tables).toEqual(DEFAULT_LAYOUT.tables);
    expect(clean.joinGroups).toEqual(DEFAULT_LAYOUT.joinGroups);
    expect(clean.comboCaps).toEqual(DEFAULT_LAYOUT.comboCaps);
    expect(clean.megaCombos).toEqual(DEFAULT_LAYOUT.megaCombos);
    expect(Object.keys(clean.floorPlan.tables).sort()).toEqual(IDS.slice().sort());
    for (const id of IDS) {
      expect([clean.floorPlan.tables[id].x, clean.floorPlan.tables[id].y]).toEqual(
        [DEFAULT_LAYOUT.floorPlan.tables[id].x, DEFAULT_LAYOUT.floorPlan.tables[id].y]);
    }
    // No layout node at all is the default too, with the same plan.
    expect(sanitizeLayout(null).floorPlan).toEqual(clean.floorPlan);
    expect(buildLayout(clean).VALID_COMBOS).toEqual(VALID_COMBOS);
  });
});

describe("the table pickers' grouping is derived, for every layout (v18.6.1)", () => {
  it("one section per join group with its combo seats, then the standalone tables", () => {
    expect(TABLE_GROUPS.map((g) => [g.name, g.note, g.tables.map((t) => t.id).join(",")])).toEqual([
      ["Tables: 3 / 4 / 5", "3+4 = 5 · 4+5 = 4 · 3+4+5 = 8", "3,4,5"],
      ["Tables: 6 / 7 / 8", "6+7 = 5 · 7+8 = 5 · 6+7+8 = 8", "6,7,8"],
      ["Tables: 11 / 12 / 13", "11+12 = 5 · 12+13 = 5 · 11+12+13 = 8", "11,12,13"],
      ["Tables: 1 / 2", "1+2 = 5", "1,2"],
      ["Table: 9", null, "9"],
      ["Table: 10", null, "10"],
    ]);
  });

  it("the hand-written grouping and its switch are gone from src", () => {
    const walk = (dir, out) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.jsx?$/.test(name)) out.push(p);
      }
      return out;
    };
    const hits = [];
    for (const file of walk(SRC, [])) {
      const code = stripComments(readFileSync(file, "utf8")).join("\n");
      if (/IS_MGT_LAYOUT|TABLE_GROUP_STRUCT|MGT_SIGNATURE|layoutSignature/.test(code)) hits.push(file.slice(SRC.length + 1));
    }
    expect(hits).toEqual([]);
  });
});
