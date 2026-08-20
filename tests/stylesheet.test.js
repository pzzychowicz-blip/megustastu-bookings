// tests/stylesheet.test.js
//
// v17.8.0 — a parse guard for index.html's <style> block.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// A stylesheet has no syntax errors. It has rules that silently don't exist.
//
// v17.8.0 shipped a stray `*/` after an already-closed comment. Two lines of
// English prose were then loose in the stylesheet, and CSS error recovery does
// the worst possible thing with that: it folds the text into the NEXT rule's
// *selector*, so the rule after it — `.mgt-press:active { filter: … }` — was
// dropped outright and the press dim died on ~28 controls across the app.
//
// Nothing caught it. `npm run build` passed (Vite does not parse inline CSS in
// index.html), eslint passed (not its file), 103 tests passed, and the source
// reads fine at a glance. It was found by walking the live CSSOM in a browser
// and noticing a rule that should have been there wasn't.
//
// ── What this checks ─────────────────────────────────────────────────────────
// 1. Comment hygiene: after stripping comments the way a CSS parser does, no
//    selector may contain `*/` or `/*`. This is the exact fingerprint of the
//    v17.8.0 bug and of every other unbalanced-comment mistake.
// 2. Brace balance.
// 3. CRITICAL_SELECTORS: rules whose absence is invisible in review but
//    load-bearing in the app — an interaction affordance nobody would notice
//    was missing until a user reported "the buttons feel dead". Add to the list
//    when you add a rule that fails silently.
//
// This is deliberately a small hand-rolled walk rather than a real CSS parser:
// the dependency is not worth it, and the failure mode being guarded (text
// where a selector should be) is visible without full spec compliance.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

// Every rule here fails SILENTLY when it goes missing — no error, no visual
// hole, just an affordance that quietly stops working. That is the entry
// criterion for this list, not importance in the abstract.
const CRITICAL_SELECTORS = [
  ".mgt-hover-scale",                 // the hover lift's transition
  ".mgt-press:active",                // the press dim — the v17.8.0 casualty
  "button:active",                    // the universal press-scale
  ":focus-visible",                   // the keyboard ring
  ".mgt-notif",                       // the strip's section hairlines
  ".mgt-card-in",                     // modal/popover entrance
  ".mgt-card-out",                    // modal/popover exit
  ".mgt-appear",                      // fade-in-to-own-opacity (timeline ghosts)
  ".mgt-fade-in",                     // Settings tab crossfade
  ".mgt-dot-pulse",                   // the "busy" toast dot
  ".mgt-ac-row",                      // row/card/panel tint — AND their resting fill
  ".mgt-glyph",                       // floor-plan table hover halo + press dim
  "[data-kbd] .mgt-glyph:focus",      // the plan table's keyboard ring (:focus-visible does not match SVG)
  ".mgt-tlghost",                     // the seated ghost's lockstep hover
  ".mgt-group-hover",                 // multi-table group lift
  ".mgt-ac-row:active",               // the touch tint on card/row/panel surfaces
  ".mgt-blk:active",                  // the timeline block/ghost press dip
  ".mgt-plan-headrow",                // Plan header grid (has a media fallback)
  ".mgt-detent",                      // TimeAxis snap
  "@media print",                     // DaySheet is print-only; nothing else shows it
];

function styleBlocks(html) {
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

// Strip comments exactly as a CSS tokenizer does: from `/*` to the FIRST `*/`.
// A trailing `*/` with no opener is therefore left in place — which is the
// whole point, because that is what leaks into a selector.
function stripComments(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("/*", i);
    if (open === -1) { out += css.slice(i); break; }
    out += css.slice(i, open);
    const close = css.indexOf("*/", open + 2);
    if (close === -1) { out += "\n/* UNTERMINATED */"; break; }   // flagged below
    i = close + 2;
  }
  return out;
}

// Collect every rule prelude (the text before a `{`), at any nesting depth.
function preludes(css) {
  const out = [];
  let buf = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") { out.push(buf.trim()); buf = ""; }
    else if (c === "}") { buf = ""; }
    else buf += c;
  }
  return out.filter(Boolean);
}

describe("index.html stylesheet", () => {
  const blocks = styleBlocks(HTML);

  it("has exactly one <style> block", () => {
    expect(blocks.length).toBe(1);
  });

  const css = stripComments(blocks[0]);

  it("has no unterminated comment", () => {
    expect(css).not.toContain("/* UNTERMINATED */");
  });

  it("has balanced braces", () => {
    const open = (css.match(/\{/g) || []).length;
    const close = (css.match(/\}/g) || []).length;
    expect(open).toBe(close);
  });

  // THE regression test for v17.8.0. A leftover `*/` (or a `/*` that survived
  // stripping) can only be sitting in a selector, and a selector containing
  // one is dropped by the browser along with its whole rule.
  it("has no comment delimiter left inside a selector", () => {
    const bad = preludes(css).filter((p) => p.includes("*/") || p.includes("/*"));
    expect(bad).toEqual([]);
  });

  // A selector should not contain a full stop followed by a space — prose leaks
  // in as sentences, and no real selector in this app looks like that.
  it("has no prose in a selector", () => {
    const bad = preludes(css).filter((p) => /\.\s+[A-Za-z]/.test(p) && !p.startsWith("@"));
    expect(bad).toEqual([]);
  });

  // ── The gap the first version of this file left open ────────────────────────
  // The two checks above only look at SELECTORS, because the v17.8.0 bug that
  // prompted them happened between rules. Writing the contrast pass I made the
  // same mistake one scope deeper — a stray `*/` inside `:root`'s declaration
  // block — and every test here passed while the browser silently dropped
  // `--tbl-out-rgb` entirely, because CSS reads from the loose prose to the next
  // `;` as ONE bad declaration and throws it away with the real one riding on
  // its tail. Nine table badges rendered transparent. Same failure class, same
  // silence, different scope: prose loose in a declaration block eats the
  // declaration AFTER it.
  it("has no comment delimiter left anywhere, not only in selectors", () => {
    const stray = [];
    css.split("\n").forEach((line, i) => {
      if (line.includes("*/") || line.includes("/*")) stray.push(i + 1 + ": " + line.trim().slice(0, 70));
    });
    expect(stray, "comment delimiters survived stripping — an unbalanced comment").toEqual([]);
  });

  it("has no prose loose in a declaration block", () => {
    const bad = [];
    // Innermost blocks only: `[^{}]*` cannot span a nested rule, so this yields
    // declaration bodies for plain rules AND for the rules inside @media.
    for (const m of css.matchAll(/\{([^{}]*)\}/g)) {
      for (const decl of m[1].split(";")) {
        const d = decl.trim();
        if (!d) continue;
        const colon = d.indexOf(":");
        if (colon < 0) continue;                 // e.g. a trailing fragment
        const prop = d.slice(0, colon).trim();
        // A property is one identifier. Prose is several words, so the space is
        // the whole tell — and it is what a swallowed declaration looks like.
        if (/\s/.test(prop)) bad.push(prop.slice(0, 60));
      }
    }
    expect(bad, "these read as prose, not properties — the declaration after each is being eaten").toEqual([]);
  });

  it.each(CRITICAL_SELECTORS)("still defines %s", (sel) => {
    const found = preludes(css).some((p) => p.includes(sel));
    expect(found).toBe(true);
  });

  // v17.10.1 — NOT a CRITICAL_SELECTORS entry, and that is the point. The
  // obvious guard was to add `[role="button"]` to that list, which would have
  // passed forever while guarding nothing: the selector already appears in the
  // press-scale rules, and `"button"` is a substring of the font-family rule.
  // A list that matches on selectors cannot see a DECLARATION going missing.
  //
  // Both halves are asserted because they cover different platforms and either
  // could be dropped without the other showing it: unprefixed `user-select` is
  // what Android Chrome reads (the reported bug — a long-press opening the OS
  // text menu on top of the quick-status popup), `-webkit-touch-callout` is the
  // iOS property for the same gesture.
  it("keeps controls opted out of OS text selection", () => {
    const bodies = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter((m) => m[1].includes('[role="button"]'))
      .map((m) => m[2]);
    expect(bodies.some((b) => /(^|[^-])user-select:\s*none/.test(b)),
      "no rule opts controls out of text selection").toBe(true);
    expect(bodies.some((b) => /-webkit-touch-callout:\s*none/.test(b)),
      "the iOS half of the control no-select rule is missing").toBe(true);
  });

  // v17.10.1 — same shape, same reason. Android's default tap highlight is
  // rgba(51,181,229,0.4) painted as a RECTANGLE over the border box, ignoring
  // border-radius: a blue rectangle around every pill you touch. The kill lives
  // on `:root` because the property inherits, and `:root` is far too common a
  // prelude to guard by name — so, again, assert the DECLARATION.
  it("keeps the platform tap highlight suppressed", () => {
    // /code-review: this WAS a whole-sheet search, which could not tell the
    // difference between the declaration living on `:root` and it being
    // narrowed onto one selector or buried in `@media print` — in either case
    // the blue rectangle returns everywhere else while the test still passes.
    // The fix relies on INHERITANCE from the root, so that is what to assert.
    const rooted = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter((m) => /(^|[\s,])(:root|html)\s*$/.test(m[1].trim()))
      .map((m) => m[2]);
    expect(rooted.some((b) => /-webkit-tap-highlight-color:\s*transparent/.test(b)),
      "Android's blue tap-highlight rectangle is back (no :root/html suppression)").toBe(true);
  });
});
