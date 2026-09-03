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

// v17.15.1 — the stylesheet moved OUT of index.html into src/index.css so the
// service worker can cache it (see that file's header). This test follows it:
// what is being guarded is the CSS, not the file it happened to live in. Every
// check below is unchanged — the parse walk, the prose guards and the whole
// CRITICAL_SELECTORS list still run, against the same bytes in a new home.
const CSS_SRC = readFileSync(join(ROOT, "src", "index.css"), "utf8");

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
  ".mgt-skip",                        // the skip link is hidden BY this rule
  ".mgt-skip:focus",                  // …and revealed by this one
  ".mgt-detent",                      // TimeAxis snap
  // v17.16.12 — the transient hold guard (lib/holdSelection sets the
  // attribute; this rule is the whole of what the attribute DOES). Missing,
  // `beginHold` still sets `data-holding` on <html> and nothing at all
  // happens: no error, no visual change, and the iOS selection callout the
  // guard exists to suppress comes back during every press-and-hold. The
  // textbook entry for this list.
  "html[data-holding] *",
  // v17.15.0 — SlideView's three entrance classes. It mounts with
  // `animating: true` and leaves that state ONLY on `animationend`, so a
  // missing rule means the event never comes and the view wrapper keeps
  // `overflow: hidden` forever: hover lifts clipped app-wide, and a clipped
  // pane in the fixed-shell and Split View layouts. Verified by injecting
  // `animation: none` on the fade and changing the date — the class stayed on
  // and the computed overflow stayed `hidden`, with nothing thrown and nothing
  // visibly missing. Textbook silent failure, and the two slide classes had
  // always had it without being listed.
  ".mgt-view-in-left",                // the T/L/P switch, leftward
  ".mgt-view-in-right",               // the T/L/P switch, rightward
  ".mgt-view-fade",                   // a DATE change: no transform, on purpose
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

describe("the app stylesheet (src/index.css)", () => {
  // The inline block must NOT come back. It was 89 kB of index.html, and
  // navigations are network-first in public/sw.js, so inlining it means
  // re-sending it on every single app open — the exact cost v17.15.1 removed.
  // Vite injects the <link> itself from main.jsx's import, so a <style> block
  // reappearing here means someone pasted CSS back into the HTML.
  it("is not inlined back into index.html", () => {
    expect(styleBlocks(HTML)).toEqual([]);
  });

  // /code-review — the silent-failure this whole move introduced. The
  // stylesheet now reaches the app through ONE import line, and nothing else
  // verifies it: an unused .css file is not a build error, eslint does not read
  // it, and every CSS test in this repo (here, contrast, motion, a11y) reads the
  // file straight off disk rather than through the import graph. So deleting
  // that line ships an app with NO styling at all while the build, the linter
  // and all 565 tests stay green.
  //
  // Inline in index.html the CSS could not fail to load. That property is what
  // was traded away for the caching win, and this is what buys it back.
  it("is actually imported by the entry module", () => {
    const main = readFileSync(join(ROOT, "src", "main.jsx"), "utf8");
    expect(main, "src/main.jsx must import ./index.css or the app ships unstyled")
      .toMatch(/^\s*import\s+["']\.\/index\.css["']/m);
  });

  const css = stripComments(CSS_SRC);

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

  // v17.12.0 — a DECLARATION-shaped guard again, for the same reason as the two
  // above: `[role="button"]` is in CRITICAL_SELECTORS-adjacent territory and
  // already appears in several preludes, so a selector list cannot see the
  // `:not(.mgt-glyph)` half being "simplified" away.
  //
  // What it protects: a CSS `transform` REPLACES an SVG element's `transform`
  // presentation attribute. `TableGlyph` positions every floor-plan table with
  // `translate(x,y) rotate(r)` on a `<g>`, so a shared transform rule reaching
  // it does not scale the table — it teleports the table to the plan origin and
  // takes the click target out from under the pointer. Shipped for one commit
  // in v17.12.0; measured at (554,243) -> (313,176).
  it("keeps transform rules off the floor-plan glyph", () => {
    const offenders = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter((m) => m[1].includes('[role="button"]'))
      .filter((m) => /(^|[;\s])transform\s*:/.test(m[2]) || /transition\s*:[^;]*transform/.test(m[2]))
      .filter((m) => !m[1].includes(".mgt-glyph"))
      .map((m) => m[1].trim().replace(/\s+/g, " "));
    expect(offenders,
      "a [role=\"button\"] rule applies a transform without excluding .mgt-glyph — " +
      "this teleports every floor-plan table to the plan origin").toEqual([]);
  });
});
