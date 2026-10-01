// tests/form-error.test.js
//
// v18.3.3 (B6): the booking form's save error is cleared by an effect watching
// the fields it can be about. It watched seven, so an error whose remedy was
// outside them stayed up after the remedy. Measured on DEV: "A seated booking
// can't be moved to another date — change the status first." outlived the
// status change it asks for. No DOM environment here (tests/CLAUDE.md), so the
// effect's dependency list is read from App.jsx with its comments stripped.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const APP = stripComments(
  readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).join("\n");

function clearDeps() {
  const m = APP.match(/useEffect\(function\(\)\{if\(error\)\{setError\(""\);setErrorField\(null\);\}\},\[([^\]]*)\]\)/);
  expect(m).not.toBe(null);
  return m[1].split(",").map((s) => s.trim());
}

describe("the stale-error effect watches every field a save error is about", () => {
  it("keeps the seven it had", () => {
    expect(clearDeps()).toEqual(expect.arrayContaining(
      ["form.name", "form.phone", "form.time", "form.size", "form.date", "form.preference", "form.customDur"]));
  });
  it("adds status, the hand-picked tables, Clear and the preferred tables", () => {
    expect(clearDeps()).toEqual(expect.arrayContaining(
      ["form.status", "form.manualTables", "form._clearManual", "form.preferredTables"]));
  });
  it("never watches the error itself, or each error would clear as it is set", () => {
    expect(clearDeps()).not.toContain("error");
  });
});
