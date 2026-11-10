// tests/haptics.test.js
// v18.14.0 (L7): Vibrate on drag. Whether a motor turns is a question for the
// device. This holds the rest: on by default, stored only when off, and silent
// wherever it cannot work.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { canVibrate, readVibrate, setVibrate, pulse } from "../src/lib/haptics.js";

const code = (f) => stripComments(readFileSync(new URL("../src/" + f, import.meta.url), "utf8")).join("\n");

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, size: () => m.size };
}

describe("the switch", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", fakeStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("is on with nothing stored", () => {
    expect(readVibrate()).toBe(true);
  });
  it("stores only off, and turning it on leaves nothing behind", () => {
    setVibrate(false);
    expect(readVibrate()).toBe(false);
    expect(localStorage.size()).toBe(1);
    setVibrate(true);
    expect(readVibrate()).toBe(true);
    expect(localStorage.size()).toBe(0);
  });
  it("reads as on where storage is blocked, and setting it does not throw", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } });
    expect(readVibrate()).toBe(true);
    expect(() => setVibrate(false)).not.toThrow();
  });
});

describe("the pulse", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", fakeStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("does nothing on a browser with no vibration, which is why Settings hides the switch", () => {
    vi.stubGlobal("navigator", {});
    expect(canVibrate()).toBe(false);
    expect(pulse()).toBe(false);
  });
  it("vibrates once, briefly, with the switch on", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    expect(canVibrate()).toBe(true);
    expect(pulse()).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate.mock.calls[0][0]).toBeLessThanOrEqual(30);
  });
  it("does nothing with the switch off, and reads it at the moment it fires", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    setVibrate(false);
    expect(pulse()).toBe(false);
    setVibrate(true);
    expect(pulse()).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
  it("never throws into a drag", () => {
    vi.stubGlobal("navigator", { vibrate() { throw new Error("refused"); } });
    expect(pulse()).toBe(false);
  });
});

describe("where it is wired", () => {
  const View = code("components/TimelineView.jsx");
  // v18.16.0: a time drag adds two, and only two: each quarter the block steps
  // to (a hand under a finger cannot see the chip), and a release that changes
  // the time. A release on the minute it began says nothing, like a drop home.
  it("pulses at the arm, at a real drop, at each quarter of a time drag and at its landing, and nowhere else", () => {
    expect((View.match(/\bpulse\(\);/g) || []).length).toBe(4);
    expect(View).toMatch(/setDragDy\(0\);\s+pulse\(\);/);
    expect(View).toMatch(/if \(target && target !== homeTable\) \{\s+pulse\(\);/);
    expect(View).toMatch(/if \(d\.step !== mins\) \{\s+pulse\(\);\s+d\.step = mins;/);
    expect(View).toMatch(/if \(newStart != null && newStart !== toMins\(b\.time\)\) \{\s+pulse\(\);/);
  });
  it("the switch is per device, never an account pref, and hidden with no vibration", () => {
    const hook = code("hooks/useShellPrefs.js");
    const toggle = hook.slice(hook.indexOf("function onToggleVibrate"), hook.indexOf("const [largeText"));
    expect(toggle).toContain("setVibrate(next);");
    expect(toggle).not.toMatch(/saveUserPrefs/);
    const settings = code("components/Settings.jsx");
    expect(settings).toMatch(/\{canVibrate\(\) \? \(/);
    expect(settings).toMatch(/<Toggle label="Vibrate on drag" on=\{vibrateOnDrag\} onClick=\{onToggleVibrate\} \/>/);
  });
});
