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
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

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

// v17.9.0 — must match SP and H in src/lib/constants.js. Hand-synced: this
// script runs standalone (no bundler, no JSX transform), so it cannot import
// from src/. Same class of hand-kept pair as M.dur vs the CSS motion tokens.
const SPACING_STEPS = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 24, 32]);
const HEIGHT_STEPS = new Set([28, 32, 36, 40, 44]);

// The WA module's saturated, TEXT-BEARING fills. Declared in `:root` ONLY, with
// no dark override, deliberately: the 17.8.0-wa-sandbox contrast pass made them
// OPAQUE precisely so one value works in both themes, which is what
// "theme-invariant" has to mean in order to be true. Everything else under
// --wa-* (panes, rows, banners, rims) DOES flip.
//
// One list, two regexes built from it — the fixed set and its complement. The
// classification is checked below as `!fixed || flips`, so BOTH have to agree:
// a name matched by both lists still counts as flipping. The first attempt put
// the bare `--wa-` prefix in THEME_FILL under a comment asserting the whole
// family flipped, which would have failed a CORRECT white inset over
// --wa-green citing a dark override that has never existed.
const WA_OPAQUE = "green|green-dark|btn-open|btn-cancel|btn-handled|bubble-out|sim-accent|unread-dot";

// Fills that do NOT flip with the theme: saturated solids, block colours, and
// raw colour literals. A white inset is correct over any of these.
const FIXED_FILL = [
  /rgba?\(/, /#[0-9a-fA-F]{3,8}/,
  /BLOCK_BG\b/, /\bBTN\./, /S\.accent/, /TBL\./,
  /var\(--app-[a-z-]*(solid|walkin|new|btn-[a-z-]+)\)/,
  /var\(--accent\)/, /var\(--btn-[a-z-]+\)/, /var\(--tag-flag\)/,
  new RegExp("var\\(--wa-(?:" + WA_OPAQUE + ")\\)"),
];
// Fills that DO flip. Anything matching here under a white inset is the bug.
const THEME_FILL = [
  /var\(--bg-[a-z-]+\)/, /var\(--(warn|danger|suggest)-bg[a-z-]*\)/,
  /var\(--border-[a-z-]+\)/, /var\(--text-[a-z-]+\)/,
  // The REST of the --wa-* family (WA sandbox) — soft surfaces, rows, panes,
  // banners and rims, every one of which has a dark override. A white inset
  // over these is the bug this rule exists for; without this the checker walked
  // past the module entirely (the --app-btn-grey prefix-blindness again).
  // The lookahead is the complement of WA_OPAQUE, and it needs the closing
  // paren inside it: --wa-bubble-out is opaque, --wa-bubble-out-border flips,
  // and only the `)` tells them apart.
  new RegExp("var\\(--wa-(?!(?:" + WA_OPAQUE + ")\\))[a-z-]+\\)"),
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
  });
}

if (problems.length === 0) {
  console.log("style invariants: OK (radius + type + spacing + height scales, "
            + "white-inset-over-fixed-fill, marker placement)");
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
