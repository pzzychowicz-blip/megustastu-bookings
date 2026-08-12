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

  // Timeline blocks. Each fill names its OWN ink via BLOCK_INK, and all five
  // currently take white.
  //
  // Three of them are held to the label bar. The AMBER PAIR is a recorded
  // exemption (`role: "exempt"`), not an oversight — see below.
  { fill: "--block-confirmed", alpha: null, ink: "--ink-confirmed", role: "exempt", what: "confirmed block" },
  { fill: "--block-pending", alpha: null, ink: "--ink-pending", role: "exempt", what: "pending block" },
  { fill: "--block-completed", alpha: null, ink: "--ink-completed", role: "exempt", what: "completed block" },
  { fill: "--block-seated", alpha: null, ink: "--ink-seated", role: "label", what: "seated block" },
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

  // The timeline's own pills — a THIRD naming family, and the third time this
  // file has been caught by one. --tl-hour-pill in particular became
  // load-bearing in the same version this file shipped: the amber blocks are a
  // recorded exemption precisely BECAUSE the start time moved onto this pill,
  // so the exemption's whole justification was resting on a fill nothing
  // measured. It passes (4.73 light / 6.87 dark) — but it passed by luck, and
  // --tl-now-pill, sitting eight lines from it in index.html, did not.
  { fill: "--tl-hour-pill", alpha: null, ink: "--text-on-accent", role: "label", what: "timeline hour pill / block start time" },
  { fill: "--tl-now-pill", alpha: null, ink: "--text-on-accent", role: "label", what: "timeline now-time pill" },
  { fill: "--tl-blocked-badge", alpha: null, ink: "--text-on-accent", role: "label", what: "blocked table badge" },
];

const NEED = { label: 4.5, button: 3 };

// ── The recorded exemption ───────────────────────────────────────────────────
// `exempt` fills are measured and REPORTED but not asserted against a bar. Both
// options for the amber pair were tried on the running app and Patryk chose the
// third thing — neither.
//
//   Darken the fills so white text clears AA: destroys the matched-intensity
//   confirmed/pending pair v17.0.0 engineered. One goes brown, the other olive,
//   and the yellow that distinguishes them at a glance is gone.
//   Keep the fills and switch to dark ink: shipped for exactly one commit and
//   read as DISABLED next to the white-inked seated and cancelled blocks beside
//   it, so a status change looked like a state change.
//
// So the fills and the white ink both stay, at 2.9:1 and 1.8:1. What makes that
// defensible is that a block's meaning is carried by its colour, its position
// on the time axis and its width — the name on it is a label, not the
// information — and the one part that IS information, the start time, was moved
// onto its own opaque --tl-hour-pill chip so it is unaffected by the fill.
//
// This is a judgement about this restaurant's timeline, not a general licence.
// It lives in the registry so it is visible at the site, the number is printed
// on every run, and a REGRESSION still fails: an exempt fill that gets worse
// than its recorded floor breaks the build.
const EXEMPT_FLOOR = { "--block-confirmed": 2.8, "--block-pending": 1.75, "--block-completed": 2.1 };

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

// ── v17.9.0: the hour pill measured where it ACTUALLY SITS ───────────────────
// The FILLS entry above measures --tl-hour-pill over the page background, and
// reported 4.73 light / 6.87 dark. That is the RULER's pill. The block start-time
// chip is the same token in a different place — composited over a saturated
// BLOCK, and until v17.9.0 also at `opacity: 0.8`. Measured as it renders, it
// was 3.72–4.62:1 across the ten status×theme cases: below AA, on all ten, while
// this file reported the token as passing.
//
// That is the v17.8.0 lesson recurring one level down. The comment above says
// the amber exemption's "whole justification was resting on a fill nothing
// measured" — and the fix measured the fill but not the COMPOSITE the argument
// actually depends on. A token's number is not the screen's number wherever the
// token is reused over something else.
//
// v17.9.0 dropped the 0.8 (the hierarchy is carried by FW.medium instead).
//
// The opacity is read back OUT OF TimelineView.jsx rather than assumed, because
// the first version of this test asserted "if the opacity comes back, this
// fails" and that was not true: the opacity lives in JSX and this file only ever
// read index.html, so re-adding it would have left all ten cases green. A guard
// that names the thing it is guarding and then does not look at it is the same
// defect as the v17.8.0 marker check. Now the number the test uses is the number
// the component renders.
const BLOCK_FILLS = ["--block-confirmed", "--block-pending", "--block-seated",
                     "--block-completed", "--block-cancelled"];

const TIMELINE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "TimelineView.jsx"),
  "utf8"
);

// The BLOCK chip's own opacity, as authored.
//
// /code-review fix: this used to scan every `...HOUR_PILL` spread in the file
// and take the minimum. There are THREE — TimelineBlock's chip, WaitGhost's
// chip, and the ruler's headerLabels — and only the first is what these ten
// cases measure. So dimming the ruler's pills, a change with nothing to do with
// blocks, would have failed all ten with a message insisting the BLOCK chip is
// below AA and sending the next reader to the wrong element. It failed safe
// (strictest wins) and it failed misleadingly, which is the defect the comment
// above warns about wearing a different hat: a guard that names one thing and
// looks at another.
//
// Anchored on `const timeChip` — TimelineBlock's declaration, and the only one
// of the three that is a named binding — so the scan cannot wander. If that
// declaration is ever renamed the test throws here rather than silently
// measuring nothing, which is the failure mode to prefer.
function chipOpacity() {
  const lines = TIMELINE_SRC.split("\n");
  const start = lines.findIndex((l) => /const\s+timeChip\s*=/.test(l));
  if (start < 0) {
    throw new Error(
      "contrast.test: could not find `const timeChip` in TimelineView.jsx. " +
      "The block start-time chip was renamed or moved — re-anchor chipOpacity() " +
      "on it rather than deleting this guard."
    );
  }
  const pill = lines.findIndex((l, i) => i >= start && /\.\.\.HOUR_PILL/.test(l));
  if (pill < 0 || pill > start + 60) {
    throw new Error("contrast.test: no ...HOUR_PILL spread inside the timeChip declaration.");
  }
  let worst = 1;
  for (let k = pill; k < Math.min(pill + 4, lines.length); k++) {
    const m = lines[k].match(/opacity:\s*([\d.]+)/);
    if (m) worst = Math.min(worst, parseFloat(m[1]));
    if (/\}\}/.test(lines[k]) && k > pill) break;
  }
  return worst;
}

describe("timeline start-time chip — the hour pill over each block, as rendered", () => {
  for (const theme of ["light", "dark"]) {
    for (const blockTok of BLOCK_FILLS) {
      it(`${blockTok} start-time chip is legible in ${theme}`, () => {
        const vars = theme === "light" ? LIGHT_VARS : DARK_VARS;
        const block = over(parse(vars[blockTok]), BASE[theme]);
        const a = chipOpacity();
        // element opacity composites the ALREADY-COMPOSED chip (fill + its ink)
        // back over the block, so fill and label fade together.
        const chipFull = over(parse(vars["--tl-hour-pill"]), block);
        const chip = over({ ...chipFull, a }, block);
        const inkFull = over(parse(vars["--text-on-accent"]), chipFull);
        const ink = over({ ...inkFull, a }, block);
        const got = +ratio(ink, chip).toFixed(2);
        expect(
          got,
          `start-time chip on ${blockTok} in ${theme}: ${got}:1, needs 4.5:1. ` +
          `This is the one piece of INFORMATION a block carries, and the amber ` +
          `exemption is recorded on the grounds that it stays legible.`
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("fill/ink contrast — every text-bearing fill, both themes", () => {
  for (const entry of FILLS) {
    for (const theme of ["light", "dark"]) {
      it(`${entry.what} (${entry.fill}) is legible in ${theme}`, () => {
        const got = measure(entry, theme);
        if (entry.role === "exempt") {
          // Not asserted against the bar — asserted against ITSELF, so the
          // exemption cannot quietly rot into something worse.
          const floor = EXEMPT_FLOOR[entry.fill];
          expect(
            got,
            `${entry.what} in ${theme} is a recorded exemption at ${got}:1, but it ` +
            `has dropped below its floor of ${floor}:1 — an accepted contrast is ` +
            `not a licence to keep going`
          ).toBeGreaterThanOrEqual(floor);
          return;
        }
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
    "--tl-blocked-badge-border": "rim of the blocked badge, not its fill",
  };
  const registered = new Set(FILLS.map((f) => f.fill));

  it("every --block-* / --btn-* / --tbl-*-rgb / timeline pill+badge token is registered or declared decorative", () => {
    // The `--tl-.*(pill|badge)` clause is the v17.8.0 review fix. The rest of
    // the --tl-* family is gridlines, rails, scrims and borders, so matching
    // the whole prefix would mean fifteen DECORATIVE entries of noise; the
    // shape that actually carries text on this view is a pill or a badge, and
    // that is what the next one will be called too.
    const candidates = Object.keys(LIGHT_VARS).filter((k) =>
      /^--(block-|btn-|app-btn-|app-new|app-walkin|tbl-.*-rgb|tl-.*(pill|badge))/.test(k)
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

// ── The party-size ring — a NON-TEXT boundary (v17.9.1) ──────────────────────
// Everything above measures a fill against the INK painted on it. This measures
// a 1px white ring against the fill it is drawn on, which is a different shape:
// WCAG 1.4.11 asks 3:1 of a component boundary, and there is no ink involved.
// That is why it is a separate block rather than one more row in FILLS — the
// registry's `measure()` takes a fill/ink pair and there is no ink here.
//
// It exists because `SIZE_RING`'s border alpha was documented and unmeasured.
// The comment on it in `TimelineView.jsx` records why 0.55 and not
// `--blk-rule`'s 0.3 (at 0.3 the ring does not render at all on the amber
// fills), and records that 3:1 is unreachable on those two fills — pure white
// over the pending yellow tops out below 2:1. All true, and none of it stopped
// anyone from setting the alpha back to 0.3: every test passed.
//
// The house rule is that **an accepted contrast is not a licence to keep
// going**, which is exactly what the amber fill/ink exemption above is asserted
// against. This is that same treatment applied one element down: not asserted
// against the 3:1 bar it cannot meet, asserted against ITSELF, so it cannot rot.
//
// Floors are the values measured at the shipped 0.55, per theme. At 0.3 every
// one of the ten drops below its floor, which is the regression this catches.
const RING_FLOOR = {
  light: {
    "--block-confirmed": 1.83, "--block-pending": 1.39, "--block-seated": 2.48,
    "--block-completed": 1.58, "--block-cancelled": 2.48
  },
  dark: {
    "--block-confirmed": 2.09, "--block-pending": 1.55, "--block-seated": 2.46,
    "--block-completed": 2.74, "--block-cancelled": 2.86
  }
};

// Read the alpha back OUT of the component, for the reason chipOpacity() does:
// a guard that names the thing it is guarding and then uses a number typed into
// the test is not guarding it. Anchored on `const SIZE_RING`, and it THROWS if
// that declaration is gone rather than silently measuring a default.
function ringAlpha() {
  const lines = TIMELINE_SRC.split("\n");
  const start = lines.findIndex((l) => /const\s+SIZE_RING\s*=/.test(l));
  if (start < 0) {
    throw new Error(
      "contrast.test: could not find `const SIZE_RING` in TimelineView.jsx. " +
      "The party-size ring was renamed or moved — re-anchor ringAlpha() on it " +
      "rather than deleting this guard."
    );
  }
  for (let k = start; k < Math.min(start + 12, lines.length); k++) {
    const m = lines[k].match(/border:\s*"[^"]*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/);
    if (m) return parseFloat(m[1]);
    if (/^\};/.test(lines[k]) && k > start) break;
  }
  throw new Error(
    "contrast.test: no white rgba border found inside the SIZE_RING declaration. " +
    "If the ring stopped being a white rule, this guard needs rewriting, not removing."
  );
}

describe("party-size ring — the boundary over each block, as rendered", () => {
  for (const theme of ["light", "dark"]) {
    for (const blockTok of BLOCK_FILLS) {
      it(`${blockTok} size ring is visible in ${theme}`, () => {
        const vars = theme === "light" ? LIGHT_VARS : DARK_VARS;
        const block = over(parse(vars[blockTok]), BASE[theme]);
        const ring = over({ r: 255, g: 255, b: 255, a: ringAlpha() }, block);
        const got = +ratio(ring, block).toFixed(2);
        const floor = RING_FLOOR[theme][blockTok];
        expect(
          got,
          `size ring on ${blockTok} in ${theme}: ${got}:1, recorded floor ${floor}:1. ` +
          `3:1 is unreachable on the amber fills and that is a documented ` +
          `exemption — but an accepted contrast is not a licence to keep going. ` +
          `If the border alpha went back to --blk-rule's 0.3, the ring is absent ` +
          `on the yellow blocks; put it back.`
        ).toBeGreaterThanOrEqual(floor);
      });
    }
  }
});
