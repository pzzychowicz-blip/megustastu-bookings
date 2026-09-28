// tests/plan-gestures.test.js — v18.3.0 phase 13 (A1 + N10 + A2) and phase 14 (A8)
//
// Phase 14 adds the view's edges: `lib/plan-zoom.js`'s limits, tested as
// numbers, and PlanView's use of them (which gesture takes which limit, and
// what glides), pinned at the source like the rest.
//
// The Plan view's pan and pinch, pinned at the source. Each of these was
// measured before it was written — in the headless rig (CDP touches, phone and
// tablet profiles, writes blocked) and on the iOS Simulator — and none of it is
// visible to build, lint or a render test: a touch defence on the wrong
// element, a pinch that forgets the midpoint, and a long-press left armed under
// a pinch all look correct in review. So the shapes that make them work are
// held here, comments stripped (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { ZOOM_MIN, ZOOM_MAX, PAN_KEEP, RUBBER, rubber, bandZoom, clampZoom, clampPan } from "../src/lib/plan-zoom.js";

const Plan = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "PlanView.jsx"), "utf8")).join("\n");

// One handler's body: from its declaration to the next top-level `function`.
function body(name) {
  const at = Plan.indexOf("function " + name + "(");
  expect(at, name + " is declared").toBeGreaterThanOrEqual(0);
  const next = Plan.indexOf("\n  function ", at + 1);
  return Plan.slice(at, next < 0 ? undefined : next);
}

describe("A1: the touch defences hang off the HTML wrapper, which iOS honours", () => {
  it("the wrapper carries the ref and the touch-action, and the svg the same value", () => {
    // iOS WebKit ignores touch-action on an <svg> (src/CLAUDE.md's "iOS + SVG
    // touch drags" row); the svg keeps a copy for Chrome, and it must be the
    // SAME value — the effective touch-action is the intersection down the
    // chain, so a `none` there would keep a phone's vertical swipe dead.
    expect(Plan).toMatch(/const touchAct = !gesturesEnabled \? "auto" : narrow \? "pan-y" : "none";/);
    expect(Plan).toMatch(/<div ref=\{wrapRef\} style=\{\{[^}]*touchAction: touchAct \}\}>/);
    expect(Plan).toMatch(/<svg ref=\{svgRef\}[^>]*touchAction: touchAct \}\}/);
    expect(Plan).not.toMatch(/touchAction: gesturesEnabled \? "none" : "auto"/);
  });

  it("a native, non-passive touchmove listener on the wrapper, removed on cleanup", () => {
    expect(Plan).toMatch(/wrap\.addEventListener\("touchmove", block, \{ passive: false \}\);/);
    expect(Plan).toMatch(/return \(\) => wrap\.removeEventListener\("touchmove", block\);/);
    expect(Plan).toMatch(/\}, \[gesturesEnabled, narrow\]\);/);
  });

  it("N10: on a phone, ONE finger is left to the page; two are always the pinch", () => {
    // /code-review: App's isMobile, a prop, so a resize reaches this memoised view.
    expect(Plan).toMatch(/const narrow = isMobile;/);
    expect(Plan).not.toMatch(/innerWidth/);
    expect(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "App.jsx"), "utf8")).toMatch(/gesturesEnabled=\{planGestures\}\s*isMobile=\{isMobile\}/);
    expect(Plan).toMatch(/if \(narrow && ev\.touches\.length < 2\) return;\s*ev\.preventDefault\(\);/);
  });
});

describe("A2: the pinch follows the fingers", () => {
  it("catches the room point under the midpoint when the second finger lands", () => {
    const down = body("bgPointerDown");
    expect(down).toMatch(/const m0 = toSvg\(\{ clientX: \(pts\[0\]\.x \+ pts\[1\]\.x\) \/ 2, clientY: \(pts\[0\]\.y \+ pts\[1\]\.y\) \/ 2 \}\);/);
    // /review-animations: anchored to `v0`, the view ON SCREEN (endSettle), not
    // `view`, which mid-glide holds the glide's target.
    expect(down).toMatch(/const v0 = endSettle\(\);/);
    expect(down).toMatch(/wx: \(m0\.x - v0\.tx\) \/ v0\.k, wy: \(m0\.y - v0\.ty\) \/ v0\.k/);
  });

  it("keeps it under the midpoint as the fingers move — zoom about it, pan with it", () => {
    const move = body("bgPointerMove");
    // (phase 14 wraps it in the pan bound — pinned exactly in the A8 block below)
    expect(move).toMatch(/\{ k: k, tx: m\.x - k \* pinchRef\.current\.wx, ty: m\.y - k \* pinchRef\.current\.wy \}/);
    expect(move).not.toMatch(/setView\(\(v\) => \(\{ \.\.\.v, k: k \}\)\)/);
    // the v17.0.0 round-6 damping stays: a 2× spread is a 1.5× zoom
    expect(move).toMatch(/\(d \/ pinchRef\.current\.d0 - 1\) \* 0\.5/);
  });

  it("the maths holds a room point under a moving midpoint (onWheel's, with the midpoint for the cursor)", () => {
    // screen = k * room + t, solved for t at the new k and midpoint
    const view = { k: 1.4, tx: -30, ty: 12 };
    const m0 = { x: 210, y: 140 };
    const wx = (m0.x - view.tx) / view.k, wy = (m0.y - view.ty) / view.k;
    for (const [k, m] of [[2.1, { x: 210, y: 140 }], [3, { x: 270, y: 140 }], [0.8, { x: 150, y: 90 }]]) {
      const tx = m.x - k * wx, ty = m.y - k * wy;
      expect(k * wx + tx).toBeCloseTo(m.x, 9);
      expect(k * wy + ty).toBeCloseTo(m.y, 9);
    }
  });
});

describe("Patryk's two phase-13 calls", () => {
  it("a second finger landing cancels the touch long-press, so a pinch never opens quick status", () => {
    const down = body("bgPointerDown");
    const branch = down.slice(down.indexOf("if (pts.length === 2) {"), down.indexOf("return;", down.indexOf("if (pts.length === 2) {")));
    expect(branch).toMatch(/clearPress\(\);/);
  });

  it("on a phone one finger pans sideways only, a mouse never; a cancelled pan is undone", () => {
    const move = body("bgPointerMove");
    expect(move).toMatch(/const sideways = narrow && e\.pointerType !== "mouse";/);
    expect(move).toMatch(/ty: sideways \? pan\.ty : pan\.ty \+ dy/);
    // the tap threshold still reads the real dy, so a wiggling tap is not a table tap
    expect(move).toMatch(/if \(Math\.abs\(dx\) > 4 \|\| Math\.abs\(dy\) > 4\) movedRef\.current = true;/);
    const up = body("bgPointerUp");
    expect(up).toMatch(/if \(e\.type === "pointercancel" && pan && movedRef\.current\) setView\(\(v\) => \(\{ \.\.\.v, tx: pan\.tx, ty: pan\.ty \}\)\);/);
    // and the svg sends a cancel to that handler at all
    expect(Plan).toMatch(/onPointerCancel=\{bgPointerUp\}/);
  });
});

describe("A8: lib/plan-zoom.js — the zoom band and the pan bound, as numbers", () => {
  it("the band is zero at the edge, grows with the overshoot, and never reaches 25%", () => {
    expect(rubber(0)).toBe(0);
    const xs = [0.01, 0.1, 0.5, 1, 3, 10, 1e6];
    const ys = xs.map(rubber);
    ys.forEach((y, i) => { if (i) expect(y).toBeGreaterThan(ys[i - 1]); });
    expect(ys[ys.length - 1]).toBeLessThan(RUBBER);
    expect(RUBBER).toBeCloseTo(Math.log(1.25), 12);
  });

  it("a pinch's zoom is itself inside the range and banded past either end, continuously", () => {
    for (const k of [ZOOM_MIN, 0.8, 1, 2.5, ZOOM_MAX]) expect(bandZoom(k)).toBe(k);
    // measured in the rig: a pinch to 8× raw held at 5.636
    expect(bandZoom(8)).toBeGreaterThan(ZOOM_MAX);
    expect(bandZoom(8)).toBeLessThan(ZOOM_MAX * 1.25);
    expect(bandZoom(8)).toBeCloseTo(5.636, 3);
    expect(bandZoom(1e9)).toBeLessThan(ZOOM_MAX * 1.25);
    expect(bandZoom(0.1)).toBeLessThan(ZOOM_MIN);
    expect(bandZoom(0.1)).toBeGreaterThan(ZOOM_MIN / 1.25);
    expect(bandZoom(1e-9)).toBeGreaterThan(ZOOM_MIN / 1.25);
    // no step at the edges
    expect(bandZoom(ZOOM_MAX * 1.000001)).toBeCloseTo(ZOOM_MAX, 5);
    expect(bandZoom(ZOOM_MIN / 1.000001)).toBeCloseTo(ZOOM_MIN, 5);
    // and it never runs backwards
    let prev = 0;
    for (let raw = 0.05; raw < 40; raw *= 1.07) { const k = bandZoom(raw); expect(k).toBeGreaterThan(prev); prev = k; }
  });

  it("the wheel's hard range", () => {
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(1.7)).toBe(1.7);
  });

  it("the pan keeps PAN_KEEP of the view covered by the room, and leaves an in-bounds view alone", () => {
    const room = { w: 900, h: 700 };
    // measured in the rig: a far-left drag at k=1 stopped at tx −720 = 0.2·900 − 900
    expect(clampPan({ k: 1, tx: -5000, ty: 0 }, room)).toEqual({ k: 1, tx: -720, ty: 0 });
    expect(clampPan({ k: 1, tx: 5000, ty: 5000 }, room)).toEqual({ k: 1, tx: 720, ty: 560 });
    expect(clampPan({ k: 2, tx: -5000, ty: -5000 }, room)).toEqual({ k: 2, tx: 180 - 1800, ty: 140 - 1400 });
    expect(clampPan({ k: 1.3, tx: -100, ty: 40 }, room)).toEqual({ k: 1.3, tx: -100, ty: 40 });
    // the covered share, at both bounds and every zoom a pinch can reach
    for (const k of [ZOOM_MIN / 1.25, ZOOM_MIN, 1, 3, ZOOM_MAX * 1.25]) {
      for (const t of [-1e5, 1e5]) {
        const v = clampPan({ k, tx: t, ty: t }, room);
        const covered = Math.min(room.w, v.tx + k * room.w) - Math.max(0, v.tx);
        expect(covered / room.w).toBeGreaterThanOrEqual(PAN_KEEP - 1e-9);
      }
    }
  });
});

describe("A8: PlanView takes the limits — which gesture gets which, and what glides", () => {
  it("the zoom <g> is drawn by a CSS transform, which can glide, never the attribute", () => {
    expect(Plan).toMatch(/<g ref=\{gRef\} style=\{\{ transform: "translate\(" \+ view\.tx \+ "px," \+ view\.ty \+ "px\) scale\(" \+ view\.k \+ "\)", transformOrigin: "0 0", transition: settling \? "transform " \+ M\.shift : "none" \}\}>/);
    expect(Plan).not.toMatch(/<g transform=\{"translate\(" \+ view\.tx/);
  });

  it("a glide holds for exitHold(\"shift\"), then the transition comes off; a gesture ends it early", () => {
    expect(body("settle")).toMatch(/setTimeout\(\(\) => \{ settleRef\.current = null; setSettling\(false\); \}, exitHold\("shift"\)\);/);
    expect(body("bgPointerDown")).toMatch(/endSettle\(\);/);
    expect(body("onWheel")).toMatch(/endSettle\(\);/);
    expect(Plan).toMatch(/useEffect\(\(\) => \(\) => clearTimeout\(settleRef\.current\), \[\]\);/);
  });

  // /review-animations: ending a glide keeps the plan where the glide HAS GOT TO.
  // Dropping the transition alone put it on the target in one frame (measured:
  // a wheel step 120ms into a double-tap reset jumped the zoom 1.70× → 1.15×).
  it("a gesture that ends a glide starts from the drawn view, not the target", () => {
    const end = body("endSettle");
    // /code-review: a spring-back caught past the range lands on its target instead.
    expect(end).toMatch(/const drawn = drawnView\(\);\s*const at = clampZoom\(drawn\.k\) === drawn\.k \? drawn : view;\s*setView\(at\);\s*setSettling\(false\);\s*return at;/);
    expect(body("drawnView")).toMatch(/const m = new DOMMatrix\(getComputedStyle\(g\)\.transform\);\s*return \{ k: m\.a, tx: m\.e, ty: m\.f \};/);
    expect(body("bgPointerDown")).toMatch(/panRef\.current = \{ x: e\.clientX, y: e\.clientY, tx: v0\.tx, ty: v0\.ty \};/);
  });

  it("the double-tap reset and the gestures-off reset glide", () => {
    expect(Plan).toMatch(/function resetView\(\) \{ settle\(\); setView\(\{ k: 1, tx: 0, ty: 0 \}\); \}/);
    expect(Plan).toMatch(/if \(!gesturesEnabled\) \{\s*settle\(\);\s*setView\(\{ k: 1, tx: 0, ty: 0 \}\);/);
  });

  it("the wheel keeps the hard stop; the pinch takes the band; every view change is pan-bounded", () => {
    const wheel = body("onWheel");
    expect(wheel).toMatch(/const k = clampZoom\(/);
    expect(wheel).not.toMatch(/bandZoom/);
    expect(wheel).toMatch(/return clampPan\(\{ k: k, tx: p\.x - k \* wx, ty: p\.y - k \* wy \}, fp\.room\);/);
    const move = body("bgPointerMove");
    expect(move).toMatch(/const k = bandZoom\(pinchRef\.current\.k0 \* ratio\);/);
    expect(move).toMatch(/pinchRef\.current\.k = k;/);
    expect(move).toMatch(/pinchRef\.current\.m = m;/);
    expect(move).toMatch(/setView\(clampPan\(\{ k: k, tx: m\.x - k \* pinchRef\.current\.wx, ty: m\.y - k \* pinchRef\.current\.wy \}, fp\.room\)\);/);
    expect(move).toMatch(/setView\(\(v\) => clampPan\(\{ \.\.\.v, tx: pan\.tx \+ dx, ty: sideways \? pan\.ty : pan\.ty \+ dy \}, fp\.room\)\)/);
    // the old hard-coded range is gone from the file
    expect(Plan).not.toMatch(/Math\.max\(0\.5, Math\.min\(5,/);
  });

  it("a pinch released past a limit springs back to it, about the last midpoint, gliding", () => {
    const up = body("bgPointerUp");
    expect(up).toMatch(/if \(pin && pin\.m && clampZoom\(pin\.k\) !== pin\.k\) \{\s*const k = clampZoom\(pin\.k\);\s*settle\(\);\s*setView\(clampPan\(\{ k: k, tx: pin\.m\.x - k \* pin\.wx, ty: pin\.m\.y - k \* pin\.wy \}, fp\.room\)\);/);
  });
});
