// tests/empty-day.test.js — v18.2.0: the empty-day prompt waits for the data.
//
// `isEmptyDay` (App.jsx) is the ONE answer all three views read. Before the
// first bookings snapshot lands, `bookings` is `[]` whatever the database holds,
// so an ungated derivation says "Nothing booked for this day yet." — with New
// booking / Walk-in buttons — on every cold start, beside the "Loading
// bookings…" pill that contradicts it. Measured on DEV before the fix: both
// were on screen together for the whole first read.
//
// The component tree is not rendered in this suite (tests/CLAUDE.md), so this
// reads the derivation out of App.jsx, STRIPPED (tests/test-hygiene.test.js):
// the comment above it names `bookingsReady`, and a raw read would match that.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "App.jsx");
// stripComments returns LINES (comments blanked, line numbers kept).
const src = stripComments(readFileSync(APP, "utf8")).join("\n");

// The body and dep array of `const isEmptyDay=useMemo(function(){ … },[…]);`
function isEmptyDayMemo() {
  const start = src.indexOf("const isEmptyDay=useMemo(");
  expect(start, "isEmptyDay useMemo not found").toBeGreaterThan(-1);
  const end = src.indexOf("]);", start);
  return src.slice(start, end + 3);
}

describe("isEmptyDay waits for the first bookings snapshot", () => {
  it("returns false before bookingsReady, as its FIRST statement", () => {
    const memo = isEmptyDayMemo();
    const body = memo.slice(memo.indexOf("{") + 1).trim();
    expect(body.startsWith("if(!bookingsReady) return false;")).toBe(true);
  });

  it("re-derives when bookingsReady flips", () => {
    const deps = isEmptyDayMemo().match(/\},\[([^\]]*)\]\);$/);
    expect(deps).not.toBeNull();
    expect(deps[1].split(",").map((s) => s.trim())).toContain("bookingsReady");
  });

  it("is the only thing the three views are handed as isEmpty", () => {
    const passes = src.match(/isEmpty=\{([^}]*)\}/g) || [];
    expect(passes.length).toBe(3);
    for (const p of passes) expect(p).toBe("isEmpty={isEmptyDay}");
  });
});
