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
// Deliberately NOT checked: plain dark drop-shadow literals
// (`0 1px 4px rgba(0,0,0,0.04)`). They are a consistency nit, not a bug class —
// a black shadow does not invert out from under itself. Pretending to cover
// them would make this script noisy, and a noisy check gets muted.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const LOOKBACK = 10;   // lines to search upward for the governing fill

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
  const lines = readFileSync(file, "utf8").split("\n");

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
    if (/(?:\/>|[^{,\s])>\s*\/\*\s*@(?:canvas|fixed-fill)/.test(line)) {
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
  });
}

if (problems.length === 0) {
  console.log("style invariants: OK (radius scale + type scale + white-inset-over-fixed-fill)");
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
