// tests/time-grid.test.js
//
// v17.9.0. The point of these is the WRAP cases: before the extraction, the
// HH:00 label existed in three modulo behaviours across eight files, and the
// three disagreed precisely where the app's hours run past midnight. A
// past-midnight close gives GRID_CLOSE up to 26, so hour 25 is reachable on the
// real timeline — it is not a theoretical input.

import { describe, it, expect } from "vitest";
import { hourLabel, hourLabelAt, isHourMark, spanZoom, REFERENCE_GRID_MINS } from "../src/lib/time-grid.js";

describe("hourLabel", () => {
  it("pads to two digits", () => {
    expect(hourLabel(0)).toBe("00:00");
    expect(hourLabel(9)).toBe("09:00");
    expect(hourLabel(13)).toBe("13:00");
    expect(hourLabel(23)).toBe("23:00");
  });

  // The reason the function exists. GRID_CLOSE reaches 26 on a past-midnight
  // close, so these are live values on the timeline, not edge cases.
  it("wraps past midnight", () => {
    expect(hourLabel(24)).toBe("00:00");
    expect(hourLabel(25)).toBe("01:00");
    expect(hourLabel(26)).toBe("02:00");
  });

  // No current caller passes a negative, but a single `% 24` would render "-1:00"
  // here and the double modulo costs nothing.
  it("wraps negatives rather than printing a minus sign", () => {
    expect(hourLabel(-1)).toBe("23:00");
    expect(hourLabel(-24)).toBe("00:00");
  });

  it("truncates a fractional hour rather than printing a decimal", () => {
    expect(hourLabel(13.5)).toBe("13:00");
  });
});

describe("hourLabelAt", () => {
  it("converts minute offsets", () => {
    expect(hourLabelAt(13 * 60)).toBe("13:00");
    expect(hourLabelAt(0)).toBe("00:00");
  });

  // TimelineView and TimeAxis both feed this from QUARTER_HOURS, which runs to
  // GRID_CLOSE * 60.
  it("wraps a past-midnight minute offset", () => {
    expect(hourLabelAt(25 * 60)).toBe("01:00");
    expect(hourLabelAt(26 * 60)).toBe("02:00");
  });

  // Both call sites filter to `m % 60 === 0` first, but a mid-hour value must
  // still name the hour it is inside rather than rounding to the next one.
  it("names the containing hour for a mid-hour offset", () => {
    expect(hourLabelAt(13 * 60 + 45)).toBe("13:00");
  });
});

describe("isHourMark", () => {
  it("is true only on the hour", () => {
    expect(isHourMark(13 * 60)).toBe(true);
    expect(isHourMark(13 * 60 + 15)).toBe(false);
    expect(isHourMark(13 * 60 + 30)).toBe(false);
    expect(isHourMark(13 * 60 + 45)).toBe(false);
  });
});

describe("spanZoom — the hours span decides the opening zoom", () => {
  it("is 1x on the reference day, so the MGT default is untouched", () => {
    // 13:00 open → 23:00 GRID_CLOSE = 600 minutes. The whole point is that a
    // restaurant on the default hours sees byte-for-byte what it saw before.
    expect(spanZoom(REFERENCE_GRID_MINS, 5)).toBe(1);
  });

  it("is 2x on the DEV 06:00–01:00 day, restoring the reference density", () => {
    // open 6 → gridClose 26 = 1200 minutes, twice the reference.
    expect(spanZoom(1200, 5)).toBe(2);
  });

  it("lands on the zoom control's own 0.5 step", () => {
    // 900 min = 1.5x exactly. The in-between values round to the NEAREST step
    // in both directions, so nothing off-step ever reaches the control: 800 min
    // is 1.333 → 1.5, and 700 min is 1.167 → 1.
    expect(spanZoom(900, 5)).toBe(1.5);
    expect(spanZoom(800, 5)).toBe(1.5);
    expect(spanZoom(700, 5)).toBe(1);
  });

  it("never zooms OUT below 1x on a short day", () => {
    // A restaurant open 18:00–22:00 has a 300-minute grid. Half the reference
    // density is not a reason to shrink the app's baseline.
    expect(spanZoom(300, 5)).toBe(1);
  });

  it("respects the device's configured ceiling", () => {
    expect(spanZoom(6000, 2)).toBe(2);
    expect(spanZoom(6000, 5)).toBe(5);
  });

  it("falls back to 1x on nonsense rather than propagating it", () => {
    // A closed day's fallback range, a mid-load seed, a hand-edited setting.
    expect(spanZoom(0, 5)).toBe(1);
    expect(spanZoom(-600, 5)).toBe(1);
    expect(spanZoom(NaN, 5)).toBe(1);
    expect(spanZoom(600, NaN)).toBe(1);
    expect(spanZoom(1200, 0.5)).toBe(1);   // a ceiling below 1 is not a floor
  });
});
