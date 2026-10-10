// tests/pick-rules.test.js
//
// v18.6.1 — the pick rules: which tables a host may pick together by hand
// (settings/layout.pickRules). Until this version the one rule the restaurant
// has, "10 and 13 need 11 and 12", was four table ids written into the two
// pickers, so renaming the indoor tables switched it off with nothing to show
// for it. It is the layout's now: stored, sanitised, renamed with its tables,
// edited in Settings → Layout, and asked through one function.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import {
  DEFAULT_LAYOUT, PICK_RULES, PICK_RULES_MAX, buildLayout, normalizePickRules, activePickRules,
} from "../src/lib/constants.js";
import { pickBlockedBy } from "../src/lib/booking-logic.js";
import { sanitizeLayout } from "../src/hooks/useLayout.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const code = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const ids = (...list) => Object.fromEntries(list.map((id) => [id, true]));
const stored = (more) => Object.assign(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)), more);

describe("pickBlockedBy — the default layout's rule", () => {
  it("the default has one rule: 10 and 13 need 11 and 12", () => {
    expect(DEFAULT_LAYOUT.pickRules).toEqual({ v: 1, rules: [{ pair: ["10", "13"], need: ["11", "12"] }] });
    expect(PICK_RULES).toEqual([{ pair: ["10", "13"], need: ["11", "12"] }]);
  });

  it("refuses the pair alone, and with only one of the two between", () => {
    expect(pickBlockedBy(["10", "13"])).toEqual(PICK_RULES[0]);
    expect(pickBlockedBy(["13", "10", "11"])).toEqual(PICK_RULES[0]);
    expect(pickBlockedBy(["10", "12", "13"])).toEqual(PICK_RULES[0]);
    expect(pickBlockedBy(["3", "10", "13"])).toEqual(PICK_RULES[0]);
  });

  it("allows the whole room, and either end without the other", () => {
    expect(pickBlockedBy(["10", "11", "12", "13"])).toBe(null);
    expect(pickBlockedBy(["13", "12", "11", "10", "9"])).toBe(null);
    expect(pickBlockedBy(["10", "11"])).toBe(null);
    expect(pickBlockedBy(["12", "13"])).toBe(null);
    expect(pickBlockedBy(["10"])).toBe(null);
    expect(pickBlockedBy([])).toBe(null);
    expect(pickBlockedBy(undefined)).toBe(null);
  });

  // The four ids in the pickers refused this set although the layout declares
  // it (seats 12) and the optimiser may place a party on it.
  it("lets a declared combo holding both through, and only once it is whole", () => {
    expect(pickBlockedBy(["1", "2", "9", "10", "13"])).toBe(null);
    expect(pickBlockedBy(["13", "9", "2", "10", "1", "4"])).toBe(null);
    expect(pickBlockedBy(["1", "2", "10", "13"])).toEqual(PICK_RULES[0]);
    expect(pickBlockedBy(["1", "9", "10", "13"])).toEqual(PICK_RULES[0]);
  });
});

describe("pickBlockedBy — any rules", () => {
  const rules = [{ pair: ["A", "D"], need: ["B", "C"] }, { pair: ["X", "Y"], need: ["Z"] }];
  it("answers with the first rule broken, and reads only the rules it is given", () => {
    expect(pickBlockedBy(["X", "Y", "A", "D"], rules, [])).toBe(rules[0]);
    expect(pickBlockedBy(["X", "Y", "A", "B", "C", "D"], rules, [])).toBe(rules[1]);
    expect(pickBlockedBy(["X", "Y", "Z", "A", "B", "C", "D"], rules, [])).toBe(null);
    expect(pickBlockedBy(["10", "13"], rules, [])).toBe(null);
    expect(pickBlockedBy(["10", "13"], [], [])).toBe(null);
  });
  it("a combo exempts only the rule whose pair it holds", () => {
    const combos = [{ ids: ["A", "D", "Q"], cap: 9 }];
    expect(pickBlockedBy(["A", "D", "Q"], rules, combos)).toBe(null);
    expect(pickBlockedBy(["A", "D"], rules, combos)).toBe(rules[0]);
    expect(pickBlockedBy(["A", "D", "Q", "X", "Y"], rules, combos)).toBe(rules[1]);
    // A combo holding one table of the pair says nothing about the pair.
    expect(pickBlockedBy(["A", "D", "Q"], rules, [{ ids: ["A", "Q"], cap: 4 }])).toBe(rules[0]);
  });
});

describe("normalizePickRules / activePickRules", () => {
  const set = ids("1", "2", "3", "4");
  it("an absent object is the default's rules; a present one is what it holds, nothing included", () => {
    expect(normalizePickRules(undefined, ids("10", "11", "12", "13"))).toEqual([{ pair: ["10", "13"], need: ["11", "12"] }]);
    expect(normalizePickRules(null, ids("10", "11", "12", "13"))).toHaveLength(1);
    expect(normalizePickRules({ v: 1 }, ids("10", "11", "12", "13"))).toEqual([]);
    expect(normalizePickRules({ v: 1, rules: [] }, ids("10", "11", "12", "13"))).toEqual([]);
  });
  it("keeps existing tables only: a pair of two, a need outside the pair, no repeats", () => {
    expect(normalizePickRules({ v: 1, rules: [
      { pair: ["1", "1", "9", "4", "3"], need: ["2", "4", "2", "9", "3", "1"] },
    ] }, set)).toEqual([{ pair: ["1", "4"], need: ["2", "3"] }]);
    expect(normalizePickRules({ v: 1, rules: [{ pair: [1, 2], need: [3] }] }, set)).toEqual([{ pair: ["1", "2"], need: ["3"] }]);
  });
  it("keeps a rule still being built, drops one with no pair, and anything that is not a rule", () => {
    expect(normalizePickRules({ v: 1, rules: [
      { pair: ["1", "2"] }, { pair: ["3"], need: ["4"] }, { pair: [], need: ["1"] }, { need: ["1"] }, { pair: ["9"] }, null, "x", 3,
    ] }, set)).toEqual([{ pair: ["1", "2"], need: [] }, { pair: ["3"], need: ["4"] }]);
  });
  it("only a whole rule is in force", () => {
    expect(activePickRules([{ pair: ["1", "2"], need: [] }, { pair: ["3"], need: ["4"] }, { pair: ["1", "4"], need: ["2"] }]))
      .toEqual([{ pair: ["1", "4"], need: ["2"] }]);
    expect(activePickRules(undefined)).toEqual([]);
  });
  it("holds at most PICK_RULES_MAX rules", () => {
    const many = Array.from({ length: PICK_RULES_MAX + 5 }, () => ({ pair: ["1", "2"], need: ["3"] }));
    expect(normalizePickRules({ v: 1, rules: many }, set)).toHaveLength(PICK_RULES_MAX);
  });
});

describe("the layout carries the rules", () => {
  it("a layout stored before the field reads as the default's rule, and is saved with it", () => {
    const old = stored({}); delete old.pickRules;
    expect(sanitizeLayout(old).pickRules).toEqual({ v: 1, rules: [{ pair: ["10", "13"], need: ["11", "12"] }] });
    expect(buildLayout(old).PICK_RULES).toEqual([{ pair: ["10", "13"], need: ["11", "12"] }]);
    expect(sanitizeLayout(null).pickRules).toEqual(DEFAULT_LAYOUT.pickRules);
  });
  it("an emptied list stays empty, as RTDB hands it back (the array gone, the marker left)", () => {
    expect(sanitizeLayout(stored({ pickRules: { v: 1 } })).pickRules).toEqual({ v: 1, rules: [] });
    expect(buildLayout(stored({ pickRules: { v: 1 } })).PICK_RULES).toEqual([]);
  });
  it("a removed table takes its rule's reference with it, and a rule left without its pair's second table is not in force", () => {
    const lay = stored({});
    lay.tables = lay.tables.filter((t) => t.id !== "13");
    expect(sanitizeLayout(lay).pickRules.rules).toEqual([{ pair: ["10"], need: ["11", "12"] }]);
    expect(buildLayout(sanitizeLayout(lay)).PICK_RULES).toEqual([]);
    const two = stored({}); two.tables = two.tables.filter((t) => t.id !== "12");
    expect(buildLayout(sanitizeLayout(two)).PICK_RULES).toEqual([{ pair: ["10", "13"], need: ["11"] }]);
  });
  it("a layout with other table names and no stored rules has none (the default's name tables it lacks)", () => {
    const lay = { tables: [{ id: "A", capacity: 2, zone: "indoor" }, { id: "B", capacity: 2, zone: "indoor" }] };
    expect(sanitizeLayout(lay).pickRules).toEqual({ v: 1, rules: [] });
  });
});

// The wiring a pure test cannot see: who asks, and who keeps the names in step.
describe("the pickers and the editor", () => {
  it("both pickers ask pickBlockedBy on every candidate set, and name no table", () => {
    for (const [file, calls] of [["components/ManualModal.jsx", 2], ["components/WalkinForm.jsx", 2]]) {
      const text = code(file);
      expect(text.split("if (pickBlockedBy(next)) return;").length - 1, file).toBe(calls);
      expect(text, file).not.toMatch(/\.includes\("(1[0-3]|i[1-4])"\)/);
    }
  });
  it("a rename renames the rules' tables with everything else", () => {
    const text = code("components/LayoutSettings.jsx");
    expect(text).toContain("pickRules: { v: 1, rules: pickRules.map(function (r) { return { pair: r.pair.map(rmap), need: r.need.map(rmap) }; }) }");
  });
  // sanitizeLayout drops a rule with nothing in its pair, so the last table of a
  // Pair cannot be taken out: it deleted the rule and its Needs (the /code-review).
  it("a Pair keeps its last table", () => {
    const text = code("components/LayoutSettings.jsx");
    expect(text).toContain("{ max: 2, min: 1, exclude: r.need }");
    expect(text).toContain("const keep = list.length <= ((opts && opts.min) || 0);");
    expect(text).toContain("disabled={keep}");
  });
  it("every edit writes the whole list under its marker", () => {
    const text = code("components/LayoutSettings.jsx");
    expect(text).toContain("function savePick(rules) { onSaveLayout({ ...layout, pickRules: { v: 1, rules: rules } }); }");
    expect(text.split("savePick(").length - 1).toBe(4);
  });
});
