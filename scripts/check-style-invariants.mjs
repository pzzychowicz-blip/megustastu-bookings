#!/usr/bin/env node
// scripts/check-style-invariants.mjs
//
// v17.8.0 — two of CLAUDE.md's style rules, enforced instead of described.
//
// Both rules were written after real bugs, and both were prose-only, which
// means the check was "someone remembers". CLAUDE.md listed the legitimate
// exceptions for each in a paragraph, so telling a deliberate exemption from a
// mistake meant opening every site and reasoning about it — I did exactly that
// during the v17.8.0 debt pass, across 39 sites, and it is not repeatable.
//
// ── Rule 1: no `borderRadius: <number>` ──────────────────────────────────────
// Radii come from the `R` scale, by ROLE. The exceptions are genuine — canvas
// geometry (timeline blocks, TimeAxis ticks, floor-plan glyphs), progress
// track/fill pairs whose two radii must stay equal, and the Kbd keycap — but an
// exception should be visible AT THE SITE, not in a document. Mark it:
//
//     borderRadius: 10,   /* @canvas */
//
// ── Rule 2: no WHITE-INSET shadow over a theme-flipping fill ─────────────────
// This is the one that shipped a bug. `--shadow-btn` carries
// `inset 0 1px 1px rgba(255,255,255,0.6)` in light and drops it to 0.05 in
// dark; a hard-coded white inset therefore ships the light-mode highlight into
// dark mode 3–8× too bright. v17.8.0 converted 24 such sites.
//
// The 22 that remain are all correct, because each sits on a SATURATED SOLID
// fill that is deliberately theme-invariant (BLOCK_BG, --app-*-solid, BTN.*, a
// literal rgba) — the same reasoning that exempts those blocks from the radius
// rule. So the check is not "no white insets"; it is "not over a fill that
// flips", which is the actual invariant and the one a future edit can violate.
//
// The heuristic: find the nearest `background`/`backgroundColor` above the
// shadow. Flag it if that fill is a THEME token (--bg-*, --warn-bg, …). Where
// the fill is genuinely not visible to a line-scanner, mark it:
//
//     boxShadow: "… inset 0 1px 1px rgba(255,255,255,0.15)",  /* @fixed-fill */
//
// ── Rule 6: no bare drop-shadow literal ─────────────────────────────────────
// v17.10.1. The v17.8.0 note here said plain dark drop-shadows were "a
// consistency nit, not a bug class", and that a rule for them would be noisy.
// The first half turned out to be wrong and the second half is no longer true.
//
// Wrong, because the literals were not one value repeated — they were THREE
// spellings of "raised control on a theme-invariant fill" (0 2px 6px/0.12,
// 0 1px 4px/0.1, 0 1px 3px/0.15), and none of them deepened for dark mode the
// way every --shadow-* token does. That is a bug class: a black shadow cannot
// invert out from under itself, but it can be invisible on the wrong ground.
// No longer noisy, because v17.10.1 tokenised all 20 remaining sites, so this
// guards the NEXT one rather than nagging about a backlog.
//
// Two things it must get right, and both come from how earlier sweeps MISSED
// sites. It matches the VALUE's shape anywhere on the line, not `boxShadow:` —
// v17.10.0's sweep grepped the property name and walked past `StatusToasts`'
// literal because it sat behind a `const`. And it requires a NON-ZERO blur,
// because `0 0 0 3px …` is a ring or a focus glow, not a drop shadow — the
// connection dot and the selection rings are not members of this scale.
//
//     boxShadow: "0 10px 24px rgba(0,0,0,0.3)",   /* @shadow */
//
// marks a genuine one-off (a block lifted under a finger; the Kbd keycap).

// ── Rule 7: no bare COLOUR literal ──────────────────────────────────────────
// v17.13.0, and it is the last unguarded axis. Six rules covered radius, type,
// spacing, height, white insets and drop shadows; none of them looked at a
// colour, in a codebase whose recorded history is a series of colour-literal
// defects — the Follow button's hard-coded copy of --app-btn-grey, the
// ReminderEditor buttons at 1.70:1, the four fills that carried white text and
// were invisible to tests/contrast.test.js because that file enumerates TOKENS.
// The file's most-repeated sentence is "grep the VALUE, not the name", and the
// gate encoded every lesson from that family except this one.
//
// v17.13.0 (1/n) cleared the debt: 26 copies of one rim value became
// --rim-solid, two text-bearing fills became tokens and are now measured, and
// one hard-coded white wash under an INVERTING ink was a live 1.70:1 defect in
// dark mode. What remains is deliberate, and each site says so:
//
//     background: "rgba(254,249,195,0.8)", color: KTXT_TIGHT,  /* @fixed-fill */
//
// ── The marker is @fixed-fill, shared with Rule 2, on purpose ───────────────
// Rule 2 asks "is the surface under this white inset theme-invariant". Rule 7
// asks "is the surface under this colour theme-invariant". That is the same
// question about the same line, and inventing a second word for it is precisely
// how "two names for one concept" let --app-btn-grey hide from a check written
// around the --btn-* prefix. The coupling is real and worth knowing: a marker
// added for a colour also blesses a white inset on that same line. It is
// coherent — both claims are the one claim — but read the whole line before
// marking it.
//
// @shadow exempts too, because a drop-shadow literal blessed as a one-off is
// necessarily a colour literal as well, and making the author write both
// markers would teach nothing.
//
// ── Two things it must NOT see ─────────────────────────────────────────────
// COMMENTS. Half of this repo's colour "literals" are prose ABOUT literals —
// the SIZE_RING note, the v17.8.0 lessons, the `rgba(0,0,0,0)` a class was
// measured at. A per-line startsWith("//") test is not enough: a JSX block
// comment's continuation lines start with ordinary words. So the file is
// scanned once, tracking block-comment and string state, and each line is
// judged on its CODE only.
//
// DEVTOOLS `%c` STYLING. firebase.js's DEV/PROD badge and App.jsx's boot banner
// are CSS declaration LISTS handed to console.log — not app UI, not themed, and
// not a surface at all. Rule 4 already faced this exact site and its comment
// says why marking it would be the wrong fix: "the rule would keep mis-firing
// on the next piece of console styling anyone writes." So the test is
// structural — a quoted `prop: value;` list, which a JSX style VALUE never is,
// because inline style values hold no semicolons.

// ── Rules 8 & 9: the icon scale and the motion scale ────────────────────────
// v17.13.0. CLAUDE.md states both as rules — "No new numeric `size={n}` on an
// icon", and `grep -rn "ms ease\|ms linear\|cubic-bezier" src/` must come back
// empty apart from M's own WAAPI values — and neither was enforced by anything.
//
// They are added here precisely BECAUSE compliance is already 100%: 0 numeric
// icon sizes at 31 icon exports' call sites, and every motion match in `src/`
// inside a comment save one. A rule adopted at 100% costs nothing and guards
// the next edit; a rule adopted against a backlog gets muted. That asymmetry is
// why these two waited for a version with no debt to clear rather than shipping
// alongside the axes that had some.
//
// Rule 8 is JSX-attribute and destructured-default position only — `size={14}`
// and `{ size = 20 }`. NOT `size: <number>` in an object, which in this app is
// overwhelmingly a PARTY size (`EMPTY_FORM`, every booking, every waitlist
// entry). A rule that fires on a booking's guest count would be muted within a
// day, and it would be right to mute it.
//
// Rule 9 flags a `cubic-bezier(` or a CSS time followed by an easing keyword.
// `M.resize`'s `"var(--t-shift) linear"` is deliberately NOT caught: it is a
// token composition, and the thing this guards is a hand-written duration/curve
// pair. The one genuine escape hatch — `M.easeOut`, which useFlip needs as a
// literal because WAAPI cannot read a CSS var — is marked:
//
//     easeOut:"cubic-bezier(0.33, 1, 0.68, 1)"   /* @motion */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { stripComments } from "./strip-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// An explicit directory argument exists so the checker can be pointed at a
// fixture (tests/style-check.test.js). That test is not ceremony: the first
// version of the spacing rule required the property to be preceded by `{` or
// `,`, which silently skipped every key in a MULTI-LINE style object — i.e.
// most of the codebase — while still printing "OK". A checker that has gone
// blind is worse than no checker, because it also carries the authority of
// having passed. Same lesson as the v17.8.0 marker-placement bug.
const SRC = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "src");
const LOOKBACK = 10;   // lines to search upward for the governing fill

// A CSS shadow value: <x> <y> <blur> <colour>, where x/y are `0` or `Npx`. The
// blur must be NON-ZERO — `0 0 0 3px` is a ring, not a drop shadow. A leading
// `inset` is matched too (a groove is still a shadow literal). Requiring the
// colour to follow is what keeps this off `padding`, `transform` and friends.
//
// The leading alternation is load-bearing and was found by running the rule
// against a fixture rather than by reading it: without it the pattern SLIDES,
// so `0 0 0 2px rgba(...)` — a ring, and the thing the non-zero-blur condition
// exists to exclude — matched by starting at the second `0` and reading
// `0 0 2px rgba(`. A shadow value must begin at a quote, after `inset`, or
// after the comma separating it from the previous shadow in a list.
//
// /code-review: the COLOUR alternation and the decimal handling were both too
// narrow in the first version — `0 2px 6px var(--x)`, `0 2px 6px black` and
// `0 1.5px 3px rgba(…)` are all exactly the literal this rule exists to catch,
// and all three made it print OK. That is the "a checker with a blind spot
// still prints OK" failure this repo has now hit three times, so the colour is
// rgb/hsl/var/hex/bare-identifier and the lengths accept decimals. The blur is
// still required to be non-zero, now via a negative lookahead so `0px` is
// excluded as well as `0` — a ring is not a drop shadow.
const SHADOW_VALUE = /(?:["'`]|inset\s+|,\s*)(?:0|-?[\d.]+px)\s+(?:0|-?[\d.]+px)\s+(?!0(?:px)?[\s,)])[\d.]+px\s+(?:rgba?\(|hsla?\(|var\(|#[0-9a-fA-F]|[a-z]{3,})/;

// v17.9.0 — must match SP and H in src/lib/constants.js. Hand-synced: this
// script runs standalone (no bundler, no JSX transform), so it cannot import
// from src/. Same class of hand-kept pair as M.dur vs the CSS motion tokens.
const SPACING_STEPS = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 24, 32]);
const HEIGHT_STEPS = new Set([28, 32, 36, 40, 44]);

// Fills that do NOT flip with the theme: saturated solids, block colours, and
// raw colour literals. A white inset is correct over any of these.
const FIXED_FILL = [
  /rgba?\(/, /#[0-9a-fA-F]{3,8}/,
  /BLOCK_BG\b/, /\bBTN\./, /S\.accent/, /TBL\./,
  /var\(--app-[a-z-]*(solid|walkin|new|btn-[a-z-]+)\)/,
  /var\(--accent\)/, /var\(--btn-[a-z-]+\)/, /var\(--tag-flag\)/,
];
// Fills that DO flip. Anything matching here under a white inset is the bug.
const THEME_FILL = [
  /var\(--bg-[a-z-]+\)/, /var\(--(warn|danger|suggest)-bg[a-z-]*\)/,
  /var\(--border-[a-z-]+\)/, /var\(--text-[a-z-]+\)/,
];

// Read a style value: everything after `key:` up to the first TOP-LEVEL comma.
// These are one-line JSX style objects, so a naive "rest of the line" grab
// swallows every sibling property — including the `border:"1px solid
// rgba(255,255,255,0.2)"` that sits next to almost every one of these shadows,
// which made a correct site look like it had a white fill. Track quote and
// paren depth and stop where the property actually ends.
function styleValue(line, key) {
  const m = line.match(new RegExp(key + "\\s*:\\s*"));
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0, quote = null, out = "";
  for (; i < line.length; i++) {
    const c = line[i];
    if (quote) { out += c; if (c === quote && line[i - 1] !== "\\") quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
    if (c === "(" || c === "{" || c === "[") depth++;
    if (c === ")" || c === "}" || c === "]") { if (depth === 0) break; depth--; }
    if (c === "," && depth === 0) break;
    out += c;
  }
  return out.trim();
}

// ── Rule 7's two helpers ────────────────────────────────────────────────────
// An `rgb()`/`rgba()` with a NUMERIC first argument (so `rgba(var(--x), 0.8)` —
// the composed-token idiom in constants.js — is not a literal), or a `#` hex of
// 3/4/6/8 digits. The hex arm refuses a leading `&` so an HTML entity such as
// `&#8249;` is not read as a colour: the app had exactly that shape until
// v17.9.0, and an entity being invisible to a glyph grep is already one of the
// recorded lessons — this is the same fact pointed the other way.
const COLOUR_LITERAL = /\brgba?\(\s*[\d.]|(?<![&\w])#[0-9a-fA-F]{3,8}\b/;

// Rule 8: a numeric icon size, in the two positions an icon's size is WRITTEN —
// a JSX attribute, and a destructured default.
//
// /code-review: the second arm was `\bsize\s*=\s*-?\d`, which also matches a
// plain `let size = 20` or `obj.size = 4` — neither of which is an icon, and the
// header above this rule says the rule is those two positions only. Nothing in
// src/ has such a variable today, so CI was green and the false positive was
// waiting for the first `const size = 4` anyone wrote for a party size or a
// canvas dimension. Same shape as the defect this file's own comments name three
// times: a check written around the form the violations happened to take.
//
// A destructured default is distinguished by what PRECEDES it — `{` or `,` (with
// optional whitespace), i.e. the start of a binding in an object pattern — which
// a declaration (`let `, `const `) and a member assignment (`.size`) never have.
const ICON_SIZE = /\bsize=\{\s*-?\d|[{,]\s*size\s*=\s*-?\d/;

// Rule 9: a hand-written duration/curve. `var(--t-shift) linear` is a token
// composition and must not match, so a TIME is required before the keyword.
const MOTION_LITERAL = /cubic-bezier\s*\(|\b\d+(?:\.\d+)?m?s\s+(?:ease|linear|steps)\b/;

// A quoted CSS DECLARATION LIST — `prop: value;` — i.e. devtools `%c` styling.
// A JSX inline style VALUE never contains a semicolon, which is what makes this
// structural rather than a guess. See the header note.
//
// It tests the CONTENTS of each quoted string, and that is not fussiness. The
// first version was one regex across the whole line — quote, anything, `prop:`,
// anything, `;` — and on a dense JSX line it started at a CLOSING quote and ran
// through the markup to the STATEMENT's trailing semicolon, so
// `border:"1.5px solid rgba(220,38,38,0.4)"` in BookingFormModal read as
// console styling and was silently not reported. Caught only by diffing the
// rule's output against a plain grep. That is this repo's most-repeated
// checker defect — blind exactly where it was meant to bite, while printing OK
// — and tests/style-check.test.js pins the case.
const DECL_LIST = /[a-z-]+\s*:[^;]*;/;
function quotedStrings(line) {
  const out = [];
  let quote = null, cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) { out.push(cur); cur = ""; quote = null; continue; }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
  }
  return out;
}
const isDevtoolsCss = (line) => quotedStrings(line).some((str) => DECL_LIST.test(str));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(p)) out.push(p);
  }
  return out;
}

const problems = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n");
  const codeLines = stripComments(raw);

  lines.forEach((line, i) => {
    // ── Rule 1 ──────────────────────────────────────────────────────────────
    if (/borderRadius:\s*[0-9]/.test(line) && !/@canvas/.test(line)) {
      problems.push({
        file: rel, line: i + 1, rule: "radius",
        text: line.trim().slice(0, 90),
        hint: "use the R scale (R.pill/card/inset/sheet), or mark the geometry exception /* @canvas */",
      });
    }

    // ── Rule 0: an exemption marker must be INSIDE the style object ─────────
    // The v17.8.0 markers were appended to the end of the line, which for a
    // line ending in `>` or `/>` puts them in JSX CHILDREN position — where
    // React renders `/* @canvas */` as literal text. Eight of them shipped
    // that way, printing comment syntax across the Plan view's time ruler and
    // the Stats popover's bars.
    //
    // It shipped because this script only ever asked whether the marker was
    // PRESENT on the line, never where — so the sites it was meant to bless
    // were the exact sites it broke, and it reported OK on all of them. A
    // checker that cannot see its own annotation is worth less than none.
    if (/(?:\/>|[^{,\s])>\s*\/\*\s*@(?:canvas|fixed-fill|shadow)/.test(line)) {
      problems.push({
        file: rel, line: i + 1, rule: "marker-placement",
        text: line.trim().slice(0, 90),
        hint: "this marker is in JSX children position and RENDERS as text — move it inside the style object, next to the property it exempts",
      });
    }

    // ── Rule 3: no bare `fontSize` / `fontWeight` number ────────────────────
    // v17.8.0. Same shape as Rule 1 and for the same reason: 497 inline size
    // literals in thirteen values, and 359 weight literals, had accreted into
    // sixteen distinct type styles on the app's emptiest screen. Use T and FW
    // (lib/constants.js); mark a genuine one-off with /* @canvas */.
    //
    // The value must START with T. or FW. — matching a bare DIGIT is not
    // enough. The first version of this rule did exactly that, and three sites
    // walked through it because their value is COMPUTED:
    //   fontSize: isMobile ? 18 : 22        (the wordmark)
    //   fontSize: d >= 36 ? 20 : 17         (mkStep's glyph)
    //   fontWeight: active ? 700 : 600      (Settings' TabBar)
    // Two of those numbers were not even on the scale. Same shape as the
    // marker-placement bug: a check written around the form the violations
    // happened to take, rather than around the invariant.
    //
    // Read the whole VALUE with styleValue, then judge it — two cheaper
    // approaches were both wrong. Matching a bare digit after the colon misses
    // a computed value (`fontSize: isMobile ? 18 : 22` — and 18 is not even on
    // the scale). A negative lookahead misses too: `\s*` backtracks, so on
    // `fontSize: T.body` it gives the space back, the lookahead reads " T."
    // which does not start with "T.", and every correct site reports.
    //
    // So: strip the legitimate T./FW. references out of the value, then look
    // for a number sitting where a font value would sit — the whole value, or
    // a ternary branch. That leaves comparison operands alone, which is what
    // makes `d >= 36 ? T.display : T.title` read as correct.
    const bareType = ["fontSize", "fontWeight"].some((k) => {
      const v = styleValue(line, k);
      if (v == null) return false;
      return /(^|[?:])\s*"?\d/.test(v.replace(/\b(?:T|FW)\.[a-zA-Z]+/g, ""));
    });
    if (bareType && !/@canvas/.test(line)) {
      problems.push({
        file: rel, line: i + 1, rule: "type-scale",
        text: line.trim().slice(0, 90),
        hint: "use the T scale (T.micro/small/body/lead/title/display) and FW (FW.regular/medium/semi/bold)",
      });
    }

    // ── Rules 4 & 5: the spacing and control-height scales ──────────────────
    // v17.9.0. These two are enforced DIFFERENTLY from rules 1 and 3, and the
    // difference is deliberate.
    //
    // R and T replaced every literal at every call site, because they are
    // SEMANTIC: `borderRadius: 12` genuinely did not say whether it meant
    // "control" or "card", so only a role name could. `gap: 8` says exactly what
    // it is. Tokenising ~600 spacing literals would buy indirection and nothing
    // else, and forcing the 84 one-off padding strings into an invented role
    // vocabulary would be 84 judgement calls that are invisible until someone
    // opens that one screen.
    //
    // So the source keeps readable literals and the CHECK is the contract: parse
    // the value, pull out every px component, and fail on anything that is not a
    // step. That kills the drift the audit actually found — eight values (1, 3,
    // 5, 7, 9, 11, 17, 20, 22) nobody chose, sitting beside their on-scale
    // neighbours: "5px 11px" in three files, "6px 9px" next to "6px 8px",
    // "9px 14px" next to "8px 14px".
    //
    // Keep both lists in step with SP and H in src/lib/constants.js by hand —
    // this script cannot import from src/ (it runs before any bundling), which
    // makes these the same kind of hand-synced pair as M.dur.
    const SPACING_PROPS = /^(padding|margin)(Top|Bottom|Left|Right|Inline|Block)?$|^gap$/;
    for (const key of ["padding", "paddingTop", "paddingBottom", "paddingLeft",
                       "paddingRight", "paddingInline", "paddingBlock", "gap",
                       "margin", "marginTop", "marginBottom", "marginLeft",
                       "marginRight"]) {
      if (!SPACING_PROPS.test(key)) continue;
      // The key must be an object KEY, not CSS inside a string literal. Without
      // this, firebase.js's DEV/PROD console badge — a plain
      // `"…;padding:2px 6px;border-radius:3px;…"` handed to console.log — reports
      // as an off-scale padding. It is devtools formatting, not app UI, and
      // exempting the site with /* @canvas */ would have been the wrong fix: the
      // rule would keep mis-firing on the next piece of console styling anyone
      // writes. So require the preceding non-space character to be `{` or `,` —
      // which a CSS declaration inside a string never has (it has `;`) — or
      // nothing at all, which is the multi-line style-object case:
      //     style={{
      //       padding: "3px 8px",       <- prefix is whitespace only
      // Getting that second branch wrong makes the rule silently blind to most
      // of the codebase while still reporting OK, which is worse than not having
      // it. tests/style-check.test.js exists to prove it still bites.
      const at = line.search(new RegExp("\\b" + key + "\\s*:"));
      if (at > 0 && !/(^|[{,])\s*$/.test(line.slice(0, at))) continue;
      const v = styleValue(line, key);
      if (v == null || /@canvas/.test(line)) continue;
      // Only judge literals. A token (SP.base), a variable, a ternary of
      // tokens, or a calc()/env() expression is out of scope — the same
      // reasoning as Rule 3's "strip the legitimate references first".
      const comps = /"/.test(v)
        ? [...v.matchAll(/(-?\d+)px/g)].map((m) => Math.abs(+m[1]))
        : (/^-?\d+$/.test(v.trim()) ? [Math.abs(+v.trim())] : []);
      const off = comps.filter((n) => !SPACING_STEPS.has(n));
      if (off.length) {
        problems.push({
          file: rel, line: i + 1, rule: "spacing-scale",
          text: line.trim().slice(0, 90),
          hint: "off-scale spacing " + off.join("/") + " — snap to the nearest SP step ("
                + [...SPACING_STEPS].join(", ") + "), or mark a layout dimension /* @canvas */",
        });
        break;   // one report per line is enough to act on
      }
    }

    for (const key of ["height", "minHeight"]) {
      const v = styleValue(line, key);
      if (v == null || /@canvas/.test(line)) continue;
      if (!/^-?\d+$/.test(String(v).trim())) continue;   // %, vh, tokens, calc()
      const n = +String(v).trim();
      // Only CONTROL-sized numbers are in scope. A 7px dot, a 200px popover
      // max-height and a 1px rule are not controls, and sweeping them in would
      // make this noisy — and a noisy check gets muted (the v17.8.0 lesson that
      // kept plain drop-shadows out of Rule 2).
      if (n < 24 || n > 56) continue;
      if (!HEIGHT_STEPS.has(n)) {
        problems.push({
          file: rel, line: i + 1, rule: "height-scale",
          text: line.trim().slice(0, 90),
          hint: "off-scale control height " + n + " — use the H scale ("
                + [...HEIGHT_STEPS].join(", ") + "; 44 is a FLOOR for decision "
                + "surfaces, not a target), or mark a layout dimension /* @canvas */",
        });
      }
    }

    // ── Rule 2 ──────────────────────────────────────────────────────────────
    const whiteInset = /inset[^"']*rgba\(\s*255,\s*255,\s*255/.test(line);
    if (whiteInset && !/@fixed-fill/.test(line)) {
      // Nearest governing fill, searching upward.
      let fill = null;
      for (let k = i; k >= Math.max(0, i - LOOKBACK) && fill === null; k--) {
        fill = styleValue(lines[k], "background(?:Color)?");
      }
      const fixed = fill !== null && FIXED_FILL.some((re) => re.test(fill));
      const flips = fill !== null && THEME_FILL.some((re) => re.test(fill));
      if (!fixed || flips) {
        problems.push({
          file: rel, line: i + 1, rule: "white-inset",
          text: line.trim().slice(0, 90),
          hint: fill === null
            ? "no fill found within " + LOOKBACK + " lines — mark /* @fixed-fill */ if the surface really is theme-invariant"
            : "fill `" + fill.trim().slice(0, 50) + "` flips with the theme; use var(--shadow-btn) instead",
        });
      }
    }

    // ── Rule 7 ──────────────────────────────────────────────────────────────
    // `code` is this line with comment text removed (see codeLines below), so
    // prose about a colour is not a colour. Markers are read off the RAW line,
    // which is where they live.
    const code = codeLines[i];
    if (!/@fixed-fill|@shadow/.test(line) && !isDevtoolsCss(code) && COLOUR_LITERAL.test(code)) {
      problems.push({
        file: rel, line: i + 1, rule: "colour-literal",
        text: line.trim().slice(0, 90),
        hint: "bare colour literal — use a var(--…) token (constants.js composes them; "
              + "index.html declares them), or mark /* @fixed-fill */ if the surface "
              + "under it is theme-invariant",
      });
    }

    // ── Rule 8 ──────────────────────────────────────────────────────────────
    if (ICON_SIZE.test(code) && !/@canvas/.test(line)) {
      problems.push({
        file: rel, line: i + 1, rule: "icon-scale",
        text: line.trim().slice(0, 90),
        hint: "numeric icon size — use the IC scale (IC.inline 12 / IC.control 14 / "
              + "IC.chrome 18), or mark a drawn-in-place marker /* @canvas */",
      });
    }

    // ── Rule 9 ──────────────────────────────────────────────────────────────
    if (MOTION_LITERAL.test(code) && !/@motion/.test(line)) {
      problems.push({
        file: rel, line: i + 1, rule: "motion-scale",
        text: line.trim().slice(0, 90),
        hint: "hand-written duration/curve — use the M scale (M.tap/move/shift/"
              + "status/exit, M.resize for AutoHeight only), or mark the WAAPI "
              + "escape hatch /* @motion */",
      });
    }

    // ── Rule 6 ──────────────────────────────────────────────────────────────
    const bare = line.trim();
    const isComment = bare.startsWith("//") || bare.startsWith("*") || bare.startsWith("/*");
    if (!isComment && !/@shadow/.test(line) && SHADOW_VALUE.test(line)) {
      problems.push({
        file: rel, line: i + 1, rule: "shadow-literal",
        text: bare.slice(0, 90),
        hint: "bare drop-shadow literal — use a --shadow-* token (btn / btn-solid / "
              + "flat / card / popover / well / btn-accent / btn-success), or mark a "
              + "genuine one-off /* @shadow */",
      });
    }
  });
}

if (problems.length === 0) {
  console.log("style invariants: OK (radius + type + spacing + height scales, "
            + "white-inset-over-fixed-fill, shadow + colour literals, icon + motion "
            + "scales, marker placement)");
  process.exit(0);
}

console.error("\nstyle-invariant violations (" + problems.length + "):\n");
for (const p of problems) {
  console.error("  " + p.file + ":" + p.line + "  [" + p.rule + "]");
  console.error("    " + p.text);
  console.error("    → " + p.hint + "\n");
}
console.error("See CLAUDE.md → \"Style tokens\" and the shadow-token rule.\n");
process.exit(1);
