// tests/unplaced.test.js — v18.2.0: lib/unplaced.js and the three surfaces
// that read it (the timeline's Unplaced row, the strip's "Not on the grid"
// section, the Summary's "N of M on the grid").
//
// Found by the design critique on DEV: 8 of 12 bookings on 3 Oct held table ids
// the layout did not have (`1`, `5`, `8`–`13`), so the grid drew 4 while the
// header said 12, with nothing anywhere saying why. The fixtures below are that
// day's shapes.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { unplacedReason, unplacedOf, primaryGridTable, unplacedPhrase, packLanes } from "../src/lib/unplaced.js";

const GRID = new Set(["1A", "1B", "2", "3", "4", "5A", "5B", "6", "7", "i1", "i2", "i3", "i4"]);
const bk = (over) => Object.assign({ id: "x", date: "2026-10-03", time: "20:00", size: 2, status: "confirmed", tables: ["2"], _conflict: false }, over);

describe("unplacedReason", () => {
  it("a booking on real tables is placed", () => {
    expect(unplacedReason(bk({ tables: ["3", "4"] }), GRID)).toBeNull();
  });

  it("a table the layout does not have is 'missing', and names it", () => {
    expect(unplacedReason(bk({ tables: ["9"] }), GRID)).toEqual({ reason: "missing", missing: ["9"] });
    expect(unplacedReason(bk({ tables: ["11", "12"] }), GRID)).toEqual({ reason: "missing", missing: ["11", "12"] });
  });

  it("HALF-placed (tables 1 and 2, only 2 exists) is unplaced too — the gap must be visible", () => {
    expect(unplacedReason(bk({ tables: ["1", "2"] }), GRID)).toEqual({ reason: "missing", missing: ["1"] });
  });

  it("no tables is 'none', an optimiser conflict on real tables is 'conflict'", () => {
    expect(unplacedReason(bk({ tables: [] }), GRID).reason).toBe("none");
    expect(unplacedReason(bk({ tables: undefined }), GRID).reason).toBe("none");
    expect(unplacedReason(bk({ tables: ["2"], _conflict: true }), GRID).reason).toBe("conflict");
  });

  it("'missing' outranks 'conflict' — naming the absent table is the more useful sentence", () => {
    expect(unplacedReason(bk({ tables: ["9"], _conflict: true }), GRID).reason).toBe("missing");
  });

  it("cancelled and COMPLETED are never unplaced (the old row's rule, kept)", () => {
    expect(unplacedReason(bk({ status: "cancelled", tables: ["9"] }), GRID)).toBeNull();
    expect(unplacedReason(bk({ status: "completed", tables: [] }), GRID)).toBeNull();
    expect(unplacedReason(bk({ status: "completed", tables: ["9"] }), GRID)).toBeNull();
  });

  it("seated and pending count like confirmed", () => {
    expect(unplacedReason(bk({ status: "seated", tables: ["9"] }), GRID).reason).toBe("missing");
    expect(unplacedReason(bk({ status: "pending", tables: [] }), GRID).reason).toBe("none");
  });
});

describe("unplacedOf", () => {
  it("keeps input order and carries each reason — the 3 Oct day", () => {
    const day = [
      bk({ id: "a", tables: ["1"] }), bk({ id: "r", tables: ["2"] }), bk({ id: "e", tables: ["1", "2"] }),
      bk({ id: "t", tables: ["3", "4"] }), bk({ id: "c", tables: ["11", "12"] }), bk({ id: "x", status: "cancelled", tables: ["9"] }),
    ];
    const out = unplacedOf(day, GRID);
    expect(out.map((u) => u.b.id)).toEqual(["a", "e", "c"]);
    expect(out.map((u) => u.missing)).toEqual([["1"], ["1"], ["11", "12"]]);
  });
});

describe("primaryGridTable — which cell carries the FLIP id", () => {
  it("is the first table the grid draws, not tables[0]", () => {
    expect(primaryGridTable(bk({ tables: ["1", "2"] }), GRID)).toBe("2");
    expect(primaryGridTable(bk({ tables: ["3", "4"] }), GRID)).toBe("3");
  });
  it("is null when none has a row, so the Unplaced cell takes it", () => {
    expect(primaryGridTable(bk({ tables: ["9"] }), GRID)).toBeNull();
    expect(primaryGridTable(bk({ tables: [] }), GRID)).toBeNull();
  });
});

describe("unplacedPhrase", () => {
  it("says what is wrong, naming the missing ids", () => {
    expect(unplacedPhrase({ reason: "missing", missing: ["9"] })).toBe("table 9 isn't in the layout");
    expect(unplacedPhrase({ reason: "missing", missing: ["11", "12"] })).toBe("tables 11, 12 aren't in the layout");
    expect(unplacedPhrase({ reason: "none", missing: [] })).toBe("no table assigned");
    expect(unplacedPhrase({ reason: "conflict", missing: [] })).toBe("couldn't be placed on a table");
  });
});

describe("packLanes — the Unplaced row never paints one block over another", () => {
  const it_ = (id, s, e) => ({ id, s, e });
  it("overlapping intervals go to separate lanes; touching ones share", () => {
    const lanes = packLanes([it_("a", 1200, 1290), it_("b", 1200, 1290), it_("c", 1290, 1380)]);
    expect(lanes.map((l) => l.map((x) => x.id))).toEqual([["a", "c"], ["b"]]);
  });

  it("no lane ever holds two overlapping intervals", () => {
    const items = [];
    for (let i = 0; i < 40; i++) { const s = 780 + ((i * 37) % 540); items.push(it_("k" + i, s, s + 60 + ((i * 13) % 90))); }
    for (const lane of packLanes(items)) {
      const sorted = lane.slice().sort((p, q) => p.s - q.s);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].s).toBeGreaterThanOrEqual(sorted[i - 1].e);
    }
  });

  it("is deterministic whatever the input order (same lanes on every device)", () => {
    const items = [it_("b", 1200, 1290), it_("a", 1200, 1290), it_("c", 1230, 1320)];
    const key = (ls) => JSON.stringify(ls.map((l) => l.map((x) => x.id)));
    expect(key(packLanes(items))).toBe(key(packLanes(items.slice().reverse())));
  });

  it("no input, no lanes — the row is not drawn", () => {
    expect(packLanes([])).toEqual([]);
  });
});

describe("the surfaces read the ONE rule", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
  const Timeline = read("components/TimelineView.jsx");
  const App = read("App.jsx");

  it("the timeline's row comes from unplacedOf, and is drawn ABOVE the table rows", () => {
    expect(Timeline).toMatch(/const unplaced = unplacedOf\(day, gridIds\)/);
    const body = Timeline.slice(Timeline.indexOf("{headerLabels}"));
    expect(body.indexOf("{unplacedGrid}")).toBeGreaterThan(-1);
    expect(body.indexOf("{unplacedGrid}"), "Unplaced row before the table rows").toBeLessThan(body.indexOf("{gridRows}"));
  });

  it("the drop target skips the Unplaced row's height", () => {
    expect(Timeline).toMatch(/getBoundingClientRect\(\)\.top \+ 24 \+ unplacedH;/);
    expect(Timeline).toMatch(/const unplacedH = unplacedLanes\.length > 0 \? unplacedLanes\.length \* ROW_H \+ UNPLACED_GAP : 0;/);
  });

  it("no cell keys its FLIP id on tables[0] any more", () => {
    expect(Timeline).not.toMatch(/\(b\.tables \|\| \[\]\)\[0\] === id/);
  });

  it("App's strip section and the Summary read the same memo", () => {
    expect(App).toMatch(/const unplacedItems=useMemo\(/);
    expect(App).toMatch(/unplacedItems\.length\?\[\{id:"unplaced"[^]*?icon:UnplacedIcon/);
    expect(App).toMatch(/unplacedCount=\{unplacedItems\.length\}/);
    expect(App).toMatch(/\},\[bookings,viewDate,layout\]\);/);
  });
});

// v18.2.0 phase 69 (the ROADMAP follow-up): the Unplaced row and the strip's
// "Not on the grid" named a table the layout does not have, while the List
// card still drew it as a real teal pill. Measured on DEV, Sat 03.10: Emil
// Kovacs's table "1" dashed in rgb(74, 85, 104) with no fill and named "Table 1,
// not in the layout", his real table "2" the solid outdoor teal; Noa Ribera's
// "13" dashed the same way.
describe("phase 69 — the List card's pill says a table is missing", () => {
  const SRC2 = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const rd = (rel) => stripComments(readFileSync(join(SRC2, rel), "utf8")).join("\n");
  it("TBadge draws a missing table dashed, without the zone fill, and names it", () => {
    const tb = rd("components/atoms.jsx");
    const fn = tb.slice(tb.indexOf("export function TBadge"), tb.indexOf("export function TBadge") + 700);
    expect(fn).toMatch(/export function TBadge\(\{ id, missing = false \}\)/);
    expect(fn).toMatch(/border: "1px dashed var\(--text-secondary\)"/);
    expect(fn).toMatch(/background: "transparent", color: "var\(--text-secondary\)"/);
    expect(fn).toMatch(/aria-label=\{"Table " \+ id \+ ", not in the layout"\}/);
  });
  it("the card asks the SAME rule the Unplaced row and the strip read", () => {
    const App = rd("App.jsx");
    expect(App).toMatch(/unplacedItems\.forEach\(function\(u\)\{if\(u\.reason==="missing"\) out\[u\.b\.id\]=u\.missing;\}\);/);
    expect(App).toMatch(/<ListView\s+missingTables=\{missingTables\}/);
    expect(rd("components/ListView.jsx")).toMatch(/<TBadge key=\{t\} id=\{t\} missing=\{\(missingTables\[b\.id\] \|\| \[\]\)\.indexOf\(t\) >= 0\} \/>/);
  });
});
