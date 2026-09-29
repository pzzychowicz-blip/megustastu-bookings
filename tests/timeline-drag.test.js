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
import { EDGE_BAND, EDGE_MAX_SPEED, edgeVelocity, edgeStep } from "../src/lib/edge-scroll.js";

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
    expect(Timeline).toMatch(/useEffect\(\(\) => \(\) => \{ cancelAnimationFrame\(edgeRafRef\.current\); \}, \[\]\);/);
  });
});
