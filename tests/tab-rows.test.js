// tests/tab-rows.test.js — v18.2.0, the design critique's S1: every Settings
// tab in view. One natural row when it fits, else the fewest balanced rows
// whose cells hold the widest label.
//
// Measured on DEV before: nine tabs need ~700px and the bar was 530 on the
// 1280px tablet (App, Shortcuts and Admin out of sight) and 337 on a phone
// (five of nine). After: one row at 1280 and 800, 5 + 4 at 780 and 700, and
// 3 × 3 at 375 and 320 (Patryk's choice for the phone).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { tabColumns } from "../src/lib/tab-rows.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Settings = read("components/Settings.jsx");
const App = read("App.jsx");
const Atoms = read("components/atoms.jsx");

// The nine labels' text widths at 12px SF Pro, read on DEV with TabBar's own
// canvas measure (semibold at rest, bold when chosen; rounded up, +1). The row
// they ask for is 712px, and the 800px card's bar holds 716.
const SEMI = [47, 41, 66, 57, 64, 63, 25, 60, 39];
const BOLD = [48, 42, 67, 58, 66, 64, 26, 61, 40];
const cols = (inner) => tabColumns(SEMI, BOLD, inner, 4, 24, 12);

describe("tabColumns — how the nine Settings tabs are laid out", () => {
  it("keeps one natural row where it fits: the 800px card on a tablet", () => {
    expect(cols(742), "1280px: bar 750, content 742").toBe(0);
    expect(cols(716), "800px (portrait): bar 726, content 716").toBe(0);
  });

  it("balances two rows where one does not fit: 5 + 4, never 7 + 2", () => {
    expect(cols(696), "780px").toBe(5);
    expect(cols(616), "700px").toBe(5);
  });

  it("is the 3 × 3 grid on a phone, down to 320px", () => {
    expect(cols(329), "375px").toBe(3);
    expect(cols(274), "320px").toBe(3);
  });

  it("counts the chosen tab's bold, so choosing another tab cannot flip the layout", () => {
    const row = SEMI.reduce((s, w) => s + w + 24, 0) + 4 * 8;
    const extra = Math.max(...BOLD.map((b, i) => b - SEMI[i]));
    expect(cols(row + extra)).toBe(0);
    expect(cols(row + extra - 1), "one pixel short of the widest bold").toBeGreaterThan(0);
  });

  it("has no tabs to lay out and says one row", () => {
    expect(tabColumns([], [], 300, 4, 24, 12)).toBe(0);
  });
});

describe("the tab bar and the card", () => {
  it("no longer scrolls sideways with its scrollbar hidden", () => {
    const bar = Settings.slice(Settings.indexOf("export function TabBar"), Settings.indexOf("export function TabBar") + 4000);
    expect(bar).not.toMatch(/overflowX: "auto"/);
    expect(bar).not.toMatch(/scrollbarWidth: "none"/);
    expect(bar).toMatch(/const next = tabColumns\(semi, bold, bar\.clientWidth - 2 \* TAB_GAP, TAB_GAP, 2 \* TAB_ROW_PAD, 2 \* TAB_CELL_PAD\);/);
  });

  it("draws a grid as rounded rectangles with concentric corners, one row as pills", () => {
    expect(Settings).toMatch(/borderRadius: grid \? R\.card : R\.pill,/);
    expect(Settings).toMatch(/borderRadius: grid \? R\.inset : R\.pill,/);
  });

  // v18.2.0 phase 26 (S2): the card is centred and its height follows the tab,
  // so the bar sat at 120 · 205 · 120 · 120 · 186 · 280px for six tabs in a row.
  // Hung from the top, it measured 115 on all nine.
  it("hangs Settings from a fixed top, so the tab bar does not move between tabs", () => {
    expect(App).toMatch(/maxWidth=\{SETTINGS_CARD_W\} anchor="top"/);
    expect((App.match(/anchor="top"/g) || []).length, "Settings is the one caller").toBe(1);
    expect(Atoms).toMatch(/const TOP_ANCHOR = "max\(0px, calc\(5dvh - 12px\)\)";/);
    expect(Atoms).toMatch(/alignItems: top \? "flex-start" : "center"/);
    expect((Atoms.match(/marginTop: top \? TOP_ANCHOR : 0,/g) || []).length, "both card branches").toBe(2);
  });

  it("gives Settings the 800px card, and every other modal keeps 580", () => {
    expect(App).toMatch(/onClose=\{requestCloseSettings\} maxWidth=\{SETTINGS_CARD_W\}/);
    expect((Atoms.match(/maxWidth: maxWidth \|\| 580,/g) || []).length).toBe(2);
    expect((App.match(/maxWidth=\{SETTINGS_CARD_W\}/g) || []).length, "Settings is the one caller").toBe(1);
  });
});
