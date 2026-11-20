// tests/drag-hold.test.js
// v18.17.0 (H): Drag hold. How long the hold feels under a wet finger is a
// question for the tablet. This holds the rest: Normal by default, stored only
// when it is something else, read by the block when it sets its timer, and the
// status card's 400ms left where it was.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { DRAG_HOLDS, DEFAULT_DRAG_HOLD, readDragHold, setDragHold, dragHoldMs } from "../src/lib/drag-hold.js";
import { appCode } from "./app-source.js";

const code = (f) => stripComments(readFileSync(new URL("../src/" + f, import.meta.url), "utf8")).join("\n");

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, size: () => m.size };
}

describe("the setting", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", fakeStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("offers Short, Normal and Long, at 600, 800 and 1000ms, Normal the default", () => {
    expect(DRAG_HOLDS.map((h) => [h.id, h.label, h.ms])).toEqual([["short", "Short", 600], ["normal", "Normal", 800], ["long", "Long", 1000]]);
    expect(DEFAULT_DRAG_HOLD).toBe("normal");
  });
  it("is Normal, 800ms as it always was, with nothing stored", () => {
    expect(readDragHold()).toBe("normal");
    expect(dragHoldMs()).toBe(800);
  });
  it("stores only a value other than Normal, and going back to Normal leaves nothing behind", () => {
    setDragHold("long");
    expect(readDragHold()).toBe("long");
    expect(dragHoldMs()).toBe(1000);
    expect(localStorage.size()).toBe(1);
    setDragHold("short");
    expect(dragHoldMs()).toBe(600);
    setDragHold("normal");
    expect(readDragHold()).toBe("normal");
    expect(localStorage.size()).toBe(0);
  });
  it("an unknown value, stored or given, reads as Normal", () => {
    localStorage.setItem("mgt-tl-drag-hold", "glacial");
    expect(readDragHold()).toBe("normal");
    expect(dragHoldMs()).toBe(800);
    setDragHold("long");
    setDragHold("glacial");
    expect(localStorage.size()).toBe(0);
  });
  it("reads as Normal where storage is blocked, and setting it does not throw", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } });
    expect(dragHoldMs()).toBe(800);
    expect(() => setDragHold("long")).not.toThrow();
  });
  it("every hold is longer than the status card's 400ms, so the card always opens first", () => {
    for (const h of DRAG_HOLDS) expect(h.ms).toBeGreaterThan(400);
  });
});

describe("where it is wired", () => {
  const View = code("components/TimelineView.jsx");
  it("the block's drag arm reads the hold as it sets the timer, and no 800 is left", () => {
    expect(View).toMatch(/kickEdge\(\);\s+\}, dragHoldMs\(\)\);/);
    expect(View).not.toMatch(/\},\s*800\)/);
  });
  it("the status card's timer stays at 400ms", () => {
    expect(View).toMatch(/setQuickStatus\(\{ booking: b, x: rect\.left, y: rect\.top, w: rect\.width, h: rect\.height \}\);\s+\}, 400\);/);
  });
  it("is per device, never an account pref", () => {
    const hook = code("hooks/useShellPrefs.js");
    const set = hook.slice(hook.indexOf("function onSetDragHold"), hook.indexOf("const [largeText"));
    expect(set).toContain("setDragHold(id);");
    expect(set).not.toMatch(/saveUserPrefs/);
  });
  it("Settings → App offers the three as one named group, the chosen one pressed", () => {
    const settings = code("components/Settings.jsx");
    // v18.18.0 commit 18: `marginLeft: "auto"`, so it keeps the right where the row wraps.
    expect(settings).toContain('<div role="group" aria-label="Drag hold" style={{ ...SEG_TRACK, flexShrink: 0, marginLeft: "auto" }}>');
    expect(settings).toMatch(/aria-pressed=\{on\}\s+onClick=\{function \(\) \{ if \(!on\) onSetDragHold\(h\.id\); \}\}/);
    expect(settings).toContain("dragHold={dragHold} onSetDragHold={onSetDragHold} />;");
    const app = appCode();
    expect(app).toContain("dragHold={dragHold}");
    expect(app).toContain("onSetDragHold={onSetDragHold}");
  });
});
