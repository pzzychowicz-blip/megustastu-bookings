// tests/row-press.test.js
//
// v18.4.0 (Patryk): a button that is a wide ROW answers a press with the tint
// and takes neither the hover lift nor the press dip. Both are proportions of
// the element, so on a row they move its text by tens of pixels (DESIGN.md,
// Press feedback). Each row below is read out of its source, because nothing
// else can see this: check:style accepts any tag marked @no-lift.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { stripComments } from "../scripts/strip-comments.mjs";

function raw(rel) { return readFileSync(new URL("../" + rel, import.meta.url), "utf8"); }
// Comments out first: several of these tags carry a note about the rule.
function read(rel) { return stripComments(raw(rel)).join("\n"); }

// The opening tag that contains `marker`, from its "<button" to its ">".
function tagWith(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const start = src.lastIndexOf("<button", at);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && src[i - 1] !== "=") return src.slice(start, i + 1);
  }
  return null;
}

const ROWS = [
  // file, a piece of CODE only that row's tag holds, what it is
  ["src/components/atoms.jsx", 'width: "calc(100% + 20px)"', "every Collapsible header"],
  ["src/components/SearchPanel.jsx", "onClick={function () { onPick(b); }}", "a Find a booking result"],
  ["src/components/WeekView.jsx", "onClick={function(){ onPick(r.date); }}", "a day in the More popover"],
  ["src/components/PlanView.jsx", "skipExit(); onPick(b);", "a booking in the Plan popover"],
  ["src/components/AdminSettings.jsx", "onClick={function () { onSelect(id); }}", "a person in the Admin tab"],
  ["src/components/ActivityLogModal.jsx", "onOpenCustomer(goneName);", "a booking in the Activity log"],
];

describe("a wide row tints on press and does not move", () => {
  for (const [file, marker, what] of ROWS) {
    it(what + " (" + file + ")", () => {
      const tag = tagWith(read(file), marker);
      expect(tag, "the row's tag").not.toBeNull();
      expect(tag).toMatch(/className="mgt-ac-row mgt-nopress"/);
      expect(tag).not.toMatch(/mgt-hover-scale/);
      // The tint is `background-color` on the class; an inline `background`
      // beats it and the row would answer nothing (`background: undefined`
      // clears mkBtn's own and sets none).
      expect(tag.replace(/background: undefined/g, "")).not.toMatch(/[^-]background:/);
      expect(tag).toMatch(/"--row-bg":/);
      expect(tag).toMatch(/"--row-bg-hover":/);
    });
  }

  it("the Summary's headline button does not dip either", () => {
    const tag = tagWith(read("src/components/Summary.jsx"), "aria-expanded={open}");
    expect(tag, "the headline button").not.toBeNull();
    expect(tag).toMatch(/className="mgt-nopress"/);
  });

  it("the press rules still honour the opt-out", () => {
    const css = raw("src/index.css");
    expect(css).toMatch(/button:active:not\(:disabled\):not\(\.mgt-nopress\)/);
    expect(css).toMatch(/\.mgt-ac-row:active:not\(:disabled\)\s*\{\s*background-color/);
  });
});

describe("a Collapsible's count and subtitle ease with its body", () => {
  const atoms = read("src/components/atoms.jsx");
  it("each sits in a Reveal, and neither is mounted bare on `open`", () => {
    expect(atoms).toMatch(/<Reveal horizontal show=\{!open\}><span[^>]*>\{summary\}<\/span><\/Reveal>/);
    expect(atoms).toMatch(/<Reveal show=\{open\}><div[^>]*>\{subtitle\}<\/div><\/Reveal>/);
    expect(atoms).not.toMatch(/\{!open && summary \?/);
    expect(atoms).not.toMatch(/\{open && subtitle \?/);
  });
});
