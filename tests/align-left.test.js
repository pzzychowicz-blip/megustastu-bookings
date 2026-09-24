// tests/align-left.test.js — v18.2.0: the header's view switcher lines up with
// the Summary card's left edge, and follows it with a glide when the Summary's
// width changes (Patryk: "aligned to the left edge of Summary. If Summary width
// changes, it must follow this width. The transition must be smooth and
// suitable for a gentle horizontal movement.").
//
// Measured on DEV at 1280px: the switcher sat right-aligned at 738.6 over a
// Summary starting at 306.8. After: 306.797 against 306.797, and 372.750 against
// 372.750 once the Today pill pushes the Summary right.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { alignShift } from "../src/hooks/useAlignLeft.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const App = read("App.jsx");
const Hook = read("hooks/useAlignLeft.js");

describe("alignShift — where the switcher goes", () => {
  it("moves left onto the target when the target is within reach", () => {
    // 1280px: the switcher right-aligned at 738.6, the Summary at 306.8, the
    // title block ending at 261.6 with the header's 8px gap.
    expect(alignShift(306.8, 738.6, 269.6)).toBeCloseTo(-431.8, 6);
  });

  it("stops at the floor when the target is further left than that", () => {
    // The Summary on a line of its own (its edge at the margin) while the
    // switcher still shares the title's line: as close as it can get.
    expect(alignShift(16, 738.6, 269.6)).toBeCloseTo(269.6 - 738.6, 6);
  });

  it("never moves right, where the action buttons follow it", () => {
    // 800px: the switcher starts the header's second line at 16 and the
    // Summary sits beside the date controls at 306.8 — Patryk kept portrait
    // as it was, and this is the rule that keeps it.
    expect(alignShift(306.8, 16, 16)).toBe(0);
  });

  it("stays put on a line of its own, where it already starts with the Summary", () => {
    expect(alignShift(12, 12, 12)).toBe(0);
  });
});

describe("the hook", () => {
  it("measures before paint and writes the transform itself, in the observer", () => {
    expect(Hook).toMatch(/useLayoutEffect\(function \(\) \{/);
    expect(Hook).toMatch(/const ro = new ResizeObserver\(measure\);/);
    expect(Hook).toMatch(/el\.style\.transform = dx \? "translateX\(" \+ dx \+ "px\)" : "";/);
    expect(Hook, "a state update would paint a frame late").not.toMatch(/useState|setState/);
  });

  it("reads the slot as the box minus the transform it has right now", () => {
    expect(Hook).toMatch(/const natural = r\.left - shiftOf\(el\);/);
  });

  it("glides only when the target moved and its own slot did not", () => {
    expect(Hook).toMatch(/const glide = lastTo !== null && Math\.abs\(to - lastTo\) > 0\.5 && Math\.abs\(natural - lastNatural\) < 0\.5;/);
    expect(Hook).toMatch(/el\.style\.transition = glide \? "transform " \+ M\.shift : "none";/);
  });

  it("writes nothing when the destination is unchanged, so an unrelated notification cannot cancel a glide", () => {
    const early = Hook.indexOf("if (lastDx !== null && Math.abs(dx - lastDx) < 0.5) return;");
    expect(early).toBeGreaterThan(-1);
    expect(early, "the early return comes before the style writes").toBeLessThan(Hook.indexOf("el.style.transition ="));
  });

  it("observes the target, itself, its row, and the title block with its row", () => {
    expect(Hook).toMatch(/\[target, el, el\.parentElement, before, before && before\.parentElement\]\.forEach/);
  });
});

describe("App's header", () => {
  it("lines the switcher up with the Summary's slot, never closer to the title than the header's gap", () => {
    expect(App).toMatch(/useAlignLeft\(viewSwitchRef,summarySlotRef,titleBlockRef\);/);
    expect(App).toMatch(/<div ref=\{titleBlockRef\} style=\{\{display:"flex",alignItems:"center",gap:10,minWidth:0\}\}>/);
  });

  it("moves the switcher and its split tools as one box, whose React style names neither property the hook writes", () => {
    expect(App).toMatch(/<div ref=\{viewSwitchRef\} style=\{\{display:"flex",gap:6,alignItems:"center"\}\}><ViewSwitcher/);
  });
});
