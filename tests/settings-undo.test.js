// v18.19.1 (Patryk): Settings → Layout's Undo history (src/lib/settings-undo.js).
import { describe, it, expect } from "vitest";
import { stableKey, changedPaths, describeStep, recordStep, undoStep, UNDO_CONFLICT } from "../src/lib/settings-undo";
import { sanitizeLayout } from "../src/hooks/useLayout";
import { DEFAULT_LAYOUT } from "../src/lib/constants";

const base = sanitizeLayout(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)));
function edit(fn) { const c = JSON.parse(JSON.stringify(base)); fn(c); return sanitizeLayout(c); }
function step(before, after) { return describeStep(before, after, changedPaths(before, after)); }

describe("stableKey", () => {
  it("ignores object key order and keeps array order", () => {
    expect(stableKey({ a: 1, b: { c: 2, d: 3 } })).toBe(stableKey({ b: { d: 3, c: 2 }, a: 1 }));
    expect(stableKey([1, 2])).not.toBe(stableKey([2, 1]));
  });
  it("an echo with its map keys sorted, as RTDB returns it, reads as the same layout", () => {
    const caps = { "1|2": 5, "10|11": 4 };
    const sorted = { "10|11": 4, "1|2": 5 };
    expect(stableKey({ ...base, comboCaps: caps })).toBe(stableKey({ ...base, comboCaps: sorted }));
  });
});

describe("changedPaths", () => {
  it("names the leaf that changed", () => {
    const a = edit((c) => { c.tables[2].capacity = 6; });
    expect(changedPaths(base, a)).toEqual(["tables.2.capacity"]);
  });
  it("is empty for the same layout", () => { expect(changedPaths(base, edit(() => {}))).toEqual([]); });
});

describe("describeStep: what the pill says", () => {
  it("tables", () => {
    expect(step(base, edit((c) => { c.tables[2].capacity = 6; }))).toBe("Seat count of table " + base.tables[2].id + " changed");
    expect(step(base, edit((c) => { c.tables[0].zone = "indoor"; }))).toBe("Table " + base.tables[0].id + " moved indoors");
    expect(step(base, edit((c) => { c.tables.push({ id: "99", capacity: 2, zone: "outdoor" }); }))).toBe("Table 99 added");
    expect(step(base, edit((c) => { c.tables.splice(1, 1); }))).toBe("Table " + base.tables[1].id + " removed");
    expect(step(base, edit((c) => { const t = c.tables[0]; c.tables[0] = c.tables[1]; c.tables[1] = t; }))).toBe("Tables reordered");
  });
  it("the ordered rule lists: added, removed, reordered, one changed", () => {
    expect(base.priorities.bands.length).toBeGreaterThan(1);
    expect(step(base, edit((c) => { c.priorities.bands.reverse(); }))).toBe("Size rules reordered");
    expect(step(base, edit((c) => { c.priorities.bands[1].max += 1; }))).toBe("Size rule 2 changed");
    expect(step(base, edit((c) => { c.priorities.bands.pop(); }))).toBe("Size rule removed");
    expect(step(base, edit((c) => { c.kitchenLimit += 1; }))).toBe("Kitchen limit changed");
  });
});

describe("recordStep", () => {
  it("records a save, and a save that changed nothing returns the same stack", () => {
    const a = edit((c) => { c.kitchenLimit += 1; });
    const s = recordStep([], base, a);
    expect(s).toHaveLength(1);
    expect(recordStep(s, a, a)).toBe(s);
  });
  it("taps on one stepper in a row are one step, keeping the oldest before", () => {
    const a = edit((c) => { c.kitchenLimit = 4; });
    const b = edit((c) => { c.kitchenLimit = 5; });
    const s = recordStep(recordStep([], base, a), a, b);
    expect(s).toHaveLength(1);
    expect(s[0].before).toBe(base);
    expect(s[0].after).toBe(b);
  });
  it("stepped back to where it started, the step is gone", () => {
    const a = edit((c) => { c.kitchenLimit += 1; });
    expect(recordStep(recordStep([], base, a), a, base)).toEqual([]);
  });
  it("a tap on ANOTHER stepper is a new step", () => {
    const a = edit((c) => { c.kitchenLimit += 1; });
    const b = sanitizeLayout({ ...JSON.parse(JSON.stringify(a)), tables: a.tables.map((t, i) => (i === 0 ? { ...t, capacity: t.capacity + 1 } : t)) });
    expect(recordStep(recordStep([], base, a), a, b)).toHaveLength(2);
  });
});

describe("undoStep", () => {
  const a = edit((c) => { c.kitchenLimit += 1; });
  const b = edit((c) => { c.kitchenLimit += 1; c.tables[0].capacity += 1; });
  const stack = recordStep(recordStep([], base, a), a, b);
  it("takes back one step at a time, back to the start", () => {
    const one = undoStep(stack, b);
    expect(one.restore).toBe(a);
    const two = undoStep(one.rest, a);
    expect(two.restore).toBe(base);
    expect(two.rest).toEqual([]);
    expect(undoStep([], base)).toBeNull();
  });
  it("refuses when the stored layout is not what this device wrote", () => {
    const other = edit((c) => { c.tables[3].capacity += 2; });
    expect(undoStep(stack, other)).toEqual({ refuse: UNDO_CONFLICT });
    expect(UNDO_CONFLICT).toBe("Changed on another device, can't undo");
  });
  it("an echo differing only in key order is not another device", () => {
    // Every object's keys reversed, as a stand-in for RTDB's sorted echo.
    function flip(v) {
      if (Array.isArray(v)) return v.map(flip);
      if (v && typeof v === "object") { const o = {}; Object.keys(v).reverse().forEach((k) => { o[k] = flip(v[k]); }); return o; }
      return v;
    }
    const echo = flip(b);
    expect(JSON.stringify(echo)).not.toBe(JSON.stringify(b));
    expect(undoStep(stack, echo).restore).toBe(a);
  });
});

// v18.19.1 /code-review: a value another device set between two taps on one
// stepper must not vanish into the merge.
describe("recordStep across another device's change", () => {
  it("does not merge when this save does not start from the last one's after", () => {
    const a = edit((c) => { c.kitchenLimit = 4; });
    const remote = edit((c) => { c.kitchenLimit = 6; });
    const b = edit((c) => { c.kitchenLimit = 7; });
    const s = recordStep(recordStep([], base, a), remote, b);
    expect(s).toHaveLength(2);
    expect(s[1].before).toBe(remote);
    // …so taking the first step back is refused once the second is undone.
    expect(undoStep(s.slice(0, 1), remote)).toEqual({ refuse: UNDO_CONFLICT });
  });
});
