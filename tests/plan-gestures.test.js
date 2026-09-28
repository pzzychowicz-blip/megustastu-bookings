// tests/plan-gestures.test.js — v18.3.0 phase 13 (A1 + N10 + A2)
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
    expect(Plan).toMatch(/const narrow = typeof window !== "undefined" && window\.innerWidth < 600;/);
    expect(Plan).toMatch(/if \(narrow && ev\.touches\.length < 2\) return;\s*ev\.preventDefault\(\);/);
  });
});

describe("A2: the pinch follows the fingers", () => {
  it("catches the room point under the midpoint when the second finger lands", () => {
    const down = body("bgPointerDown");
    expect(down).toMatch(/const m0 = toSvg\(\{ clientX: \(pts\[0\]\.x \+ pts\[1\]\.x\) \/ 2, clientY: \(pts\[0\]\.y \+ pts\[1\]\.y\) \/ 2 \}\);/);
    expect(down).toMatch(/wx: \(m0\.x - view\.tx\) \/ view\.k, wy: \(m0\.y - view\.ty\) \/ view\.k/);
  });

  it("keeps it under the midpoint as the fingers move — zoom about it, pan with it", () => {
    const move = body("bgPointerMove");
    expect(move).toMatch(/setView\(\{ k: k, tx: m\.x - k \* pinchRef\.current\.wx, ty: m\.y - k \* pinchRef\.current\.wy \}\);/);
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
