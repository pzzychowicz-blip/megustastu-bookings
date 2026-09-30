// tests/stale-closures.test.js — v18.3.2 phase 6, the stale-closure triage
// (ROADMAP #10's first half). Each `react-hooks/exhaustive-deps` site was read
// and either fixed or kept with a `-- <reason>`; the fixes that change what
// runs are pinned here, one describe each, beside the measurement behind them.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");

// ── InboxPanel: the keyboard's bulk actions read the LIVE selection ──────────
// Measured on DEV (the sandbox's own `__waSim.question`): two conversations
// ticked, Backspace 0.2s or 16s later archived nothing; with two App renders
// forced between the ticks and the key it archived both. After: Backspace 0.2s
// after the ticks archived exactly the two, and R restored both from Archived.
describe("InboxPanel's keydown listener is re-added on every render", () => {
  const Inbox = read("components/whatsapp/InboxPanel.jsx");
  it("its effect has no dependency array to leave the selection out of", () => {
    expect(Inbox).toMatch(/window\.addEventListener\("keydown", onKey, true\);\s*return \(\) => window\.removeEventListener\("keydown", onKey, true\);\s*\}\);/);
  });
  it("and Backspace and R still take their keys from the selection", () => {
    expect(Inbox.match(/if \(selectMode\) \{ const keys = selectedKeysInTab\(\);/g)).toHaveLength(2);
    expect(Inbox).toMatch(/function selectedKeysInTab\(\) \{ return visibleInTab\.filter\(\(c\) => selected\.has\(c\.phoneKey\)\)/);
  });
  it("in the capture phase, which is what orders it ahead of the global Escape", () => {
    expect(Inbox).toMatch(/window\.addEventListener\("keydown", onKey, true\);/);
  });
});

// ── WeekView: T goes to TODAY, whenever it is pressed ────────────────────────
// Found by reading, not reproduced (it needs the popover open across midnight):
// the list was [mode, ref, focus], and `goToday` reads `today`, taken at render.
// Measured after, keys driven in the DEV app: → → steps two weeks, M and W
// switch mode around the focused day, T comes back, ↓ moves the day, Enter
// opens it.
describe("WeekView's keydown listener is re-added on every render", () => {
  const Week = read("components/WeekView.jsx");
  it("its effect has no dependency array", () => {
    expect(Week).toMatch(/window\.addEventListener\("keydown", onKey\);\s*return function\(\)\{ window\.removeEventListener\("keydown", onKey\); \};\s*\}\);/);
  });
  it("and today is still taken at render, which is why that matters", () => {
    expect(Week).toMatch(/const today = todayStr\(\);/);
    expect(Week).toMatch(/function goToday\(\)\{ setRef\(today\); setFocus\(today\); \}/);
  });
});

// ── TimelineView: Follow's fraction is computed from the CURRENT span ─────────
// `gridW` is max(320, totalMins × zoom × 1.2), so it tracks `totalMins` except
// under its floor, where the hours could change and the fraction be computed
// from the old span. Found by reading; measured after, Follow on today's DEV
// timeline scrolled to 0.5166 of the grid, against (18:10 − 13:00) / 600 min.
describe("the timeline's follow effect lists the span it divides by", () => {
  const Tl = read("components/TimelineView.jsx");
  it("names totalMins and scrollPosRef", () => {
    expect(Tl).toMatch(/\}, \[followNow, isToday, nowMins, gridW, followLeadMins, totalMins, scrollPosRef\]\);/);
    expect(Tl).toMatch(/const fraction = \(targetMins - OPEN \* 60\) \/ totalMins;/);
    expect(Tl).toMatch(/const gridW = Math\.max\(320, totalMins \* zoom \* 1\.2\);/);
  });
});
