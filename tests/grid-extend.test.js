// tests/grid-extend.test.js — v18.2.0: the viewed day's grid reaches its
// latest booking, and the timeline opens where the day's bookings are.
//
// The grid ran OPEN…GRID_CLOSE (close + 1h) whatever was booked, so on the
// critique's DEV day a 21:45 party booked for two hours ran off the right edge
// at 23:00. `extendActiveGrid` (constants.js) stretches the ACTIVE day's live
// bindings — display only, never shorter, capped at 26.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import * as C from "../src/lib/constants.js";

// A date whose weekday runs the default 13–22 (GRID_CLOSE 23). The live
// bindings are module state, so every test starts from a fresh setActiveDayHours.
const D = "2026-10-03";

describe("extendActiveGrid", () => {
  beforeEach(() => { C.setActiveDayHours(D); });

  it("leaves the grid alone when every booking ends inside it", () => {
    const base = C.GRID_CLOSE;
    C.extendActiveGrid(22 * 60 + 30);
    expect(C.GRID_CLOSE).toBe(base);
  });

  it("stretches to the hour AFTER the latest end — 23:45 → 24", () => {
    const base = C.GRID_CLOSE;
    C.extendActiveGrid(23 * 60 + 45);
    expect(C.GRID_CLOSE).toBe(Math.max(base, 24));
    expect(C.QUARTER_HOURS.length).toBe((C.GRID_CLOSE - C.OPEN) * 4);
    expect(C.QUARTER_HOURS[C.QUARTER_HOURS.length - 1]).toBe(C.GRID_CLOSE * 60 - 15);
  });

  it("never SHORTENS the grid", () => {
    const base = C.GRID_CLOSE;
    C.extendActiveGrid(15 * 60);
    expect(C.GRID_CLOSE).toBe(base);
  });

  it("is capped at 26, GRID_CLOSE's documented ceiling", () => {
    C.extendActiveGrid(40 * 60);
    expect(C.GRID_CLOSE).toBe(26);
  });

  it("ignores a non-number (an empty day reduces to -Infinity)", () => {
    const base = C.GRID_CLOSE;
    C.extendActiveGrid(-Infinity);
    C.extendActiveGrid(NaN);
    expect(C.GRID_CLOSE).toBe(base);
  });

  it("does not touch hoursFor(), which the placement logic reads", () => {
    const before = C.hoursFor(D);
    C.extendActiveGrid(23 * 60 + 45);
    expect(C.hoursFor(D)).toEqual(before);
  });

  it("the next render's setActiveDayHours resets it — it is per-render, never sticky", () => {
    C.extendActiveGrid(25 * 60);
    C.setActiveDayHours(D);
    expect(C.GRID_CLOSE).toBe(C.hoursFor(D).gridClose);
  });
});

describe("the call sites", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
  const App = read("App.jsx");
  const Timeline = read("components/TimelineView.jsx");
  const Plan = read("components/PlanView.jsx");

  it("App extends AFTER useOperatingHours resets the bindings, in render", () => {
    const hours = App.indexOf("= useOperatingHours(viewDate);");
    const ext = App.indexOf("extendActiveGrid(viewLatestEnd);");
    expect(hours).toBeGreaterThan(-1);
    expect(ext, "the extension must follow the reset, or the reset wipes it").toBeGreaterThan(hours);
  });

  it("the Plan's scrub bound reads the live GRID_CLOSE, as TimeAxis does", () => {
    expect(Plan).toMatch(/const closeM = \(h\.closed \? 23 : Math\.max\(h\.gridClose, GRID_CLOSE\)\) \* 60;/);
  });

  it("the once-per-date scroll is guarded by App's date ref and records into scrollPosRef", () => {
    expect(Timeline).toMatch(/if \(scrollDateRef\.current === date\) return;/);
    const eff = Timeline.slice(Timeline.indexOf("if (scrollDateRef.current === date) return;"));
    const body = eff.slice(0, eff.indexOf("}, [date, firstStart, isToday, followNow]);"));
    expect(body, "without this the restore effect puts the old day's position back").toMatch(/scrollPosRef\.current = fraction \* gridW;/);
    expect(App).toMatch(/scrollDateRef=\{timelineScrollDateRef\}/);
  });
});
