// tests/block-layout.test.js
// v17.9.1 — the timeline block's width ladder (src/lib/block-layout.js).
//
// This exists because the live app cannot exercise the interesting cases. The
// timeline's zoom steps move a block 108px → 162px → 216px, so the rungs where
// exactly one or two flags survive fall BETWEEN two zoom levels and are
// unreachable by clicking. Both endpoints were verified in DEV and both match;
// everything in between is verified here.
//
// The rule under test is not "does it fit" — that is arithmetic. It is WHICH
// marker disappears first, which is a judgement about what a busy restaurant can
// least afford to lose, and the kind of thing a later reorder breaks silently.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { visibleRail } from "../src/lib/block-layout.js";
import { stripComments } from "../scripts/strip-comments.mjs";

// The measured widths from TimelineView.jsx. Duplicated deliberately: this file
// tests the LADDER, not the measurements, and pinning them here means a retune
// of the real constants cannot quietly change what these cases assert.
const RING = 24;
const FLAG = 15;
const FIXED = 41 + 55;   // HANDLE_PX + NAME_MIN_PX, no chip

// Rail order (left → right on the block), with the drop priority TimelineView
// assigns. Lowest `keep` survives longest. v18.2.0 phase 22 (Patryk): deposit
// and the new indoor/outdoor preference are the last flags to drop — only the
// ring and overstaying outlast them. The "fixture matches the component" test
// at the bottom reads `railFlagsOf` so this list cannot drift from it.
const RAIL = [
  { k: "dep", keep: 2 },    // deposit
  { k: "zone", keep: 3 },   // prefers indoor / outdoor (v18.2.0)
  { k: "pref", keep: 6 },   // preferred tables — first to drop
  { k: "lock", keep: 5 },   // locked
  { k: "ns", keep: 4 },     // repeat no-show
  { k: "over", keep: 1 }    // overstaying      — the most urgent
];

const ks = (r) => r.flags.map((f) => f.k);

describe("visibleRail — the ladder", () => {
  it("drops everything but the name and handle on the narrowest block", () => {
    // 108px is the real width of a 90-minute booking at 1× zoom, measured live.
    const r = visibleRail(108, FIXED, RING, FLAG, RAIL);
    expect(r.showRing).toBe(false);
    expect(ks(r)).toEqual([]);
  });

  it("gives the party-size ring back before any flag", () => {
    // room = 24 — exactly the ring, nothing left over.
    const r = visibleRail(FIXED + RING, FIXED, RING, FLAG, RAIL);
    expect(r.showRing).toBe(true);
    expect(ks(r)).toEqual([]);
  });

  it("keeps the OVERSTAY flag when only one fits — not the deposit", () => {
    // The case the UI cannot reach, and the whole point of the ordering: the
    // marker that survives longest is the one saying someone is sitting in a
    // table the next booking needs, not the one saying money was taken.
    const r = visibleRail(FIXED + RING + FLAG, FIXED, RING, FLAG, RAIL);
    expect(r.showRing).toBe(true);
    expect(ks(r)).toEqual(["over"]);
  });

  it("then deposit and the indoor/outdoor preference, before every other flag (v18.2.0)", () => {
    const two = visibleRail(FIXED + RING + FLAG * 2, FIXED, RING, FLAG, RAIL);
    expect(ks(two)).toEqual(["dep", "over"]);
    const three = visibleRail(FIXED + RING + FLAG * 3, FIXED, RING, FLAG, RAIL);
    expect(ks(three)).toEqual(["dep", "zone", "over"]);
    const four = visibleRail(FIXED + RING + FLAG * 4, FIXED, RING, FLAG, RAIL);
    expect(ks(four)).toEqual(["dep", "zone", "ns", "over"]);
    const five = visibleRail(FIXED + RING + FLAG * 5, FIXED, RING, FLAG, RAIL);
    expect(ks(five)).toEqual(["dep", "zone", "lock", "ns", "over"]);
  });

  it("shows the whole rail once there is room, in RAIL order", () => {
    const r = visibleRail(FIXED + RING + FLAG * 6, FIXED, RING, FLAG, RAIL);
    expect(r.showRing).toBe(true);
    expect(ks(r)).toEqual(["dep", "zone", "pref", "lock", "ns", "over"]);
  });

  it("renders survivors in RAIL order, never in priority order", () => {
    // The specific regression this guards: returning the sorted slice would put
    // the deposit to the RIGHT of the preference on a narrow block and to its
    // LEFT on a wide one, so the rail's layout would depend on the zoom level.
    const r = visibleRail(FIXED + RING + FLAG * 3, FIXED, RING, FLAG, RAIL);
    expect(ks(r)).toEqual(["dep", "zone", "over"]);
    expect(ks(r)).not.toEqual(["over", "dep", "zone"]);
  });
});

describe("visibleRail — edges", () => {
  it("never returns a negative count on a zero- or sub-zero-width block", () => {
    for (const w of [0, 1, 40, -20]) {
      const r = visibleRail(w, FIXED, RING, FLAG, RAIL);
      expect(r.showRing).toBe(false);
      expect(r.flags).toEqual([]);
    }
  });

  it("handles a block with no active flags", () => {
    const r = visibleRail(400, FIXED, RING, FLAG, []);
    expect(r.showRing).toBe(true);
    expect(r.flags).toEqual([]);
  });

  it("treats a missing flag list as empty rather than throwing", () => {
    // The WaitGhost call site passes [], but a future caller may pass nothing.
    expect(visibleRail(400, FIXED, RING, FLAG, undefined).flags).toEqual([]);
  });

  it("charges the start-time chip against the same budget", () => {
    // A block wide enough for the ring loses it again once a chip is added, and
    // that is correct: the chip is decided for the whole day by `chipsOn`, so
    // from this function's side it is simply more fixed cost.
    const w = FIXED + RING;
    expect(visibleRail(w, FIXED, RING, FLAG, RAIL).showRing).toBe(true);
    expect(visibleRail(w, FIXED + 42, RING, FLAG, RAIL).showRing).toBe(false);
  });

  it("passes the caller's own flag objects through untouched", () => {
    // TimelineView hangs `title` and a JSX `icon` off each entry; this function
    // must not rebuild them, or the icons would be recreated every render.
    const icon = {};
    const r = visibleRail(400, FIXED, RING, FLAG, [{ k: "dep", keep: 5, icon }]);
    expect(r.flags[0].icon).toBe(icon);
  });
});

describe("the fixture matches the component (v18.2.0 phase 22)", () => {
  // RAIL above is a copy of TimelineView's `railFlagsOf`, and a copy of an
  // order is the kind of thing that drifts: this reads the component's own
  // keys and priorities, in rail order, and compares.
  const tv = stripComments(readFileSync(new URL("../src/components/TimelineView.jsx", import.meta.url), "utf8")).join("\n");
  const body = tv.slice(tv.indexOf("function railFlagsOf("), tv.indexOf("function chipRoomFor("));

  it("same keys, same order, same drop priority", () => {
    const found = [...body.matchAll(/\{ k: "(\w+)", keep: (\d+)/g)].map((m) => ({ k: m[1], keep: Number(m[2]) }));
    expect(found).toEqual(RAIL);
  });

  it("the chip's room is counted from the SAME list the rail draws", () => {
    expect(tv).toMatch(/function chipRoomFor\(b, noShows, warn, clash\) \{\s*const flags = railFlagsOf\(b, noShows, warn, ""\)\.length;/);
    expect(tv).toMatch(/const allFlags = railFlagsOf\(b, noShows, warn, currency\);/);
  });
});
