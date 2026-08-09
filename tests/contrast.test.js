// tests/contrast.test.js
//
// v17.8.0 — the fill/ink contrast guard.
//
// ── The bug this exists to prevent ───────────────────────────────────────────
// Every saturated fill in this app was written as `rgba(hue, 0.7–0.92)` and
// declared in `:root` only, with a comment stating the block/table/button
// tokens are "theme-invariant (saturated fills read on both themes)". They are
// not. An alpha fill composites toward whatever is BEHIND it, so the same token
// lands in a different place per theme: over dark-mode's near-black sheet it
// darkens and white text pops, over light-mode's near-white sheet it washes out
// and white text dissolves.
//
// Measured before the fix, white text in LIGHT mode:
//   --tbl-out-rgb (9 table pills)  2.15:1     --block-pending  1.84:1
//   --btn-nav (inactive view btns) 1.90:1     --btn-default    2.02:1
// The same tokens in dark mode: 3.54, 2.20, 7.65, 7.12. Dark mode passed, light
// mode failed, and light mode is the one running on a terrace tablet in Canary
// Islands daylight. Nobody had checked the light side in eight versions.
//
// The four fills that DID pass were the four authored as opaque and picked
// deliberately: --app-success-solid, --app-danger-solid, --app-warn-solid,
// --tag-flag. That is the whole lesson, and it is now the rule:
//
//   A fill that carries TEXT is chosen for its contrast against its ink, per
//   theme. Alpha is for decoration, never for a text-bearing surface.
//
// ── Why the registry lives here and not in the source ────────────────────────
// The pairing of a fill with the alpha it is USED at is the thing that goes
// stale — constants.js composes `rgba(var(--tbl-out-rgb), 0.8)` a long way from
// index.html, where the triplet is defined. Keeping both halves in one table is
// what lets the check see what the screen sees. If you change an alpha in
// constants.js, change it here, and the test will tell you what it cost.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"),
  "utf8"
);

// ── Theme token extraction ───────────────────────────────────────────────────
// Both blocks are flat `--name: value;` lists. Dark inherits from light, so the
// dark map is light overlaid with the dark block — which is exactly the
// inheritance the browser performs, and the reason a light-only token was able
// to be wrong in dark for so long without anyone noticing.
function block(selector) {
  const i = HTML.indexOf(selector);
  if (i < 0) throw new Error("no " + selector + " block in index.html");
  const open = HTML.indexOf("{", i);
  const end = HTML.indexOf("\n      }", open);
  const body = HTML.slice(open + 1, end);
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const LIGHT_VARS = block(":root {");
const DARK_VARS = Object.assign({}, LIGHT_VARS, block('[data-theme="dark"] {'));

// ── Colour maths ─────────────────────────────────────────────────────────────
function parse(v) {
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const short = v.match(/^#([0-9a-f]{3})$/i);
  if (short) {
    const [x, y, z] = short[1].split("");
    return { r: parseInt(x + x, 16), g: parseInt(y + y, 16), b: parseInt(z + z, 16), a: 1 };
  }
  const n = v.match(/-?[\d.]+/g);
  if (!n) throw new Error("unparseable colour: " + v);
  return { r: +n[0], g: +n[1], b: +n[2], a: n[3] !== undefined ? +n[3] : 1 };
}
const chan = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (c) => 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
const over = (fg, bg) => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
  a: 1,
});
function ratio(a, b) {
  const [L1, L2] = [lum(a), lum(b)];
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

// The surface a fill sits on. Both are the app's real sheet/panel colour with
// its own alpha already resolved — and both are the LIGHTEST (light) and
// DARKEST (dark) plausible base, i.e. the worst case for washout in each theme.
// Measured in the running app, not assumed: a table badge and a View button
// both composite against pure WHITE, because the card they sit in is itself
// translucent all the way down to the sheet. An earlier version of this file
// guessed --bg-soft (248,250,253) and every solved value came out ~0.06 short
// of the bar — right maths, wrong backdrop. Take the extreme of each theme.
const BASE = { light: { r: 255, g: 255, b: 255, a: 1 }, dark: { r: 36, g: 37, b: 42, a: 1 } };

// ── The registry ─────────────────────────────────────────────────────────────
// alpha  — what constants.js actually composes the token at (null = the token
//          carries its own alpha, so it is used verbatim).
// ink    — the token painted ON it.
// role   — `label` is small bold text (<18.66px) and takes the full AA 4.5:1.
//          `button` is a large solid control whose meaning is also carried by
//          position and shape, and takes 3:1 — Patryk's call, so the palette
//          stays recognisable rather than every button going muddy.
const FILLS = [
  // Table badges — 11px/600, the most-read label in the app.
  { fill: "--tbl-out-rgb", alpha: 0.8, ink: "--text-on-accent", role: "label", what: "outdoor table badge" },
  { fill: "--tbl-ind-rgb", alpha: 0.8, ink: "--text-on-accent", role: "label", what: "indoor table badge" },

  // Timeline blocks + status pills — 10–12px labels on a saturated fill. Each
  // fill names its OWN ink: the amber pair is too light for white text and dark
  // ink is the correct answer there, not a browner amber (see BLOCK_INK).
  { fill: "--block-confirmed", alpha: null, ink: "--ink-confirmed", role: "label", what: "confirmed block" },
  { fill: "--block-pending", alpha: null, ink: "--ink-pending", role: "label", what: "pending block" },
  { fill: "--block-seated", alpha: null, ink: "--ink-seated", role: "label", what: "seated block" },
  { fill: "--block-completed", alpha: null, ink: "--ink-completed", role: "label", what: "completed block" },
  { fill: "--block-cancelled", alpha: null, ink: "--ink-cancelled", role: "label", what: "cancelled block" },

  // Solid semantic fills — already correct before this pass; here so they stay so.
  { fill: "--app-success-solid", alpha: null, ink: "--text-on-accent", role: "label", what: "success tag" },
  { fill: "--app-danger-solid", alpha: null, ink: "--text-on-accent", role: "label", what: "danger tag" },
  { fill: "--app-warn-solid", alpha: null, ink: "--text-on-accent", role: "label", what: "warn tag" },
  { fill: "--tag-flag", alpha: null, ink: "--text-on-accent", role: "label", what: "booking flag tag" },

  // Buttons.
  { fill: "--btn-default", alpha: null, ink: "--text-on-accent", role: "button", what: "mkBtn default" },
  { fill: "--btn-nav", alpha: null, ink: "--text-on-accent", role: "button", what: "nav / inactive view" },
  { fill: "--btn-tables", alpha: null, ink: "--text-on-accent", role: "button", what: "Assign tables" },
  { fill: "--btn-edit", alpha: null, ink: "--text-on-accent", role: "button", what: "Edit" },
  { fill: "--btn-today", alpha: null, ink: "--text-on-accent", role: "button", what: "Today" },
  { fill: "--btn-del", alpha: null, ink: "--text-on-accent", role: "button", what: "Delete" },
  { fill: "--btn-cancel", alpha: null, ink: "--text-on-accent", role: "button", what: "Cancel booking" },
  { fill: "--btn-clear", alpha: null, ink: "--text-on-accent", role: "button", what: "Clear" },
  { fill: "--btn-reset", alpha: null, ink: "--text-on-accent", role: "button", what: "Reset" },
  { fill: "--btn-dismiss", alpha: null, ink: "--text-on-accent", role: "button", what: "Dismiss" },
  { fill: "--btn-orange", alpha: null, ink: "--text-on-accent", role: "button", what: "walk-in / count" },

  // The --app-btn-* family. These were missed by the first pass of this file
  // because the coverage check below only knew the --btn-* prefix, and the one
  // that matters most — the INACTIVE View button, the control staff look at on
  // every screen — is --app-btn-grey, not --btn-nav. It measured 1.94:1. Two
  // names for one concept is how a fill hides from its own audit.
  { fill: "--app-btn-grey", alpha: null, ink: "--text-on-accent", role: "button", what: "inactive View / secondary" },
  { fill: "--app-btn-grey-strong", alpha: null, ink: "--text-on-accent", role: "button", what: "secondary (strong)" },
  { fill: "--app-btn-slate", alpha: null, ink: "--text-on-accent", role: "button", what: "dialog secondary" },
  { fill: "--app-btn-slate-dim", alpha: null, ink: "--text-on-accent", role: "button", what: "write-warning dismiss" },

  // The two PRIMARY header buttons. Named --app-* rather than --btn-*, which is
  // the only reason they were not in the first draft of this list.
  { fill: "--app-new", alpha: null, ink: "--text-on-accent", role: "button", what: "+ New" },
  { fill: "--app-walkin", alpha: null, ink: "--text-on-accent", role: "button", what: "Walk-in" },
];

const NEED = { label: 4.5, button: 3 };

function measure(entry, theme) {
  const vars = theme === "light" ? LIGHT_VARS : DARK_VARS;
  const rawFill = vars[entry.fill];
  const rawInk = vars[entry.ink];
  expect(rawFill, entry.fill + " missing in " + theme).toBeTruthy();
  expect(rawInk, entry.ink + " missing in " + theme).toBeTruthy();
  const fill = parse(rawFill);
  if (entry.alpha != null) fill.a = entry.alpha;
  const surface = over(fill, BASE[theme]);
  const ink = over(parse(rawInk), surface);
  return +ratio(ink, surface).toFixed(2);
}

describe("fill/ink contrast — every text-bearing fill, both themes", () => {
  for (const entry of FILLS) {
    for (const theme of ["light", "dark"]) {
      it(`${entry.what} (${entry.fill}) is legible in ${theme}`, () => {
        const got = measure(entry, theme);
        const need = NEED[entry.role];
        expect(
          got,
          `${entry.what} in ${theme}: ${got}:1, needs ${need}:1 (${entry.role})`
        ).toBeGreaterThanOrEqual(need);
      });
    }
  }
});

describe("registry coverage", () => {
  // The guard for the NEXT fill, not this batch. The failure mode was never a
  // wrong number someone typed — it was a token added to :root, assumed to work
  // in both themes, and never measured. So a new text-bearing fill must be
  // registered above before it can ship; the check above then measures it.
  //
  // Same philosophy as scripts/check-style-invariants.mjs: an exemption is
  // visible at the site (here, an entry in DECORATIVE with a reason) rather
  // than in a paragraph someone has to remember to read.
  const DECORATIVE = {
    // Fills that never sit under text. Each is a wash, a rail, or a rim.
    "--btn-nav-quiet": "date-arrow rail, glyph is --text-primary not white",
  };
  const registered = new Set(FILLS.map((f) => f.fill));

  it("every --block-* / --btn-* / --tbl-*-rgb token is registered or declared decorative", () => {
    const candidates = Object.keys(LIGHT_VARS).filter((k) =>
      /^--(block-|btn-|app-btn-|app-new|app-walkin|tbl-.*-rgb)/.test(k)
    );
    const missing = candidates.filter((k) => !registered.has(k) && !(k in DECORATIVE));
    expect(
      missing,
      "unregistered text-bearing fill(s): " + missing.join(", ") +
      " — add them to FILLS so their contrast is measured, or to DECORATIVE with a reason"
    ).toEqual([]);
  });

  it("every ink token a fill names actually exists in both themes", () => {
    const bad = [];
    for (const e of FILLS) {
      if (!LIGHT_VARS[e.ink]) bad.push(e.ink + " (light)");
      if (!DARK_VARS[e.ink]) bad.push(e.ink + " (dark)");
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});
