// tests/unplaced.test.js — v18.2.0: lib/unplaced.js and the three surfaces
// that read it (the timeline's Unplaced row, the strip's "Not on the grid"
// section, the Summary's "N of M on the grid").
//
// Found by the design critique on DEV: 8 of 12 bookings on 3 Oct held table ids
// the layout did not have (`1`, `5`, `8`–`13`), so the grid drew 4 while the
// header said 12, with nothing anywhere saying why. The fixtures below are that
// day's shapes.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { unplacedReason, unplacedOf, primaryGridTable, unplacedPhrase, packLanes, unplacedHeight } from "../src/lib/unplaced.js";
import { everyFrame } from "../src/lib/after-frame.js";

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

  it("the drop target starts the table rows at the Unplaced box's LIVE bottom (v18.3.2, O4)", () => {
    // `unplacedH` is where the box is heading; while it eases, only its live
    // bottom says where the rows are, or a drop lands a row off.
    expect(Timeline).toMatch(/const top = u \? u\.getBoundingClientRect\(\)\.bottom : el\.getBoundingClientRect\(\)\.top \+ 24 \+ unplacedH;/);
    expect(Timeline).toMatch(/const unplacedH = unplacedHeight\(unplacedLanes\.length, ROW_H, UNPLACED_GAP\);/);
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

// v18.3.2 (O4): the Unplaced row mounted at full height, so the table labels
// and row lines jumped 48px in one frame, and when a booking's tables changed in
// the same commit useFlip read the shift as a move: on DEV a block on 1B started
// over 1A and slid down into its own row (−48px, −16 by 165ms). It eases now,
// both columns on one box, and useFlip re-measures quietly once it settles.
describe("the Unplaced row eases open and shut (v18.3.2, O4)", () => {
  const SRC3 = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const TL = stripComments(readFileSync(join(SRC3, "components/TimelineView.jsx"), "utf8")).join("\n");

  it("unplacedHeight is the lanes plus the gap, and nothing for no lanes", () => {
    expect(unplacedHeight(0, 44, 4)).toBe(0);
    expect(unplacedHeight(1, 44, 4)).toBe(48);
    expect(unplacedHeight(3, 44, 4)).toBe(136);
  });

  it("both halves are ONE always-mounted box, so they cannot ease apart", () => {
    expect(TL.split("style={unplacedLabelBox}").length - 1).toBe(1);
    expect(TL.split("style={unplacedGridBox}").length - 1).toBe(1);
    expect(TL).toMatch(/<div ref=\{unplacedRef\} style=\{unplacedGridBox\}>/);
    expect(TL).toMatch(/const unplacedLabelBox = \{ \.\.\.unplacedBox, /);
    expect(TL).toMatch(/const unplacedGridBox = \{ \.\.\.unplacedBox, /);
    expect(TL, "neither half mounts with its content any more").not.toMatch(/unplaced\.length > 0 \? \(/);
  });

  it("the box eases on --t-shift only while the row is moving", () => {
    expect(TL).toMatch(/const unplacedEasing = unplacedRow\.moving;/);
    expect(TL).toMatch(/const unplacedBox = \{\s*position: "relative",\s*height: unplacedH \+ "px",\s*transition: unplacedEasing \? "height " \+ M\.shift : "none"\s*\};/);
  });

  it("the label column clips while it eases; the grid column never does, and lifts", () => {
    // Clipped, a booking that lost its table on 1A blinked out at the commit
    // and wiped back in where it already stood (measured on DEV).
    expect(TL).toMatch(/const unplacedLabelBox = \{ \.\.\.unplacedBox, overflow: unplacedEasing \? "hidden" : "visible" \};/);
    // Lifted only while it GROWS: shrinking, the booking that left it is on a
    // table row, and the emptying row's lines would cross it.
    expect(TL).toMatch(/const unplacedGridBox = \{ \.\.\.unplacedBox, zIndex: unplacedEasing && unplacedRow\.grow \? 1 : undefined \};/);
  });

  it("the edge (line and grid lines) follows the eased box less the gap, and clips", () => {
    expect(TL).toMatch(/const unplacedEdge = \{\s*position: "absolute", top: 0, left: 0, right: 0,\s*height: "calc\(100% - " \+ UNPLACED_GAP \+ "px\)",\s*overflow: "hidden"\s*\};/);
    expect(TL).toMatch(/<div style=\{unplacedEdge\}>\{unplacedLine\}<GridLines \/><\/div>/);
    expect(TL).toMatch(/<div style=\{unplacedEdge\}>\{unplacedLine\}<\/div>/);
    // One set of grid lines for the row, so they never overflow onto the
    // table rows' own (semi-transparent) lines while it eases.
    const lane = TL.slice(TL.indexOf('<div key={"ul" + li}'));
    expect(lane.slice(0, lane.indexOf("</div>")), "a lane draws no grid lines of its own").not.toMatch(/<GridLines \/>/);
    // The word keeps its centre: the line's 1px used to come out of its box.
    expect(TL).toMatch(/height: \(heldLanes \* ROW_H - 1\) \+ "px",/);
  });

  it("a replacement, a catch-up or a hidden page goes straight to the new height", () => {
    expect(TL).toMatch(/const unplacedKey = date \+ \(bookingsReady \? "" : "\|loading"\);/);
    expect(TL).toMatch(/if \(unplacedRow\.key !== unplacedKey \|\| \(unplacedRow\.lanes !== unplacedCount && \(catchingUp \|\| pageHidden\(\)\)\)\) \{\s*setUnplacedRow\(\{ key: unplacedKey, lanes: unplacedCount, moving: false, grow: false, held: unplacedCount \}\);/);
  });

  it("a change while it moves carries on from where it got to, never snaps", () => {
    // Compared with where it last SETTLED, an open-then-empty inside the 385ms
    // read as "no change" and dropped the transition mid-way.
    expect(TL).toMatch(/\} else if \(unplacedRow\.lanes !== unplacedCount\) \{\s*setUnplacedRow\(\{ key: unplacedKey, lanes: unplacedCount, moving: true, grow: unplacedCount > unplacedRow\.lanes, held: Math\.max\(unplacedRow\.held, unplacedCount\) \}\);/);
  });

  it("it settles a frame-timed hold after the LAST change", () => {
    expect(TL).toMatch(/return afterFrame\(function \(\) \{\s*setUnplacedRow\(function \(r\) \{ return \{ key: r\.key, lanes: r\.lanes, moving: false, grow: false, held: r\.lanes \}; \}\);\s*\}, exitHold\("shift"\)\);\s*\}, \[unplacedRow\]\);/);
  });

  it("useFlip re-measures QUIETLY when the row settles, and animates only a table change", () => {
    expect(TL).toMatch(/const flipRef = useFlip\(\[assignSig, unplacedRow\.moving\], function \(\) \{ return flipSig\.current === assignSig; \}\);/);
    // Written AFTER the commit's layout effects, so the pass that a table
    // change triggers still sees the previous assignment and animates.
    expect(TL).toMatch(/useEffect\(function \(\) \{ flipSig\.current = assignSig; \}, \[assignSig\]\);/);
  });

  it("while the row moves, useFlip's baseline follows it every frame", () => {
    // Measured from where the rows STARTED, a second table change inside the
    // 385ms jumped every block below the row the distance it had covered
    // (43.9px in one frame on DEV).
    expect(TL).toMatch(/useEffect\(function \(\) \{\s*if \(!unplacedRow\.moving\) return undefined;\s*return everyFrame\(function \(\) \{ if \(flipRef\.rebase\) flipRef\.rebase\(\); \}\);\s*\}, \[unplacedRow\.moving, flipRef\]\);/);
    const atoms = stripComments(readFileSync(join(SRC3, "components/atoms.jsx"), "utf8")).join("\n");
    expect(atoms).toMatch(/ref\.rebase = function \(\) \{[\s\S]*?prevTops\.current = next;\s*\};/);
    // Written in the component, the loop's re-assigned frame id silenced the
    // React Compiler's reports on TimelineView (lint 22 -> 19 warnings).
    expect(TL, "no hand-written frame loop in the component").not.toMatch(/requestAnimationFrame\(function step/);
  });

  it("everyFrame runs on every frame until it is cancelled", () => {
    const queue = [];
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (cb) => { queue.push({ id: ++id, cb }); return id; });
    vi.stubGlobal("cancelAnimationFrame", (n) => { const i = queue.findIndex((q) => q.id === n); if (i >= 0) queue.splice(i, 1); });
    try {
      const frame = () => queue.splice(0).forEach((q) => q.cb());
      let runs = 0;
      const stop = everyFrame(() => { runs++; });
      frame(); frame(); frame();
      expect(runs).toBe(3);
      stop();
      frame();
      expect(runs, "nothing runs after the cancel").toBe(3);
      expect(queue.length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a shrinking row keeps drawing the lanes it is leaving, empty", () => {
    expect(TL).toMatch(/const heldLanes = Math\.max\(unplacedCount, unplacedRow\.held\);/);
    expect(TL).toMatch(/Array\.from\(\{ length: heldLanes \}, \(_, li\) => unplacedLanes\[li\] \|\| \[\]\)/);
  });
});
