// tests/link-buttons.test.js — v18.8.0: a LINK drawn as a button is as tall as
// a button.
//
// The photo viewer's Save photo is an <a> (a download needs `href` and
// `download`) styled with mkBtn, like the Done beside it. A <button> is
// border-box by the browser's default and an <a> is not, and nothing in this
// app sets box-sizing globally, so the link's 44px floor was its CONTENT's:
// measured on DEV, 66px tall (44 + 2 × 10 padding + 2 × 1 border), and the
// footer row stretched Done to 66 beside it. Patryk: "gigantic compared to the
// other ones". After: both 44, as Find a booking's Done (69.1 × 44) is, on the
// tablet card and on the 375px sheet.
//
// The sweep finds every <a> whose style is one of the button makers, so the
// next link drawn as a button is held to the same rule.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.jsx$/.test(e.name)) files.push(p);
  }
})(join(SRC, "components"));

// Each opening <a …> tag, read brace- and quote-aware, so a `=>` or a `>` in
// an expression does not end it.
function anchorTags(src) {
  const out = [];
  const re = /<a\s/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0;
    let quote = null;
    let i = m.index + 2;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) { if (ch === quote && src[i - 1] !== "\\") quote = null; continue; }
      if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

const BUTTON_STYLE = /style=\{mk(Btn|SolidBtn|DangerBtn|DangerConfirm)\(/;

describe("a link drawn as a button", () => {
  const found = files.flatMap((f) => anchorTags(stripComments(readFileSync(f, "utf8")).join("\n"))
    .filter((tag) => BUTTON_STYLE.test(tag))
    .map((tag) => ({ file: f.slice(SRC.length + 1), tag })));

  it("is found (the sweep is not vacuous): the photo viewer's Save photo", () => {
    expect(found.map((x) => x.file)).toContain("components/whatsapp/PhotoViewer.jsx");
  });

  it("is border-box, so its minimum height is the button's and not its content's", () => {
    for (const { file, tag } of found) expect(tag, file).toMatch(/boxSizing: "border-box"/);
  });

  it("the viewer's footer row centres its buttons, so one never stretches the other", () => {
    const viewer = stripComments(readFileSync(join(SRC, "components/whatsapp/PhotoViewer.jsx"), "utf8")).join("\n");
    expect(viewer).toMatch(/const footer = \(\s*<div style=\{\{ display: "flex", justifyContent: "flex-end", alignItems: "center",/);
  });
});
