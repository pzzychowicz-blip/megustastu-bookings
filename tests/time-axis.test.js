// tests/time-axis.test.js — v18.3.0 phase 15 (A6)
//
// The Plan tape's snap to the nearest quarter, pinned at the source. It was
// chosen by measurement on the iOS Simulator (a probe page flung three ways,
// REFACTOR_LOG v18.3.0 phase 15), and nothing about it is visible to build,
// lint or a render test: a snap that fires under a held finger and a snap that
// waits for the lift read identically in review. Comments stripped
// (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const Tape = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "TimeAxis.jsx"), "utf8")).join("\n");

function body(name) {
  const at = Tape.indexOf("function " + name + "(");
  expect(at, name + " is declared").toBeGreaterThanOrEqual(0);
  const next = Tape.indexOf("\n  function ", at + 1);
  return Tape.slice(at, next < 0 ? undefined : next);
}

describe("A6: the tape snaps once the browser says the scroll is over", () => {
  it("snaps on scrollend where the browser has it", () => {
    // `scrollend` waits for the fling to finish AND the finger to lift; the
    // idle timer fired under a held finger and slid the tape 4px beneath it.
    expect(Tape).toMatch(/const HAS_SCROLLEND = typeof window !== "undefined" && "onscrollend" in window;/);
    expect(Tape).toMatch(/onScrollEnd=\{HAS_SCROLLEND \? onScrollEnd : undefined\}/);
    expect(body("onScrollEnd")).toMatch(/if \(!wheelRef\.current\) snapToQuarter\(\);/);
  });

  it("keeps the idle timer for a wheel, and where there is no scrollend", () => {
    // React has no scrollend polyfill (react-dom 19.2.5; 19.3.0 re-read in
    // v18.3.2), so a browser without it would never snap if the timer went
    // entirely. And a wheel
    // fires scrollend after every notch: snapping there swallowed the next
    // notch (three travelled 96px, not 120).
    const scroll = body("onScroll");
    const gate = "if (HAS_SCROLLEND && !wheelRef.current) return;";
    expect(scroll).toContain(gate);
    expect(scroll.indexOf(gate)).toBeLessThan(scroll.indexOf("setTimeout(snapToQuarter, SNAP_MS)"));
    // …and the live selection still comes first, so the detent fires per quarter
    expect(scroll.indexOf("onSelect(q)")).toBeLessThan(scroll.indexOf(gate));
  });

  it("knows which input moved it last", () => {
    expect(Tape).toMatch(/onPointerDown=\{\(\) => \{ wheelRef\.current = false; releaseSnapGuard\(\); \}\}/);
    expect(Tape).toMatch(/onWheel=\{\(\) => \{ wheelRef\.current = true; releaseSnapGuard\(\); \}\}/);
  });

  it("leaves a glide it started alone, and does not glide onto a mark it is already on", () => {
    // The glide's own scrollend must not snap again, and a snap that moves
    // nothing must not arm the guard for 320ms.
    const snap = body("snapToQuarter");
    expect(snap).toMatch(/if \(!el \|\| snappingRef\.current\) return;/);
    expect(snap).toMatch(/if \(Math\.abs\(xOf\(q\) - el\.scrollLeft\) < 0\.5\) return;/);
    expect(snap).toMatch(/centre\(q, true\);/);
  });

  it("does not use CSS scroll-snap", () => {
    // Measured and rejected: WebKit decelerates a snapping scroller faster,
    // so a fling went about a fifth as far (88–112px against 423–548px).
    expect(Tape).not.toMatch(/scrollSnapType|scrollSnapAlign/);
  });
});

// v18.3.2 — the re-centre follows the tape's scale as well as the request.
// Keyed on the request alone, a new opening hour moved every time on the tape
// while its scroll stayed put: measured on DEV, the scrubber on 17:00 and
// Thursday's open moved from 13 to 12, and the badge said 17:00 over a tape
// showing 16:00. A later close moves nothing (1.6px a minute either way), so it
// must not re-centre a tape somebody is scrubbing.
describe("the tape re-centres when its scale moves under the selection", () => {
  it("keys the re-centre on the request, the opening minute and the scale", () => {
    expect(Tape).toMatch(/const pxPerMin = trackW \/ totalMins;/);
    expect(Tape).toMatch(/centre\(selected, autoScrollSmooth\);\s*\}, \[autoScrollKey, openM, pxPerMin\]\);/);
  });

  it("never on the selection itself, which a scrub moves", () => {
    expect(Tape).not.toMatch(/\}, \[[^\]]*\bselected\b[^\]]*\]\);/);
  });
});
