// tests/style-check.test.js
//
// v17.9.0 — a test for the CHECKER, not for the app.
//
// This exists because of a near-miss while writing the spacing rule. The first
// version required the property to be preceded by `{` or `,` (to avoid matching
// CSS inside a string literal, like firebase.js's console badge). That
// condition is false for a key in a MULTI-LINE style object, where the prefix is
// whitespace only — which is most of the codebase. The rule went blind, and
// `npm run check:style` printed OK.
//
// That is the exact shape of the v17.8.0 marker-placement bug: a check whose
// verdict was worthless precisely where it was supposed to bite, while carrying
// the authority of having passed. Reading the script does not catch it. Running
// it against known-bad input does.
//
// So: these fixtures are a floor. If a rule is changed, this must still fail on
// every violation below and stay silent on every legitimate line.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = new URL("../scripts/check-style-invariants.mjs", import.meta.url).pathname;
let dir;

// Run the checker against a fixture directory; return its combined output.
function run(files) {
  const src = join(dir, "src");
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(src, name), body);
  try {
    return { code: 0, out: execFileSync("node", [SCRIPT, src], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "mgt-style-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe("check:style — shadow literals (v17.10.1)", () => {
  it("catches a bare drop-shadow literal", () => {
    const r = run({ "a.jsx": 'const x = <div style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.12)" }} />;\n' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/shadow-literal/);
  });

  // The v17.10.0 miss: the sweep grepped the PROPERTY name, so a literal
  // assigned to a const (StatusToasts' toastShadow) was invisible to it.
  it("catches a literal hiding behind a const", () => {
    const r = run({ "a.jsx": 'const shd = "0 1px 4px rgba(0,0,0,0.1)";\nconst y = <div style={{ boxShadow: shd }} />;\n' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/shadow-literal/);
  });

  // /code-review: the first version of this rule only recognised rgba()/hex
  // colours and integer px, so all three of these printed OK — the exact
  // literal the rule exists to catch, invisible to it.
  it.each([
    ['var()',       '"0 2px 6px var(--some-color)"'],
    ['named',       '"0 2px 6px black"'],
    ['hsl()',       '"0 2px 6px hsl(0 0% 0% / 0.2)"'],
    ['decimal px',  '"0 1.5px 3px rgba(0,0,0,0.2)"'],
  ])("catches a %s shadow literal", (_label, value) => {
    const r = run({ "a.jsx": `const x = <div style={{ boxShadow: ${value} }} />;\n` });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/shadow-literal/);
  });

  // A zero blur is a ring however it is spelled, including `0px`.
  //
  // v17.13.0: asserted on the RULE, not on the exit code. The rgba spelling is
  // the point of the fixture, and the colour rule added in this version reports
  // it — correctly, since a ring in this app takes a token. Weakening either
  // rule to keep one `toBe(0)` would have been the wrong trade; naming the rule
  // each fixture is about is what it should always have done.
  it("leaves a 0px-blur ring alone", () => {
    const r = run({ "a.jsx": 'const x = <div style={{ boxShadow: "0 0 0px 2px rgba(0,122,255,0.4)" }} />;\n' });
    expect(r.out).not.toMatch(/shadow-literal/);
  });

  // The colour alternation now accepts a bare identifier, so prove it does not
  // reach into ordinary multi-length properties.
  it("leaves padding and transition values alone", () => {
    const r = run({ "a.jsx": 'const x = <div style={{ padding: "0 2px 6px 8px", transition: "transform 240ms ease" }} />;\n' });
    expect(r.code).toBe(0);
  });

  it("catches an inset groove", () => {
    const r = run({ "a.jsx": 'const x = <div style={{ boxShadow: "inset 0 1px 2px rgba(0,0,0,0.08)" }} />;\n' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/shadow-literal/);
  });

  // THE regression case for this rule. Without anchoring the value to a quote,
  // `inset`, or a list comma, the pattern SLIDES: it matches `0 0 2px rgba(`
  // inside `0 0 0 2px rgba(...)` and flags a ring — precisely what the
  // non-zero-blur condition exists to exclude. Found by running it, not by
  // reading it.
  it("leaves zero-blur rings and glows alone", () => {
    const r = run({ "a.jsx":
      'const a = <div style={{ boxShadow: "0 0 0 3px var(--accent)" }} />;\n'
      + 'const b = <div style={{ boxShadow: "0 0 0 2px rgba(0,122,255,0.4)" }} />;\n' });
    expect(r.out).not.toMatch(/shadow-literal/);   // see the 0px-blur fixture
  });

  it("leaves a token and a marked one-off alone", () => {
    const r = run({ "a.jsx":
      'const a = <div style={{ boxShadow: "var(--shadow-btn-solid)" }} />;\n'
      + 'const b = <div style={{ boxShadow: "0 10px 24px rgba(0,0,0,0.3)"   /* @shadow */ }} />;\n' });
    expect(r.code).toBe(0);
  });

  it("rejects an @shadow marker parked in JSX children position", () => {
    const r = run({ "a.jsx": 'const x = <div style={{ borderRadius: 4 }} />   /* @shadow */;\n' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/marker-placement/);
  });
});

describe("check:style — spacing scale", () => {
  // THE regression case. A whitespace-only prefix must still be inspected.
  it("catches an off-scale value in a MULTI-LINE style object", () => {
    const r = run({ "a.jsx": 'const x = (\n  <div style={{\n    padding: "3px 8px"\n  }} />\n);\n' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/spacing-scale/);
  });

  it("catches an off-scale value inline after a brace", () => {
    const r = run({ "a.jsx": 'const x = <div style={{ padding: "5px 11px" }} />;\n' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/spacing-scale/);
  });

  it("catches a bare off-scale gap and margin", () => {
    expect(run({ "a.jsx": "const x = <div style={{ gap: 9 }} />;\n" }).code).toBe(1);
    expect(run({ "a.jsx": "const x = <div style={{ marginTop: 7 }} />;\n" }).code).toBe(1);
  });

  it("passes on-scale values", () => {
    const r = run({ "a.jsx": 'const x = <div style={{ padding: "8px 14px", gap: 8, marginTop: 12 }} />;\n' });
    expect(r.code).toBe(0);
  });

  it("honours the /* @canvas */ exemption", () => {
    const r = run({ "a.jsx": 'const x = <div style={{ padding: "6px 0 2px 58px",   /* @canvas */ }} />;\n' });
    expect(r.code).toBe(0);
  });

  // firebase.js's DEV/PROD console badge is a CSS string handed to console.log.
  // Devtools formatting is not app UI, and it must not need an exemption marker.
  it("ignores CSS inside a plain string literal", () => {
    const r = run({ "a.js": 'const badge = "color:#fff;padding:2px 6px;border-radius:3px;";\n' });
    expect(r.code).toBe(0);
  });
});

describe("check:style — height scale", () => {
  it("catches an off-scale control height", () => {
    expect(run({ "a.jsx": "const x = <div style={{ minHeight: 34 }} />;\n" }).code).toBe(1);
    expect(run({ "a.jsx": "const x = <div style={{ height: 30 }} />;\n" }).code).toBe(1);
  });

  it("passes the H steps", () => {
    const r = run({ "a.jsx": "const x = <div style={{ minHeight: 40 }} />;\n" });
    expect(r.code).toBe(0);
  });

  // Deliberately out of scope — a 7px dot and a 200px popover cap are not
  // controls, and sweeping them in is how a check becomes noise and gets muted.
  it("ignores sizes outside the control range", () => {
    const r = run({ "a.jsx": "const x = <div style={{ height: 7, minHeight: 200 }} />;\n" });
    expect(r.code).toBe(0);
  });
});

// The pre-existing rules must keep working — this file now guards the whole script.
describe("check:style — the v17.8.0 rules still bite", () => {
  it("catches a bare borderRadius", () => {
    expect(run({ "a.jsx": "const x = <div style={{ borderRadius: 12 }} />;\n" }).code).toBe(1);
  });

  it("catches a bare fontSize, including a computed one", () => {
    expect(run({ "a.jsx": "const x = <div style={{ fontSize: 13 }} />;\n" }).code).toBe(1);
    expect(run({ "a.jsx": "const x = <div style={{ fontSize: m ? 18 : 22 }} />;\n" }).code).toBe(1);
  });

  it("catches a marker parked in JSX children position", () => {
    const r = run({ "a.jsx": "const x = <div style={{ borderRadius: 4 }} />   /* @canvas */;\n" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/marker-placement/);
  });
});

describe("check:style — colour literals (v17.13.0)", () => {
  it.each([
    ["rgba()", 'background: "rgba(180,180,190,0.4)"'],
    ["rgb()",  'background: "rgb(249,115,22)"'],
    ["6-digit hex", 'color: "#1f2937"'],
    ["3-digit hex", 'color: "#fff"'],
  ])("catches a bare %s", (_label, decl) => {
    const r = run({ "a.jsx": `const x = <div style={{ ${decl} }} />;\n` });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/colour-literal/);
  });

  it("catches a colour hiding behind a const", () => {
    const r = run({ "a.jsx": 'const ink = "#166534";\nconst x = <div style={{ color: ink }} />;\n' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/colour-literal/);
  });

  // The composed-token idiom — `rgba(var(--tbl-out-rgb), 0.8)` in constants.js —
  // is a token reference, not a literal. If this ever reports, every fill in
  // STATUS_COLORS and TBL lights up and the rule gets muted, which is how a
  // noisy check dies.
  it("leaves a token reference alone", () => {
    const r = run({
      "a.jsx": 'const x = <div style={{ background: "rgba(var(--tbl-out-rgb),0.8)", color: "var(--text-on-accent)" }} />;\n',
    });
    expect(r.code).toBe(0);
  });

  it("accepts /* @fixed-fill */ on a deliberate literal", () => {
    const r = run({ "a.jsx": 'const x = <div style={{ background: "#fef9c3", /* @fixed-fill */ color: "#854d0e" }} />;\n' });
    expect(r.code).toBe(0);
  });

  // @shadow blesses the colour inside the shadow it already blesses; requiring
  // both markers on one line would teach nothing.
  it("accepts /* @shadow */ on a shadow literal's colour", () => {
    const r = run({ "a.jsx": 'const x = <div style={{ boxShadow: "0 10px 24px rgba(0,0,0,0.3)" /* @shadow */ }} />;\n' });
    expect(r.code).toBe(0);
  });

  // Half of this repo's apparent colour literals are PROSE about colours — the
  // SIZE_RING note, the v17.8.0 lessons, the `rgba(0,0,0,0)` a class measured
  // at. A `startsWith("//")` test is not enough: a JSX block comment's
  // continuation lines start with ordinary words.
  it("ignores a colour named in a comment, including a block continuation line", () => {
    const r = run({
      "a.jsx": [
        "// The old value was rgba(255,255,255,0.2) and it was wrong.",
        "/* An open comment",
        "   whose second line says #1f2937 with no leading marker,",
        "   and mentions rgba(0,0,0,0) too. */",
        "const x = <div />;",
        "",
      ].join("\n"),
    });
    expect(r.code).toBe(0);
  });

  // Devtools `%c` styling is a CSS declaration list handed to console.log — not
  // app UI and not themed. Rule 4 faced the same site and its comment says why
  // marking it would be the wrong fix.
  it("ignores devtools %c styling", () => {
    const r = run({
      "a.js": 'console.log("%cMGT", "color:#60a5fa;font-size:18px;font-weight:500;");\n',
    });
    expect(r.code).toBe(0);
  });

  // The false negative that shipped in this rule's first draft, and the reason
  // the devtools test reads a quoted string's CONTENTS rather than scanning the
  // whole line: on dense JSX the old pattern started at a CLOSING quote and ran
  // through the markup to the STATEMENT's trailing `;`, so a real literal read
  // as console styling and was silently not reported.
  it("still catches a literal on a JSX line whose statement ends in a semicolon", () => {
    const r = run({
      "a.jsx": 'const x = <span style={{ border: "1.5px solid rgba(220,38,38,0.4)", flexShrink: 0 }}>Kitchen busy</span>;\n',
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/colour-literal/);
  });

  // An HTML entity is not a colour. The app drew its nav chevrons as
  // `&#8249;`/`&#8250;` until v17.9.0, and "an entity is invisible to a glyph
  // grep" is already a recorded lesson — this is that fact pointed the other way.
  it("does not read an HTML entity as a hex colour", () => {
    const r = run({ "a.jsx": 'const x = <span dangerouslySetInnerHTML={{ __html: "&#8249;" }} />;\n' });
    expect(r.code).toBe(0);
  });
});
