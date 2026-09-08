// tests/test-hygiene.test.js — v18.0.0 phase 4
//
// One rule, about the tests themselves: **a test that greps JS or JSX source
// must strip comments before matching.**
//
// ── WHY THIS IS A GUARD AND NOT A CONVENTION ────────────────────────────────
// The convention already existed, and the tool already existed
// (`scripts/strip-comments.mjs`, v17.13.0, written after `check-style-invariants`
// and `a11y.test.js` each reported a false positive on prose about the thing
// they were hunting for). Two files used it. Nine did not, and nothing said so.
//
// That is the defect this repo names over and over — a fact kept in step by
// nothing gets written down N−1 times, and the missing one is invisible. It
// bit a THIRD time in v18.0.0 phase 4: `settings/settings-tabs` greps
// `useKeyboardShortcuts.js` for the `visibleTabs(` call, and the comment
// directly ABOVE that call quotes `visibleTabs(can)` in prose. Measured on the
// real file:
//
//   RAW      first `visibleTabs(` args → "can"
//   STRIPPED first `visibleTabs(` args → "K.can,K.hasModule"
//
// So the raw read answers with the SENTENCE ABOUT THE CALL. It would have
// failed the build for a correct consumer, and — worse, and the reason this is
// a guard — a `toContain("can")` assertion would have PASSED over a consumer
// that had dropped the gate entirely, because the comment satisfies it forever.
// A checker that cannot fail is worse than no checker.
//
// ── WHAT IS DELIBERATELY EXEMPT ─────────────────────────────────────────────
// CSS and HTML. `stripComments` is the JS/JSX stripper: it treats `//` as a
// line comment, and in CSS a bare `//` appears inside an unquoted
// `url(https://…)`, where running it would truncate the rest of the line.
// `tests/stylesheet.test.js` keeps its own CSS stripper for that reason, and
// `tests/csp.test.js` reads `index.html` raw because the bytes it hashes are
// the bytes the browser gets. This guard only looks at `.js` / `.jsx` / `.mjs`
// reads, so those are outside it by construction rather than by exemption.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS = dirname(fileURLToPath(import.meta.url));

// ── Detection ───────────────────────────────────────────────────────────────
// Two facts about a file, deliberately independent of HOW it spells the read.
// The first version matched `readFileSync(<path>.js")` and under-counted by
// four, because a test is free to wrap the call in a local helper (`code(...)`,
// `src(...)`) — and a guard that silently sees fewer files than it thinks is
// the same class of defect it exists to catch.
//
// So: does the file read from disk AT ALL, and does it name a JS/JSX/MJS path
// OUTSIDE an import? The second half is what excludes the `import … from
// "../src/lib/roles.js"` lines every test has, which are module resolution and
// not a source read.
const READS_DISK = /\breadFileSync\s*\(/;
const CODE_PATH = /"[^"]*\.(?:js|jsx|mjs)"/;

function namesCodePath(src) {
  return src.split("\n").some((line) => {
    const l = line.trim();
    if (l.startsWith("import ") || l.startsWith("} from ") || l.startsWith("* ") || l.startsWith("//")) return false;
    if (/\bfrom\s+"/.test(l)) return false;
    return CODE_PATH.test(l);
  });
}

const scans = ([, src]) => READS_DISK.test(src) && namesCodePath(src);

// This file's own prose quotes `readFileSync(` and JS paths repeatedly — which
// is exactly the hazard under test — so it reads itself out of the list rather
// than pretending the irony away.
const SELF = "test-hygiene.test.js";

// Exemptions carry a REASON and are expected to have been checked, the
// `check:style` marker convention. Empty today, and that is the point: it stays
// empty unless somebody can say why a raw read is right.
const EXEMPT = {
  // "some.test.js": "why a raw read is correct here",
};

const files = readdirSync(TESTS)
  .filter((f) => f.endsWith(".test.js") && f !== SELF)
  .map((f) => [f, readFileSync(join(TESTS, f), "utf8")]);

describe("a test that greps JS source strips comments first", () => {
  it("has tests to check, so an empty glob cannot pass this file", () => {
    // The guard against the guard. A rename or a moved directory would leave
    // every assertion below iterating nothing and reporting green.
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it("finds the source-scanning tests, and there are several", () => {
    // A floor, not the exact count: the number is free to grow and the guard
    // must not need editing when it does. It exists so a detector that has
    // quietly stopped matching anything cannot report green.
    const scanners = files.filter(scans);
    expect(scanners.length).toBeGreaterThanOrEqual(9);
  });

  // WHAT THIS CHECKS, EXACTLY: that a source-scanning test has the stripper in
  // hand — not that every read in it is stripped. A file may legitimately hold
  // both, and one does: `stylesheet.test.js` strips `main.jsx` and reads
  // `public/sw.js` RAW on purpose, because that assertion counts how often the
  // app's name appears in the file's text, header comment included (measured:
  // stripping took the count 3 → 2 and turned the suite red). So this is a
  // prompt to make the choice, not a proof that every choice was made well —
  // and saying so is the point, because a guard that claims more than it checks
  // is the thing this file exists to catch.
  it("every one of them imports stripComments", () => {
    const offenders = files
      .filter(([f, src]) => scans([f, src]) && !EXEMPT[f])
      .filter(([, src]) => !src.includes("strip-comments.mjs"))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it("every exemption names a file that exists and gives a reason", () => {
    Object.entries(EXEMPT).forEach(([f, why]) => {
      expect(files.some(([n]) => n === f)).toBe(true);
      expect(typeof why === "string" && why.length > 10).toBe(true);
    });
  });
});

describe("the stripper answers the question it is imported for", () => {
  it("returns the CALL's arguments where a raw read returns the comment's", async () => {
    // The measured case, pinned rather than described. If `stripComments` ever
    // stops skipping a comment that quotes a call, this fails here — in the one
    // file whose subject is that hazard — instead of silently weakening nine
    // other tests at once.
    const { stripComments } = await import("../scripts/strip-comments.mjs");
    const src = [
      "// v18.0.0: through `visibleTabs(can)`, not the raw list.",
      "const TABS = visibleTabs(K.can, K.hasModule).map(t => t.id);",
    ].join("\n");
    const argsOf = (s) => {
      const i = s.indexOf("visibleTabs(");
      return i < 0 ? null : s.slice(i + "visibleTabs(".length, s.indexOf(")", i));
    };
    expect(argsOf(src)).toBe("can");                       // the hazard
    expect(argsOf(stripComments(src).join("\n"))).toBe("K.can, K.hasModule");
  });

  it("leaves a // inside a string alone", () => {
    // The property that makes it safe to apply to a file holding URLs — and the
    // reason it is a character scanner rather than a regex.
    return import("../scripts/strip-comments.mjs").then(({ stripComments }) => {
      const out = stripComments('const u = "https://example.com/x"; // gone').join("\n");
      expect(out).toContain("https://example.com/x");
      expect(out).not.toContain("gone");
    });
  });
});
