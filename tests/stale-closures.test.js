// tests/stale-closures.test.js — v18.3.2 phase 6, the stale-closure triage
// (ROADMAP #10's first half). Each `react-hooks/exhaustive-deps` site was read
// and either fixed or kept with a `-- <reason>`; the fixes that change what
// runs are pinned here, one describe each, beside the measurement behind them,
// and so are usePersistence's five keeps, whose reason a later edit to a
// function they call could make false without touching the effects at all.

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

// ── Effects that list less than the functions they call ──────────────────────
// usePersistence's bookings listener, connection listener and heartbeat attach
// ONCE, so they call the FIRST render's drainPending / resync / gapTrip /
// kickIfStuck, and its auto-extend and auto-complete passes leave `saveBookings`
// unlisted. AutoHeight's observer is attached once and its `watch` swap is keyed
// on the swap, and both call `armSettle`. Every one of those keeps its directive
// for ONE reason: the functions those effects reach read only refs, state
// setters and module values, so any render's copy does what the latest would.
// This derives both halves from the source — the render-scoped names (props and
// state VALUES) and the functions reachable from the effects — and fails when
// one reads the other, which a later edit to a FUNCTION could do without
// touching an effect at all.
const blankStrings = (src) => src.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
// The body of the block whose `{` sits at `open`, by brace count.
function blockAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("unbalanced block at " + open);
}
// A use of `name` as a variable: not a property (`x.name`), not part of a longer word.
const refersTo = (body, name) => new RegExp("(?<![.\\w$])" + name + "(?![\\w$])").test(body);

// `unit` is an exported function taking destructured props: a hook or a component.
function staleReads(source, unit) {
  const blank = blankStrings(source);
  const head = blank.match(new RegExp("export function " + unit + "\\(\\{([^}]*)\\}\\)\\s*\\{"));
  const body = blockAt(blank, head.index + head[0].length - 1);
  const props = head[1].split(",").map((s) => s.trim()).filter(Boolean);
  const stateValues = [...body.matchAll(/const \[(\w+),\s*\w+\]\s*=\s*useState\(/g)].map((m) => m[1]);
  const scoped = props.concat(stateValues);
  const fns = {};
  for (const m of body.matchAll(/^ {2}function (\w+)\([^)]*\)\s*\{/gm)) fns[m[1]] = blockAt(body, m.index + m[0].length - 1);
  const effects = [...body.matchAll(/use(?:Layout)?Effect\(function\s*\(\)\s*\{/g)].map((m) => blockAt(body, m.index + m[0].length - 1));
  const reached = new Set();
  const queue = [];
  const visit = (text) => {
    for (const n of Object.keys(fns)) if (!reached.has(n) && refersTo(text, n)) { reached.add(n); queue.push(n); }
  };
  effects.forEach(visit);
  while (queue.length) visit(fns[queue.shift()]);
  const bad = [];
  for (const n of reached) for (const v of scoped) if (refersTo(fns[n], v)) bad.push(n + " reads " + v);
  return { scoped, reached: [...reached].sort(), bad };
}

describe("usePersistence's effects reach no prop and no state value", () => {
  const Persist = read("hooks/usePersistence.js");
  const found = staleReads(Persist, "usePersistence");
  it("derives something to check on both sides", () => {
    expect(found.scoped).toEqual(expect.arrayContaining(["autoOptimizer", "nowMins", "bookings", "tableBlocks", "resyncing"]));
    expect(found.reached).toEqual(expect.arrayContaining(["drainPending", "resync", "gapTrip", "kickIfStuck", "saveBookings"]));
  });
  it("and no reachable function reads one", () => {
    expect(found.bad).toEqual([]);
  });
  it("catches it when one does", () => {
    const planted = Persist.replace("staleRef.current=false;", "staleRef.current=!nowMins;");
    expect(planted).not.toBe(Persist);
    expect(staleReads(planted, "usePersistence").bad).toEqual(["clearStale reads nowMins"]);
  });
});

describe("AutoHeight's effects reach no prop and no state value", () => {
  const Atoms = read("components/atoms.jsx");
  const found = staleReads(Atoms, "AutoHeight");
  it("derives something to check on both sides", () => {
    expect(found.scoped).toEqual(["children", "watch", "style", "h", "animating"]);
    expect(found.reached).toEqual(["armSettle", "settle"]);
  });
  it("and neither function reads one", () => {
    expect(found.bad).toEqual([]);
  });
  it("catches it when one does", () => {
    const planted = Atoms.replace("capAtRef.current = 0;", "capAtRef.current = watch ? 0 : 1;");
    expect(planted).not.toBe(Atoms);
    expect(staleReads(planted, "AutoHeight").bad).toEqual(["settle reads watch"]);
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
