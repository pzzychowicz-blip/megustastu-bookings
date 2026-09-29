// tests/focus-return.test.js — v18.3.1
//
// Which element a dialog hands focus back to when it closes. The decision is
// pure (`pickOpener`) and tested here; the DOM half and its two wiring sites are
// pinned at the source. Measured in the rig from the keyboard, StrictMode off:
// Settings, Find a booking and the List card's ⋯ confirms all returned focus to
// <body> before this, and to their opener after it. Comments stripped
// (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { RECENT_MS, pickOpener } from "../src/lib/focus-return.js";

const src = (p) => stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", p), "utf8")).join("\n");

// Elements as plain tags; the predicates are what the DOM half passes.
const BODY = { tag: "body" };
const cog = { tag: "cog" }, find = { tag: "find" }, inside = { tag: "search box" };
const field = { tag: "notes", typing: true }, gone = { tag: "gone", detached: true };
const isBody = (el) => el === BODY;
const inDialog = (el) => el === inside;
const usable = (el) => !el.detached && !el.typing;
const pick = (active, blurs, now = 1000) => pickOpener(active, isBody, inDialog, usable, blurs, now);

describe("pickOpener", () => {
  it("keeps the element that still holds focus (+ New, Walk-in)", () => {
    expect(pick(cog, [{ el: find, t: 990 }])).toBe(cog);
  });

  it("falls back to the latest blur when focus is on <body> (Settings, the ⋯ confirms)", () => {
    expect(pick(BODY, [{ el: find, t: 900 }, { el: cog, t: 990 }])).toBe(cog);
  });

  it("falls back when focus is already inside the dialog (Find a booking's search box)", () => {
    expect(pick(inside, [{ el: find, t: 990 }, { el: inside, t: 995 }])).toBe(find);
  });

  it("skips a blur that is <body>, in the dialog, detached or a text field", () => {
    const blurs = [{ el: cog, t: 950 }, { el: field, t: 960 }, { el: gone, t: 970 }, { el: inside, t: 980 }, { el: BODY, t: 990 }];
    expect(pick(BODY, blurs)).toBe(cog);
  });

  it("never reaches past RECENT_MS: an old blur is not this dialog's opener", () => {
    expect(pick(BODY, [{ el: cog, t: 1000 - RECENT_MS - 1 }])).toBe(null);
    expect(pick(BODY, [{ el: cog, t: 1000 - RECENT_MS }])).toBe(cog);
  });

  it("returns null with nothing to go back to", () => {
    expect(pick(BODY, [])).toBe(null);
    expect(pick(null, [])).toBe(null);
  });
});

describe("the wiring", () => {
  const lib = src("lib/focus-return.js");
  const atoms = src("components/atoms.jsx");
  const popup = src("components/QuickStatusPopup.jsx");

  it("the blur record is installed when the module loads, not by the first dialog", () => {
    // Installed from useDialog, it missed the first dialog's own opener: Find,
    // opened first, blurred its button before the dialog mounted.
    expect(lib).toMatch(/\ntrackBlurs\(\);\s*$/);
    expect(atoms).not.toMatch(/trackBlurs/);
  });

  it("useDialog asks openerFor, not document.activeElement", () => {
    expect(atoms).toMatch(/restoreRef\.current = openerFor\(el\);/);
    expect(atoms).not.toMatch(/restoreRef\.current = document\.activeElement/);
  });

  it("a ⋯ pick hands focus back in the handler, before the confirm makes the page inert", () => {
    expect(popup.match(/skipExit\(\);\s*handBack\(\);/g).length).toBe(3);
  });
});
