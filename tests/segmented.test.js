// tests/segmented.test.js — v18.2.0: the view switcher is ONE segmented
// control, sharing its look with Settings' TabBar through atoms' SEG_TRACK /
// segStyle, and "+ New" is the only solid accent in the header.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Switcher = read("components/ViewSwitcher.jsx");
const Settings = read("components/Settings.jsx");
const Atoms = read("components/atoms.jsx");

describe("the view switcher", () => {
  it("is a named group of three, each saying whether it is on", () => {
    expect(Switcher).toMatch(/<div role="group" aria-label="View" style=\{SEG_TRACK\}>/);
    expect(Switcher).toMatch(/aria-pressed=\{isActive\(v\)\}/);
  });

  it("paints its segments with segStyle, never with the accent fill", () => {
    expect(Switcher).toMatch(/segStyle\(isActive\(v\)\)/);
    expect(Switcher, "the chosen view is solid blue again — it reads as '+ New'").not.toMatch(/S\.accent/);
  });

  it("stands exactly H.control tall: a H.chrome segment + 2px track padding, no border", () => {
    expect(Switcher).toMatch(/minHeight: H\.chrome/);
    expect(Atoms).toMatch(/export const SEG_TRACK = \{[^}]*padding: 2,/);
    const track = Atoms.slice(Atoms.indexOf("export const SEG_TRACK"), Atoms.indexOf("};", Atoms.indexOf("export const SEG_TRACK")));
    expect(track, "a border adds 2px — the hairline is an inset shadow").not.toMatch(/\bborder:/);
  });
});

describe("one segment look, two users", () => {
  it("TabBar reads segStyle too, rather than a hand-typed copy", () => {
    expect(Settings).toMatch(/\.\.\.segStyle\(active\)/);
    expect(Settings, "a second copy of the lifted-tab fill").not.toMatch(/background: active \? "var\(--bg-tab-active\)"/);
  });

  it("the chosen segment's ink is primary text, not the accent (4.02 / 2.25:1)", () => {
    expect(Atoms).toMatch(/color: active \? "var\(--text-primary\)" : "var\(--text-muted\)"/);
  });
});

describe("the header subtitle (v18.2.0)", () => {
  const App = read("App.jsx");
  it("separates its three facts, and ranges with an en dash", () => {
    expect(App).toMatch(/INDOOR\.length\+" indoor · "\+OUTDOOR\.length\+" outdoor · "\+\(dayClosed\?"Closed":hourLabel\(OPEN\)\+"–"\+hourLabel\(CLOSE\)\)/);
  });
});

describe("a modal title is a label, not a button (v18.2.0)", () => {
  it("ModalTitle keeps its colour but wears no button shadow and no solid-button rim", () => {
    const fn = Atoms.slice(Atoms.indexOf("export function ModalTitle"), Atoms.indexOf("\n}\n", Atoms.indexOf("export function ModalTitle")));
    expect(fn).toMatch(/background, margin: 0/);
    expect(fn).not.toMatch(/boxShadow/);
    expect(fn).not.toMatch(/RIM_SOLID/);
  });
});

// v18.2.0 phase 64 (Patryk): phase 23 glided the switcher sideways to stand
// over the Summary card's left edge whenever the Summary's width changed;
// tried in use, the movement did not look good, and it is gone. Measured on DEV
// at 1280px after: the switcher's group and every ancestor up to the header
// compute `transform: none`, the group at its own place (x 739).
describe("phase 64 — the switcher keeps its own place", () => {
  it("nothing moves it: the hook is gone and App no longer calls it", () => {
    expect(existsSync(join(SRC, "hooks", "useAlignLeft.js"))).toBe(false);
    expect(read("App.jsx")).not.toMatch(/useAlignLeft|viewSwitchRef|titleBlockRef/);
  });
});
