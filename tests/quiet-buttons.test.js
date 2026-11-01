// tests/quiet-buttons.test.js
// v18.14.0 (correction 5): every secondary grey is one quiet button. What it looks like
// is in REFACTOR_LOG, because that takes a browser. This holds what fails silently: a
// fill that reaches a button without the rule that gives it its ink, which is white
// text on a pale pill, and the few buttons Patryk chose to keep solid.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { mkBtn, mkSolidBtn } from "../src/components/atoms.jsx";
import { BTN, H, T } from "../src/lib/constants";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (f) => readFileSync(join(SRC, f), "utf8");
const code = (f) => stripComments(read(f)).join("\n");
const sources = [];
(function walk(dir) {
  readdirSync(dir).forEach((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.jsx?$/.test(n)) sources.push(p.slice(SRC.length + 1));
  });
})(SRC);

const QUIET = { border: "1px solid var(--field-edge)", color: "var(--text-secondary)", boxShadow: "none" };

describe("the fill decides", () => {
  it("a button that names no fill is quiet", () => {
    expect(mkBtn()).toMatchObject({ background: BTN.quiet, ...QUIET });
    expect(mkBtn({ minHeight: H.touch })).toMatchObject({ background: BTN.quiet, ...QUIET, minHeight: H.touch });
  });
  it("so is one that names the quiet fill, at either size", () => {
    expect(mkBtn({ background: BTN.quiet })).toMatchObject(QUIET);
    expect(mkSolidBtn(BTN.quiet)).toMatchObject({ ...QUIET, minHeight: H.touch, fontSize: T.lead });
  });
  it("a solid fill keeps white ink, the glass rim and its shadow", () => {
    const b = mkBtn({ background: "var(--accent)" });
    expect(b.color).toBe("var(--text-on-accent)");
    expect(b.border).toBe("1px solid var(--border-glass)");
    expect(b.boxShadow).toBe("var(--shadow-btn)");
  });
  it("`cond ? solid : quiet` carries all of it, which is why the rule reads the fill", () => {
    const at = (on) => mkBtn({ background: on ? "var(--app-btn-dark)" : BTN.quiet });
    expect(at(true).color).toBe("var(--text-on-accent)");
    expect(at(false).color).toBe("var(--text-secondary)");
  });
  it("extra still has the last word", () => {
    expect(mkBtn({ color: "var(--text-primary)" }).color).toBe("var(--text-primary)");
  });
});

describe("nothing goes round it", () => {
  const all = sources.map((f) => [f, code(f)]);
  it("the greys it replaced are gone from the app", () => {
    const left = all.filter(([, s]) => /BTN\.(nav|clear|reset|dismiss)\b|--btn-(default|nav|clear|reset|dismiss)\b|--app-btn-slate/.test(s));
    expect(left.map(([f]) => f)).toEqual([]);
  });
  it("no spread paints over the fill mkBtn was given: the ink would stay the fill's", () => {
    const over = all.filter(([, s]) => /\.\.\.mk(Solid)?Btn\([^)]*\),\s*background:/.test(s));
    expect(over.map(([f]) => f), "LoginScreen did, and its Log in went white on blue with a grey word").toEqual([]);
  });
  it("no quiet solid hands its shadow back", () => {
    const back = all.filter(([, s]) => /mkSolidBtn\(BTN\.quiet, \{[^\n]*boxShadow/.test(s));
    expect(back.map(([f]) => f)).toEqual([]);
  });
});

describe("the buttons he kept solid", () => {
  it("Following and Optimiser ON, with Follow and Optimiser OFF quiet", () => {
    expect(code("components/TimelineZoomControls.jsx")).toContain('background: followNow ? "var(--app-btn-dark)" : BTN.quiet');
    expect(code("components/OptimiserControls.jsx")).toContain('background: autoOptimizer ? "var(--app-walkin)" : BTN.quiet');
  });
  it("Undo, solid blue", () => {
    expect(code("components/StatusToasts.jsx")).toMatch(/background:"var\(--accent\)",flexShrink:0\}\)\}>Undo</);
  });
  it("the grey title pills, and Completed on a button", () => {
    expect(code("components/SearchPanel.jsx")).toMatch(/background="var\(--app-btn-grey-strong\)"/);
    expect(read("lib/constants.js")).toContain('completed:"var(--btn-completed)"');
    expect(read("index.css")).toMatch(/--btn-completed: var\(--app-btn-grey\);/);
  });
  it("Send, green the moment it can send", () => {
    expect(code("components/whatsapp/ReplyComposer.jsx")).toContain('mkSolidBtn(canSend ? "var(--wa-green-dark)" : BTN.quiet,');
  });
});

describe("a flip between quiet and solid eases as one change", () => {
  const css = read("index.css");
  const rule = css.slice(css.indexOf(".mgt-hover-scale, .mgt-press {"));
  const body = rule.slice(0, rule.indexOf("}"));
  it("the ink and the edge are in the shared transition", () => {
    expect(body).toMatch(/background-color var\(--t-tap\)/);
    expect(body).toMatch(/\bcolor var\(--t-tap\)/);
    expect(body).toMatch(/border-color var\(--t-tap\)/);
    expect(body).toMatch(/box-shadow var\(--t-tap\)/);
  });
});
