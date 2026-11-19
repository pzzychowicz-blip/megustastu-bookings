// tests/app-width-fit.test.js — v18.18.0
//
// ── FIT TO SCREEN ───────────────────────────────────────────────────────────
// Patryk (2026-11-19, item 3): on a new device the app should fill the screen. A
// "Fit to screen" switch, ON by default on EVERY device, including one that already
// stored a width; that width comes back when the switch goes off. What it looks like
// is in REFACTOR_LOG, because that takes a browser. This holds what fails silently:
// a switch stored the wrong way round, a stored width that still decides it, a hand-
// set width that leaves it on, and a shell that is still capped while it is on.
//
// It reads the hook, App and Settings comment-stripped (tests/test-hygiene.test.js).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { appCode } from "./app-source.js";
import { fitAppWidth } from "../src/hooks/useShellPrefs.js";

const read = (f) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
const code = (f) => stripComments(read(f)).join("\n");
const hook = code("hooks/useShellPrefs.js");
const settings = code("components/Settings.jsx");

describe("the switch", () => {
  it("is on unless this device turned it off, and only the off is stored", () => {
    expect(hook).toContain('const APP_FIT_KEY="mgt-appwidth-fit";');
    expect(hook).toContain('try{return localStorage.getItem(APP_FIT_KEY)!=="0";}catch{return true;}');
    expect(hook).toContain("try{localStorage.removeItem(APP_FIT_KEY);}");
    expect(hook).toContain('try{localStorage.setItem(APP_FIT_KEY,"0");}');
    expect(hook.match(/localStorage\.setItem\(APP_FIT_KEY,/g)).toHaveLength(1);
  });
  it("is on where a width is already stored: the stored width never decides it", () => {
    const read = hook.slice(hook.indexOf("function readAppWidthFit("), hook.indexOf("export function fitAppWidth("));
    expect(read.length).toBeGreaterThan(0);
    expect(read).not.toContain("mgt-appwidth\"");
    expect(read).not.toContain("storedAppWidth");
  });
  it("goes off when a width is set by hand: the stepper and ⇧+ / ⇧− both reach onSetAppWidth", () => {
    const set = hook.slice(hook.indexOf("function onSetAppWidth("), hook.indexOf("function onToggleAppWidthFit("));
    expect(set).toContain("if(appWidthFit) storeFitOff();");
    const shortcuts = code("lib/shortcuts.js");
    expect(shortcuts).toContain("K.onSetAppWidth(K.appWidth + 50)");
    expect(shortcuts).toContain("K.onSetAppWidth(K.appWidth - 50)");
  });
  it("turned off with no width stored, keeps the width on screen and stores it, so nothing jumps", () => {
    const toggle = hook.slice(hook.indexOf("function onToggleAppWidthFit("), hook.indexOf("const [reduceMotion,setReduceMotion]"));
    expect(toggle).toContain("if(storedAppWidth()===null){");
    expect(toggle).toContain("const v=fitAppWidth(winW);");
    expect(toggle).toContain('try{localStorage.setItem("mgt-appwidth",String(v));}');
  });
  it("never reaches the database: it is this device's", () => {
    const toggle = hook.slice(hook.indexOf("function storeFitOff("), hook.indexOf("const [reduceMotion,setReduceMotion]"));
    expect(toggle.length).toBeGreaterThan(0);
    expect(toggle).not.toMatch(/saveUserPrefs/);
  });
});

describe("while it is on", () => {
  it("the shell has no maxWidth, and Split View divides the whole window", () => {
    expect(appCode()).toContain('maxWidth:appWidthFit?"none":appWidth,margin:"0 auto"');
    expect(hook).toContain("const shellW=appWidthFit?winW:Math.min(winW,appWidth);");
  });
  it("the width a step starts from is the window's, rounded down to 50, in the stepper's range", () => {
    expect(hook).toContain("appWidth: appWidthFit ? fitAppWidth(winW) : appWidth, onSetAppWidth,");
    expect(fitAppWidth(1280)).toBe(1250);
    expect(fitAppWidth(998)).toBe(950);
    expect(fitAppWidth(1920)).toBe(1900);
    expect(fitAppWidth(375)).toBe(900);
    expect(fitAppWidth(3000)).toBe(2400);
  });
});

describe("in Settings → App", () => {
  it("is one switch, and the App width stepper folds away under it while it is on", () => {
    expect(settings).toContain('<Toggle label="Fit to screen" on={appWidthFit} onClick={onToggleAppWidthFit} />');
    const fold = settings.slice(settings.indexOf("<Reveal show={!appWidthFit}>"));
    expect(fold.indexOf('<MiniStepper label="app width"')).toBeGreaterThan(0);
    expect(fold.indexOf('<MiniStepper label="app width"')).toBeLessThan(fold.indexOf("</Reveal>"));
    expect(settings.indexOf('label="Fit to screen"')).toBeLessThan(settings.indexOf("<Reveal show={!appWidthFit}>"));
  });
  it("is handed down from App", () => {
    expect(appCode()).toContain("appWidthFit={appWidthFit}");
    expect(appCode()).toContain("onToggleAppWidthFit={onToggleAppWidthFit}");
    expect(settings).toContain("appWidthFit={appWidthFit} onToggleAppWidthFit={onToggleAppWidthFit}");
  });
});
