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

// v17.15.1: the token blocks moved out of index.html into src/index.css (the
// service worker can cache a hashed asset; it re-sent the inline block on every
// open). Same bytes, same blocks — only the file changed.
const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.css"),
  "utf8"
);

// ── Theme token extraction ───────────────────────────────────────────────────
// Both blocks are flat `--name: value;` lists. Dark inherits from light, so the
// dark map is light overlaid with the dark block — which is exactly the
// inheritance the browser performs, and the reason a light-only token was able
// to be wrong in dark for so long without anyone noticing.
function block(selector) {
  const i = HTML.indexOf(selector);
  if (i < 0) throw new Error("no " + selector + " block in src/index.css");
  const open = HTML.indexOf("{", i);
  // /code-review: brace-counted, not sentinel-matched. This used to look for
  // the block's closing brace by its INDENTATION ("\n      }" when the rules
  // lived inside index.html's <style>), which the v17.15.1 move turned into a
  // column-0 "\n}" — an even weaker anchor, since it stops at the first line
  // starting with a brace. Both break the moment the file is reformatted or a
  // token block is wrapped in an at-rule, and they break by SILENTLY
  // truncating the token map, so the contrast pass would then measure a
  // partial palette instead of failing. Counting depth cannot be fooled by
  // whitespace.
  let depth = 0, end = -1;
  for (let j = open; j < HTML.length; j++) {
    if (HTML[j] === "{") depth++;
    else if (HTML[j] === "}" && --depth === 0) { end = j; break; }
  }
  if (end < 0) throw new Error("unbalanced " + selector + " block in src/index.css");
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

  // v17.15.0: the SOFT semantic pane and the ink on it — the notification
  // strip's danger sections and the modal InlineAlert that copies their shape.
  // Registered because the pairing was WRONG when it was measured: the tone was
  // --status-offline, which is #ff3b30 in both themes while --danger-bg inverts,
  // giving 3.03:1 in light against 4.31:1 in dark. Neither the coverage guard
  // below nor check:style could see it — the guard's prefixes do not match
  // `--danger-bg`, and a token pair is not a literal. So it is named here, and
  // whoever adds the warn or suggest pane should name theirs too.
  { fill: "--danger-bg", alpha: null, ink: "--danger-text", role: "label", what: "danger pane (strip section + InlineAlert)" },

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

  // v17.13.0 — two fills that reached this file only because the colour rule
  // in check:style forced them out of the components. Both carried white text
  // as hand-written literals, i.e. in the one form this file cannot see: it
  // enumerates TOKENS, and "an audit that enumerates tokens has a blind spot
  // exactly the size of the literals."
  { fill: "--app-btn-dark", alpha: null, ink: "--text-on-accent", role: "button", what: "timeline Follow, while following" },
  // The greyed-out primary in both form footers, ReminderEditor and ManualModal.
  //
  // v17.13.0 recorded this as an EXEMPTION: WCAG 1.4.3 exempts inactive
  // components, and white on this fill measured 1.31:1 in light — at which the
  // label is not dim, it is GONE, so a staff member who had not filled the date
  // saw an empty pill rather than a greyed-out "Save booking". It was left as a
  // design question rather than answered inside a gate-closing commit.
  //
  // **v17.14.0 answered it, and it is no longer an exemption.** The ink is
  // `--btn-disabled-ink`, which is per-theme because the FILL is :root-only and
  // composites toward whatever is behind it — so its effective colour flips WITH
  // the theme even though its declaration does not. That is why `--text-muted`
  // was the wrong answer despite being the obvious one: it inverts the same way
  // the composite does, measuring 4.59:1 light but 2.30:1 dark, which would have
  // swapped which theme was broken rather than fixing either. White was the
  // mirror image: 1.30:1 light, 6.42:1 dark.
  //
  // The light ink is a step darker than --text-muted, and the reason is a limit
  // of THIS FILE worth stating: BASE is the theme extreme, which is the worst
  // case for WHITE ink and the BEST case for dark ink. The real modal sheet is
  // translucent over a tinted app background, so the fill composites to
  // rgb(211,211,217) on screen against rgb(225,225,229) here — a dark ink
  // measures LOWER in the app than in this file. --text-muted read 4.59 here and
  // 4.02 live. The shipped pair measures 5.14 light / 4.60 dark in the running
  // app, and is a `label` entry held to 4.5 rather than an exemption.
  { fill: "--btn-disabled", alpha: null, ink: "--btn-disabled-ink", role: "label", what: "disabled primary button" },

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
//
// ── v17.10.0: --block-pending's exemption now covers MORE than a block ───────
// The waitlist chrome moved onto this fill with white ink — the ⏳ count badge in
// the date-nav row, both "Add to waitlist" buttons, and the Waitlist panel's
// title pill — because a party on the waitlist is a pending thing and this is
// the app's colour for pending things (it previously shared the burnt orange
// with No show / Reassign / Reshuffle / the swap family, which said the wrong
// thing).
//
// **The justification above does NOT stretch to cover these**, and saying so is
// the point of this note. A block's meaning is carried by its colour, position
// and width, and the one part that is information moved onto an opaque chip. On
// a button, the label IS the content: "Add to waitlist" at 1.82:1 in light /
// 2.20:1 in dark has nothing else carrying it.
//
// All three candidates were built into the running app and compared side by side
// in both themes — an outline treatment (amber border + amber text, the
// "Save pending" shape, no exemption needed), a solid fill with dark amber ink
// (3.76 light / 3.12 dark, clears the 3:1 button bar), and this one. Patryk
// chose this one, informed, after seeing the numbers and the pixels. It is
// recorded here rather than argued away: the floors below still gate a
// regression, and an accepted contrast is not a licence to keep going.
// A number may be a scalar (both themes) or a {light, dark} pair. The per-theme
// form arrived for --btn-disabled, whose two themes were 5x apart so a single
// floor could not have seen a dark-mode regression at all; that entry is no
// longer an exemption (v17.14.0), but the pair form stays, because the next fill
// whose themes diverge should not have to rediscover why one number is not
// enough.
const EXEMPT_FLOOR = { "--block-confirmed": 2.8, "--block-pending": 1.75, "--block-completed": 2.1 };
const exemptFloor = (fill, theme) => {
  const f = EXEMPT_FLOOR[fill];
  return typeof f === "number" ? f : f[theme];
};

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
          const floor = exemptFloor(entry.fill, theme);
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
  // v17.14.0: tokens matching the fill prefixes that are INK, not fill. Listing
  // one here is not an exemption — the assertion below requires it to be some
  // registered fill's `ink`, so it is measured, just from the other side.
  //
  // The alternative was to name it outside the `--btn-` prefix so the sweep
  // would not see it, which is precisely how `--app-btn-grey` once hid from a
  // check written around `--btn-*`. A token should not be renamed to escape an
  // audit.
  const INKS = {
    "--btn-disabled-ink": "the ink ON --btn-disabled, per-theme (see its FILLS entry)",
  };
  const registered = new Set(FILLS.map((f) => f.fill));
  const usedAsInk = new Set(FILLS.map((f) => f.ink));

  it("every --block-* / --btn-* / --tbl-*-rgb / timeline pill+badge token is registered or declared decorative", () => {
    // The `--tl-.*(pill|badge)` clause is the v17.8.0 review fix. The rest of
    // the --tl-* family is gridlines, rails, scrims and borders, so matching
    // the whole prefix would mean fifteen DECORATIVE entries of noise; the
    // shape that actually carries text on this view is a pill or a badge, and
    // that is what the next one will be called too.
    const candidates = Object.keys(LIGHT_VARS).filter((k) =>
      /^--(block-|btn-|app-btn-|app-new|app-walkin|tbl-.*-rgb|tl-.*(pill|badge))/.test(k)
    );
    const missing = candidates.filter((k) => !registered.has(k) && !(k in DECORATIVE) && !(k in INKS));
    expect(
      missing,
      "unregistered text-bearing fill(s): " + missing.join(", ") +
      " — add them to FILLS so their contrast is measured, to INKS if the token is" +
      " ink rather than fill, or to DECORATIVE with a reason"
    ).toEqual([]);
  });

  it("every token declared an INK is actually used as one", () => {
    // INKS is not a hiding place: a token listed there must appear as some
    // registered fill's `ink`, so it is measured from the other side. Without
    // this, "it is an ink" would be a sentence anyone could write to silence
    // the sweep above.
    const unused = Object.keys(INKS).filter((k) => !usedAsInk.has(k));
    expect(
      unused,
      "declared INK but never used as one: " + unused.join(", ")
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
    // v17.13.0: the ring's rim became `--rim-solid-strong` when the 26 copies of
    // its 0.2 sibling were tokenised, so this resolves the token out of
    // index.html rather than reading a number out of the component. That is
    // strictly what this guard was already trying to be — the number the test
    // uses is the number the app renders — and it now catches a retune of the
    // TOKEN as well as a retune of the call site. A raw rgba is still accepted,
    // because reverting to one must not silently disable the guard.
    const tok = lines[k].match(/border:\s*"[^"]*var\((--[a-z0-9-]+)\)/);
    if (tok) {
      const raw = LIGHT_VARS[tok[1]];
      if (!raw) {
        throw new Error(
          "contrast.test: SIZE_RING's border names " + tok[1] +
          ", which is not declared in index.html's :root."
        );
      }
      // /code-review: the rgba branch below matches `rgba(255,255,255,…)`
      // explicitly, so a ring that stopped being WHITE threw. The token branch
      // returned only the alpha and let the caller composite a hard-coded white,
      // which silently accepts any colour — the guard would then report a white
      // ring that is not on screen. This function's own throw message promises
      // otherwise ("If the ring stopped being a white rule, this guard needs
      // rewriting, not removing"), so the token has to prove it is white too.
      const c = parse(raw);
      if (c.r !== 255 || c.g !== 255 || c.b !== 255) {
        throw new Error(
          "contrast.test: SIZE_RING's border resolves to " + raw + " via " + tok[1] +
          ", which is not white. The ring stopped being a white rule — this guard " +
          "needs rewriting (it composites pure white), not removing."
        );
      }
      return c.a;
    }
    const m = lines[k].match(/border:\s*"[^"]*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/);
    if (m) return parseFloat(m[1]);
    if (/^\};/.test(lines[k]) && k > start) break;
  }
  throw new Error(
    "contrast.test: no white rule found inside the SIZE_RING declaration. " +
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

// ── The double-booked band's casing — the other NON-TEXT boundary (v17.11.0) ──
// Found by /code-review, and it is the SIZE_RING lesson recurring one element
// along: a marker was given a single opaque colour, documented as sitting
// somewhere "where nothing competes with it", and never measured against what
// it actually paints on. It paints on BLOCK_BG. Measured, the red core is
// 1.02–1.63:1 across the four statuses in both themes — invisible on a seated
// block — and this bar is the one part of the double-booking treatment carrying
// information the block border cannot (it runs from the later booking's start
// to the EARLIER one's end, so its right edge is the minute the hidden booking
// really finishes).
//
// Unlike SIZE_RING this is NOT an exemption: a near-black casing clears 3:1
// everywhere, so the bar is asserted against the real bar. The red keeps the
// meaning; the casing carries the boundary.
//
// It needs its own block for two reasons. `measure()` takes a fill/ink pair and
// there is no ink here — the same reason the size ring has one. And the
// registry's coverage guard matches `--tl-.*(pill|badge)`, so it cannot see a
// `--tl-clash-*` token at all: this family is exactly the blind spot that guard
// documents itself as having, which is why the band shipped unmeasured.
describe("double-booked band — the casing over each block, as rendered", () => {
  for (const theme of ["light", "dark"]) {
    for (const blockTok of BLOCK_FILLS) {
      it(`${blockTok} clash-band casing is visible in ${theme}`, () => {
        const vars = theme === "light" ? LIGHT_VARS : DARK_VARS;
        const block = over(parse(vars[blockTok]), BASE[theme]);
        const edge = over(parse(vars["--tl-clash-edge"]), block);
        const got = +ratio(edge, block).toFixed(2);
        expect(
          got,
          `clash-band casing on ${blockTok} in ${theme}: ${got}:1, needs 3:1 ` +
          `(WCAG 1.4.11, non-text boundary). The band's own red is 1.02–1.63:1 ` +
          `on these fills — if the casing is dropped, the one marker that says ` +
          `WHERE the two bookings collide becomes invisible on a seated block.`
        ).toBeGreaterThanOrEqual(3);
      });
    }
  }

  // The core is not asserted against 3:1 — it cannot meet it and does not need
  // to, because the casing is the boundary. It IS asserted to still be a
  // distinguishable red, so "simplifying" the pair down to one flat neutral
  // (which would pass the casing test on its own) does not go unnoticed.
  it("the band core is still a red, distinct from its casing", () => {
    for (const theme of ["light", "dark"]) {
      const vars = theme === "light" ? LIGHT_VARS : DARK_VARS;
      const core = parse(vars["--tl-clash-a"]);
      const edge = parse(vars["--tl-clash-edge"]);
      expect(core.r, `clash core in ${theme} is not red-dominant`).toBeGreaterThan(core.g + 60);
      expect(core.r, `clash core in ${theme} is not red-dominant`).toBeGreaterThan(core.b + 60);
      expect(+ratio(core, edge).toFixed(2), `core vs casing in ${theme}`).toBeGreaterThanOrEqual(2);
    }
  });
});

// ── The waitlist ghost — a DIMMED copy of the worst fill in the app (v17.13.0)
//
// This is the gap the file above declares it has, and the design-system pass
// went and measured it: the ghost's guest name renders at **1.50:1**, the
// lowest text contrast in the application, on a fill (`--block-pending`) that
// is ALREADY this registry's worst recorded exemption at 1.82:1.
//
// It arrived through the same door as the v17.9.0 hour-pill defect, one level
// further along. `chipOpacity()` above is anchored on `const timeChip` — a
// deliberate /code-review fix, and correct for what it set out to do — and its
// own comment names the three `...HOUR_PILL` spreads and says only the first is
// measured. `WaitGhost` is the second. So the component that dims an exempt
// fill by a further 45% was, by construction, outside everything this file
// looks at. **A token's number is not the screen's number wherever that token
// is reused over something else** — and an element-level `opacity` is exactly
// such a reuse, invisible to a registry that reads `index.html`.
//
// Asserted against ITSELF, like SIZE_RING and unlike the clash band: a 0.55
// dimming cannot reach 4.5:1 over any fill this app owns, so a 4.5 bar here
// would be a permanently red test, which is a muted test. The floors are the
// values measured at the shipped opacities. What they buy is that the dimming
// cannot deepen, and that raising it shows up as a number rather than a
// feeling.
//
// **The 1.50 is recorded, not endorsed.** The amber exemption's justification —
// a block's meaning is carried by colour, position and width, and the one part
// that is INFORMATION moved onto an opaque chip — does not reach here: the
// chip is inside the ghost and dims with it, so on a ghost every element is
// below the bar at once. See ROADMAP.md.
//
// Both opacities are read out of the component for `chipOpacity()`'s reason: a
// guard that names the thing it guards and then uses a number typed into the
// test is not guarding it.
function ghostOpacity() {
  const lines = TIMELINE_SRC.split("\n");
  const start = lines.findIndex((l) => /function\s+WaitGhost\s*\(/.test(l));
  if (start < 0) {
    throw new Error(
      "contrast.test: could not find `function WaitGhost` in TimelineView.jsx. " +
      "The waitlist ghost was renamed or moved — re-anchor ghostOpacity() on it " +
      "rather than deleting this guard."
    );
  }
  for (let k = start; k < lines.length; k++) {
    // `opacity: g.resh ? 0.4 : 0.55` — the reshuffle-only match is turned down
    // further because it can sit over a table that is visibly occupied now.
    const m = lines[k].match(/opacity:\s*g\.resh\s*\?\s*([\d.]+)\s*:\s*([\d.]+)/);
    if (m) return { resh: parseFloat(m[1]), plain: parseFloat(m[2]) };
    if (/^}/.test(lines[k]) && k > start) break;
  }
  throw new Error(
    "contrast.test: no `opacity: g.resh ? … : …` inside WaitGhost. If the ghost " +
    "stopped being drawn by element opacity, this guard needs rewriting, not removing."
  );
}

// Measured at the shipped 0.55 / 0.4. Everything on a ghost is dimmed together,
// so all three are below the bar at once — which is the finding, not a rounding.
//
// The review measured the light guest name at 1.50:1 from the live DOM and this
// file computes 1.39. Both are right and the gap is the BASE: this registry
// takes the extreme of each theme (pure white / the darkest sheet) as the worst
// case for washout, while the timeline row has its own faint tint under the
// ghost. Recording the stricter of the two is the point of choosing an extreme.
const GHOST_FLOOR = {
  light: { plain: { name: 1.39, chip: 2.22, ring: 1.2 }, resh: { name: 1.27, chip: 1.74, ring: 1.14 } },
  dark:  { plain: { name: 1.82, chip: 3.12, ring: 1.39 }, resh: { name: 1.63, chip: 2.41, ring: 1.3 } },
};

describe("waitlist ghost — the dimmed block, as rendered", () => {
  for (const theme of ["light", "dark"]) {
    for (const kind of ["plain", "resh"]) {
      it(`${kind} ghost stays at or above its recorded floors in ${theme}`, () => {
        const vars = theme === "light" ? LIGHT_VARS : DARK_VARS;
        const a = ghostOpacity()[kind];
        const base = BASE[theme];
        // Element opacity composites the already-painted element back over the
        // page, so fill, chip and ink all fade together — the same shape as the
        // start-time-chip block above, with the block itself as the thing faded.
        const fillFull = over(parse(vars["--block-pending"]), base);
        const fill = over({ ...fillFull, a }, base);

        const nameFull = over(parse(vars["--ink-pending"]), fillFull);
        const name = over({ ...nameFull, a }, base);

        const chipFull = over(parse(vars["--tl-hour-pill"]), fillFull);
        const chip = over({ ...chipFull, a }, base);
        const chipInkFull = over(parse(vars["--text-on-accent"]), chipFull);
        const chipInk = over({ ...chipInkFull, a }, base);

        const ringFull = over({ r: 255, g: 255, b: 255, a: ringAlpha() }, fillFull);
        const ring = over({ ...ringFull, a }, base);

        const got = {
          name: +ratio(name, fill).toFixed(2),
          chip: +ratio(chipInk, chip).toFixed(2),
          ring: +ratio(ring, fill).toFixed(2),
        };
        const floor = GHOST_FLOOR[theme][kind];
        for (const part of ["name", "chip", "ring"]) {
          expect(
            got[part],
            `waitlist ghost ${part} (${kind}, ${theme}): ${got[part]}:1, recorded ` +
            `floor ${floor[part]}:1. These are BELOW the bar by design of the ` +
            `dimming and are asserted against themselves so they cannot get ` +
            `worse — an accepted contrast is not a licence to keep going. If the ` +
            `opacity was turned down further, the guest name on a proposal is no ` +
            `longer readable at all.`
          ).toBeGreaterThanOrEqual(floor[part]);
        }
      });
    }
  }
});
