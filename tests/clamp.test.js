// tests/clamp.test.js
//
// Safety-net for src/lib/clamp.js. `clampStep` sanitises every numeric field in
// three settings nodes, so a wrong answer here is a wrong opening hour, a wrong
// booking duration or a wrong late threshold — silently, on every device.
//
// The case worth pinning is the ORDER: the finite check must run AFTER the
// round, because NaN survives `Math.round(NaN / step) * step` and would then
// escape through Math.max/Math.min as NaN. The duplicate copy this file's
// module replaced carried a comment saying so and nothing enforcing it.

import { describe, it, expect } from "vitest";
import { clampStep } from "../src/lib/clamp.js";

describe("clampStep — snapping", () => {
  it("snaps to the nearest step", () => {
    expect(clampStep(97, 90, 15, 360, 15)).toBe(90);
    expect(clampStep(98, 90, 15, 360, 15)).toBe(105);
  });
  it("leaves an on-grid value alone", () => {
    expect(clampStep(90, 90, 15, 360, 15)).toBe(90);
  });
  it("accepts a numeric string, which is what an <input> hands back", () => {
    expect(clampStep("45", 90, 15, 360, 15)).toBe(45);
  });
});

describe("clampStep — bounds", () => {
  it("holds the value inside min/max", () => {
    expect(clampStep(9999, 90, 15, 360, 15)).toBe(360);
    expect(clampStep(-5, 90, 15, 360, 15)).toBe(15);
  });
  it("clamps the fallback too, so a bad default cannot escape the range", () => {
    expect(clampStep(undefined, 1000, 15, 360, 15)).toBe(360);
  });
});

describe("clampStep — the NaN path, which is the whole reason for the ordering", () => {
  it.each([undefined, "abc", {}, NaN])("falls back to the default for %p", (bad) => {
    expect(clampStep(bad, 90, 15, 360, 15)).toBe(90);
  });
  it("never returns NaN, whatever it is handed", () => {
    for (const bad of [undefined, null, "", "abc", {}, [], NaN, Infinity, -Infinity]) {
      expect(Number.isFinite(clampStep(bad, 90, 15, 360, 15))).toBe(true);
    }
  });
});

describe("clampStep — null and \"\" are NOT absent, and that is worth knowing", () => {
  // `Number(null)` and `Number("")` are both 0, which is finite — so these do
  // NOT take the fallback, they clamp to `min`. That is the shipped behaviour
  // since v16.1.0 and this commit does not change it; the test is here so the
  // next person to "fix" the guard sees the distinction before they move it.
  //
  // It is unreachable from Firebase, which is why it has never mattered: RTDB
  // cannot store null (writing null DELETES the key), so an absent settings
  // field arrives as `undefined` and correctly takes the default above.
  it("clamps null to min rather than falling back", () => {
    expect(clampStep(null, 90, 15, 360, 15)).toBe(15);
  });
  it("clamps an empty string to min rather than falling back", () => {
    expect(clampStep("", 90, 15, 360, 15)).toBe(15);
  });
  it("also clamps [] to min, for the same Number([]) === 0 reason", () => {
    expect(clampStep([], 90, 15, 360, 15)).toBe(15);
  });
});
