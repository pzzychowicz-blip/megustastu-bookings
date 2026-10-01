// tests/recurring.test.js
//
// v18.3.3 — standing (weekly) bookings.
//
// B2: "Repeat weekly" wrote its rule BEFORE the new-booking save's capacity
// refusals, so a refused save left the rule behind, the generator then created
// the booking the form had just refused, and every further tap on Save added
// another rule. Measured on DEV before the fix: one refused save plus Confirm on
// the "Kitchen may be busy" its generated booking raised = two rules. There is
// no DOM test environment here (tests/CLAUDE.md), so the save's ORDER is pinned
// by reading `doSaveNew` with its comments stripped.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const APP = stripComments(
  readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).join("\n");

// The body of `doSaveNew`, from its declaration to the next top-level function.
function doSaveNewBody() {
  const start = APP.indexOf("function doSaveNew(");
  const end = APP.indexOf("function doSave(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
}

describe("Repeat weekly writes its rule only once the save cannot be refused (B2)", () => {
  it("calls addRule exactly once in doSaveNew", () => {
    expect(doSaveNewBody().split("addRule(").length - 1).toBe(1);
  });

  it("calls it after every refusal and before the booking write", () => {
    const body = doSaveNewBody();
    const rule = body.indexOf("addRule(");
    const lastRefusal = body.lastIndexOf("setError(");
    const write = body.indexOf("saveBookings(");
    expect(lastRefusal).toBeGreaterThan(-1);
    expect(rule).toBeGreaterThan(lastRefusal);
    expect(write).toBeGreaterThan(rule);
  });

  it("stamps the first occurrence with the id the rule is written under", () => {
    const body = doSaveNewBody();
    expect(body).toMatch(/addRule\(\{id:recStampId,/);
    expect(body).toMatch(/recurringId:recStampId/);
  });
});
