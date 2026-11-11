// tests/timeline-drag.test.js — v18.3.1
//
// The timeline block's touch drag, pinned at the source. What these hold was
// measured on the restaurant's Android tablet over USB (CDP), and none of it is
// visible to build, lint or a render test: a capture handler that listens to
// its CHILDREN's events reads exactly like one that listens to its own.
// Comments stripped (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { EDGE_BAND, EDGE_MAX_SPEED, edgeVelocity, edgeStep, rowProbeY, scrollBoundsX } from "../src/lib/edge-scroll.js";

const Timeline = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "TimelineView.jsx"), "utf8")).join("\n");

describe("a child's lost capture does not end the drag", () => {
  it("onLostPointerCapture tears down only when the BLOCK lost it", () => {
    // `lostpointercapture` bubbles. A touch is implicitly captured to the span
    // the finger landed on; when the 800ms arm moves the capture to the block,
    // the span's loss bubbled here and ended the drag it had just armed (most
    // real drags on the tablet, Chrome 154).
    expect(Timeline).toMatch(/onLostPointerCapture: \(e\) => \{ if \(e\.target === e\.currentTarget\) endDrag\(e, false\); \},/);
    expect(Timeline).not.toMatch(/onLostPointerCapture: \(e\) => endDrag\(e, false\)/);
  });

  it("the arm still captures on the block, so a moved capture is what the guard sees", () => {
    expect(Timeline).toMatch(/try \{ el\.setPointerCapture\(pid\); \} catch/);
  });
});

// ── A5: the edge scroll (v18.3.1) ────────────────────────────────────────────

describe("edgeVelocity: a band at each edge, ramping to full speed", () => {
  const top = 0, bottom = 600;
  it("is still in the middle and at the band's inner line", () => {
    expect(edgeVelocity(300, top, bottom)).toBe(0);
    expect(edgeVelocity(top + EDGE_BAND, top, bottom)).toBe(0);
    expect(edgeVelocity(bottom - EDGE_BAND, top, bottom)).toBe(0);
  });
  it("scrolls up near the top and down near the bottom, linearly", () => {
    expect(edgeVelocity(top + EDGE_BAND / 2, top, bottom)).toBeCloseTo(-EDGE_MAX_SPEED / 2);
    expect(edgeVelocity(bottom - EDGE_BAND / 2, top, bottom)).toBeCloseTo(EDGE_MAX_SPEED / 2);
    expect(edgeVelocity(top, top, bottom)).toBeCloseTo(-EDGE_MAX_SPEED);
  });
  it("runs at full speed past the edge (a finger over the phone's bottom bar)", () => {
    expect(edgeVelocity(bottom + 40, top, bottom)).toBe(EDGE_MAX_SPEED);
    expect(edgeVelocity(top - 40, top, bottom)).toBe(-EDGE_MAX_SPEED);
  });
  it("does nothing in a scrollport too short to hold both bands", () => {
    expect(edgeVelocity(10, 0, 2 * EDGE_BAND)).toBe(0);
  });
  it("honours a scrollport that starts below the viewport's top (the fixed shell)", () => {
    expect(edgeVelocity(130, 120, 600)).toBeLessThan(0);
    expect(edgeVelocity(60, 120, 600)).toBe(-EDGE_MAX_SPEED);
  });
});

describe("edgeStep: whole pixels, the fraction carried", () => {
  it("a slow crawl still moves, a pixel every few frames", () => {
    let carry = 0, moved = 0;
    for (let i = 0; i < 10; i++) { const r = edgeStep(carry, 0.03, 16); carry = r.carry; moved += r.step; }
    expect(moved).toBe(4);                 // 0.48px a frame for 10 frames
  });
  it("carries upwards too, truncating towards zero", () => {
    const r = edgeStep(0, -0.1, 16);
    expect(r.step).toBe(-1);
    expect(r.carry).toBeCloseTo(-0.6);
  });
});

describe("rowProbeY: a row under the stuck ruler cannot be dropped on (v18.14.0)", () => {
  it("counts a finger on the stuck ruler as just under it", () => {
    expect(rowProbeY(120, 128, -200)).toBe(128);
  });
  it("leaves a finger below the ruler alone", () => {
    expect(rowProbeY(300, 128, -200)).toBe(300);
  });
  it("at rest the grid starts at the ruler's bottom, and above the grid is still nowhere", () => {
    expect(rowProbeY(120, 190, 190)).toBe(120);
  });
  it("with no ruler, nothing changes", () => {
    expect(rowProbeY(120, null, 0)).toBe(120);
  });
});

describe("the block's wiring", () => {
  it("the offset adds the scroll since the arm", () => {
    expect(Timeline).toMatch(/return d\.lastY - d\.y0 \+ \(d\.sc \? d\.sc\.scrollTop - d\.s0 : 0\);/);
    expect(Timeline).toMatch(/setDragDy\(dragDyOf\(dd\)\);/);
    expect(Timeline).not.toMatch(/setDragDy\(dd\.lastY - dd\.y0\)/);
  });
  it("the arm records the scrollport, and mutates the drag in place", () => {
    expect(Timeline).toMatch(/const sc = scrollParentY\(el\);/);
    expect(Timeline).toMatch(/Object\.assign\(d, \{ active: true, sc, s0: sc \? sc\.scrollTop : 0, carry: 0 \}\);/);
    expect(Timeline).not.toMatch(/dragRef\.current = \{ \.\.\.\(dragRef\.current \|\| \{\}\), active: true/);
  });
  it("a move and the touch arm both start the loop; every end stops it", () => {
    expect(Timeline.match(/kickEdge\(\);/g).length).toBe(2);
    expect(Timeline).toMatch(/if \(edgeRafRef\.current\) \{ cancelAnimationFrame\(edgeRafRef\.current\); edgeRafRef\.current = 0; \}/);
    expect(Timeline).toMatch(/useEffect\(\(\) => \(\) => \{\s*cancelAnimationFrame\(edgeRafRef\.current\);/);
  });
});

// ── v18.16.0: an empty cell starts a booking ─────────────────────────────────
// What a cell offers is tests/cell-offer.test.js. This is the view's half: one
// marker, moved from a handle, and a finger's two taps.
describe("the cell marker", () => {
  const marker = Timeline.slice(Timeline.indexOf("function CellMarker("), Timeline.indexOf("function syncRuler("));
  const view = Timeline.slice(Timeline.indexOf("export const TimelineView"));
  it("is one marker with its own state, told where to be through a handle", () => {
    expect(view.match(/<CellMarker /g).length).toBe(1);
    expect(marker).toMatch(/useImperativeHandle\(ref, \(\) => \(\{/);
    // The view keeps no state for it: a pointer crossing cells must not re-render the grid.
    expect(view).not.toMatch(/useState\([^)]*\bcell/i);
    expect(view).toMatch(/const cellRef = useRef\(null\);/);
  });
  it("is a real button, named for what the tap will do", () => {
    expect(marker).toMatch(/<button[^>]*\n\s*ref=\{btnRef\}\n\s*type="button"/);
    expect(marker).toMatch(/aria-label=\{"New booking, table " \+ cell\.tableId \+ ", " \+ cell\.time\}/);
    expect(marker).toMatch(/onClick=\{\(\) => \{ setShown\(false\); onOpen\(cell\.tableId, cell\.time\); \}\}/);
  });
  it("takes a press only once a finger has selected it; under a mouse it is out of the pointer's way", () => {
    expect(marker).toMatch(/pointerEvents: shown && cell\.tap \? "auto" : "none"/);
  });
  it("a selected cell is cleared by a press anywhere else, heard in the capture phase", () => {
    expect(marker).toMatch(/if \(!tapLive\) return undefined;\s+function away\(e\) \{[^\n]*\}\s+window\.addEventListener\("pointerdown", away, true\);\s+return \(\) => \{ window\.removeEventListener\("pointerdown", away, true\); \};\s+\}, \[tapLive\]\);/);
  });
  // v18.16.0 (/code-review): the scroll listener ran in tap mode only, so a wheel
  // scroll left a hovered marker lit on a cell the mouse was no longer over
  // (measured on DEV: 120px of scroll, the chip still said 13:15 over 14:15).
  it("any shown marker is cleared on scroll, a hovered one included", () => {
    expect(marker).toMatch(/if \(!shown\) return undefined;\s+function gone\(\) \{ setShown\(false\); \}\s+window\.addEventListener\("scroll", gone, true\);\s+return \(\) => \{ window\.removeEventListener\("scroll", gone, true\); \};\s+\}, \[shown\]\);/);
  });
  it("leaves as it arrives", () => {
    expect(marker).toMatch(/inClass="mgt-appear"\s+outClass="mgt-ghost-out"/);
  });
  it("a mouse opens on the click and a finger selects first", () => {
    expect(view).toMatch(/if \(kind === "mouse"\) \{ cellRef\.current\.hide\(\); onNewAt\(c\.tableId, c\.time\); \}\s*else cellRef\.current\.show\(\{ \.\.\.c, tap: true \}\);/);
  });
  it("the click that ends a press begun anywhere else is not a cell's", () => {
    expect(view).toMatch(/const kind = cellDown\.current;\s*cellDown\.current = null;\s*if \(!kind \|\| !cellRef\.current\) return;/);
  });
  it("offers only on the row itself or its grid lines, never over what a row holds", () => {
    expect(view).toMatch(/if \(t !== row && !\(lines && lines\.parentElement === row\)\) return null;/);
    expect(Timeline).toMatch(/<div data-grid-lines="" style=/);
  });
  it("a mouse with a button down is a drag, and a drag over the rows takes the marker away", () => {
    expect(view).toMatch(/const c = e\.buttons === 0 \? cellUnder\(e\) : null;/);
    expect(view).toMatch(/if \(table != null && cellRef\.current\) cellRef\.current\.hide\(\);/);
  });
  it("is let go when the day, the zoom, the text size or the bookings under it change", () => {
    expect(view).toMatch(/if \(cellRef\.current\) cellRef\.current\.hide\(\);\s*\}, \[date, gridW, sz, bookings, blocks, cellOn\]\);/);
  });
  it("is off with the device's switch, handlers and marker both", () => {
    expect(view).toMatch(/const cellOn = cellBook && !!onNewAt;/);
    expect(view.match(/\{cellOn \? onCell(Move|Leave|Down|Click) : undefined\}/g).length).toBe(4);
    expect(view).toMatch(/\{cellOn \? <CellMarker /);
  });
  it("the Unplaced row offers nothing: only table rows carry data-row", () => {
    expect(view.match(/data-row=/g).length).toBe(1);
    expect(view).toMatch(/data-row=\{id\}/);
  });
});

// ── v18.16.0: the same block dragged sideways ────────────────────────────────
// What a re-time does is tests/drop-plan.test.js; the axis and the quarter are
// tests/cell-offer.test.js. This is the block's wiring: one axis per drag, the
// teardown before the dispatch, and the sideways edge scroll.
describe("the time drag", () => {
  const block = Timeline.slice(Timeline.indexOf("function TimelineBlock("), Timeline.indexOf("function DropHint("));
  it("only a block on a table row has it, and only where App handed a handler", () => {
    expect(block).toContain("const canRetime = !!onRetime && homeTable != null;");
    expect((Timeline.match(/onRetime=\{onRetime\} setDragTime=\{hoverTime\} syncGridScroll=\{syncGridScroll\}/g) || []).length).toBe(1);
    // the Unplaced row's blocks carry no table, and are not handed it either
    const unplaced = Timeline.slice(Timeline.indexOf("homeTable={null}"));
    expect(unplaced.slice(0, unplaced.indexOf("/>"))).not.toMatch(/onRetime/);
  });
  it("the axis is chosen once, by the pure rule, and never re-chosen", () => {
    expect(block).toContain("d.axis = dragAxis(d.lastX - d.x0, d.lastY - d.y0, canRetime);");
    expect(block).toContain("if (!d.axis) chooseAxis(d);");
    expect((block.match(/chooseAxis\(/g) || []).length, "the declaration and one call").toBe(2);
    expect(block, "a mouse drag begins on the same rule").toContain('if (e.pointerType === "mouse" && dragAxis(e.clientX - d.x0, e.clientY - d.y0, canRetime)) beginDrag(e.currentTarget, d.pid);');
    expect(block, "a block with one direction follows from the arm").toContain('if (!canRetime) d.axis = "y";');
  });
  it("a frame follows one axis only", () => {
    expect(block).toMatch(/if \(dd\.axis === "x"\) \{ stepX\(dd\); return; \}\s+if \(dd\.axis !== "y"\) return;\s+setDragDy\(dragDyOf\(dd\)\);/);
  });
  it("the start is the pure snap, at the row's live width, with the scroll since the choice", () => {
    expect(block).toContain("const px = d.lastX - d.x0 + (d.scx ? d.scx.scrollLeft - d.sx0 : 0);");
    expect(block).toContain("return draggedStart(toMins(b.time), px, d.ppm, OPEN * 60, GRID_CLOSE * 60);");
    expect(block).toContain("d.ppm = d.el.parentElement.getBoundingClientRect().width / totalMins;");
  });
  it("re-renders once per quarter, not per frame, and asks the row once per time", () => {
    expect(block).toMatch(/if \(d\.step !== mins\) \{\s+pulse\(\);\s+d\.step = mins;\s+setDragX\(\{ mins: mins, px: \(mins - start\) \* d\.ppm, live: true \}\);\s+\}/);
    expect(block).toContain("if (setDragTime) setDragTime(homeTable, b.id, mins === start ? null : toTime(mins), d.lastX);");
    expect(Timeline).toContain("setDragTime(time);");
    expect(Timeline, "a table drag clears it").toMatch(/setDragOver\(table == null \|\| table === home \? null : id\);\s+setDragTime\(null\);/);
  });
  it("tears down first and dispatches last, and only for a time that changed", () => {
    const end = block.slice(block.indexOf("function endDrag("), block.indexOf("const handlers = leaving"));
    const clear = end.indexOf("setDragX((x) => (x && x.live ? { ...x, live: false } : x));");
    const send = end.indexOf("onRetime(b.id, toTime(newStart));");
    expect(clear).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(clear);
    expect(end.indexOf("if (setDragHover) setDragHover(null);")).toBeLessThan(send);
    expect(end).toMatch(/if \(newStart != null && newStart !== toMins\(b\.time\)\) \{\s+pulse\(\);\s+try \{ onRetime\(b\.id, toTime\(newStart\)\); \}\s+catch/);
    expect(end, "a time drag never drops on a row").toContain("const target = d && d.active && commit && !timeDrag ? tableAtY(e.clientY) : null;");
    expect(end, "a cancelled drag sends nothing").toContain("const newStart = timeDrag && d.active && commit ? dragStartOf(d) : null;");
  });
  it("the lift is one state for both drags, and a time drag glides between quarters", () => {
    expect(block).toContain("const tx = dragX && dragX.live ? dragX : null;");
    expect(block).toContain("const lifted = dragDy != null || !!tx;");
    expect(block).toContain('transform: tx ? "translateX(" + tx.px + "px)" : "translateY(" + dragDy + "px)"');
    expect(block).toContain('transition: tx ? "transform " + M.tap : lifted ? "none" : settling ? TL_SETTLE : TL_MOVE');
  });
  it("carries the cell marker's chip, in and out, placed by the minute", () => {
    expect(block).toMatch(/<Presence\s+show=\{!!tx\}\s+inClass="mgt-appear"\s+outClass="mgt-ghost-out"/);
    expect(block).toContain("left: dragX ? pct(dragX.mins) : left, zIndex: 30,");
    expect(block).toContain("<CellChip tableId={homeTable} time={toTime(dragX.mins)} sz={sz} />");
  });
  it("the page is held by a listener that is there before the touch starts", () => {
    expect(block).toMatch(/function hold\(ev\) \{ if \(dragRef\.current && dragRef\.current\.active && ev\.cancelable\) ev\.preventDefault\(\); \}\s+el\.addEventListener\("touchmove", hold, \{ passive: false \}\);/);
    expect(block).not.toMatch(/preventScrollRef/);
  });
  it("the edge scroll serves both axes from one loop, and tells the ruler in the frame", () => {
    expect(block).toContain("const box = !sc ? null : horiz ? scrollBoundsX(sc) : scrollBounds(sc);");
    expect(block).toContain("const v = !box ? 0 : horiz ? edgeVelocity(d.lastX, box.left, box.right) : edgeVelocity(d.lastY, box.top, box.bottom);");
    expect(block).toMatch(/if \(horiz\) \{\s+if \(syncGridScroll\) syncGridScroll\(\);\s+stepX\(d\);\s+\}/);
    expect(block, "a still finger in the band has chosen the table drag").toContain('if (!d.axis) d.axis = "y";');
    // A block hanging past the grid's end widens the scroller, so the loop stops
    // at the end the grid had at rest, not at whatever the scroller says now.
    expect(block).toContain("d.sxMax = d.scx ? d.scx.scrollWidth - d.scx.clientWidth : 0;");
    expect(block).toContain("if (horiz) sc.scrollLeft = Math.min(before + next.step, d.sxMax); else sc.scrollTop = before + next.step;");
  });
  it("scrollBoundsX: the scroller's sides, clamped to the window", () => {
    const win = globalThis.window;
    globalThis.window = { innerWidth: 998 };
    try {
      const sc = (left, right) => ({ getBoundingClientRect: () => ({ left, right }) });
      expect(scrollBoundsX(sc(120, 900))).toEqual({ left: 120, right: 900 });
      expect(scrollBoundsX(sc(-40, 1400))).toEqual({ left: 0, right: 998 });
      // the same band maths as the vertical one
      const b = scrollBoundsX(sc(120, 900));
      expect(edgeVelocity(500, b.left, b.right)).toBe(0);
      expect(edgeVelocity(b.left + EDGE_BAND / 2, b.left, b.right)).toBeCloseTo(-EDGE_MAX_SPEED / 2);
      expect(edgeVelocity(b.right, b.left, b.right)).toBeCloseTo(EDGE_MAX_SPEED);
    } finally { if (win === undefined) delete globalThis.window; else globalThis.window = win; }
  });
});
