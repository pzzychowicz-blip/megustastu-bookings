// tests/clock-reads.test.js
//
// v18.15.0 — every reading of an instant as a wall clock goes through
// `src/lib/day.js`, and nothing else in src/ or api/ asks the DEVICE.
//
// Before this version, ~33 sites read `getHours()` / `getDate()` /
// `toLocaleTimeString()` on the device's own zone, which is the restaurant's
// only while the device is in the restaurant. A phone in Poland drew the
// now-line an hour late and auto-extend wrote the hour into seated parties.
// `day.js`'s `wallClock` now answers in the restaurant's zone, and this guard is
// what keeps a 34th site from appearing: a local getter, a local setter, a
// locale date/time format with no `timeZone`, an `Intl.DateTimeFormat` with no
// `timeZone`, or `new Date().toISOString().slice(0, 10)` (UTC's today, the
// v17.16.2 defect) anywhere outside day.js fails it.
//
// Date-only strings are a different matter and are NOT what this catches: a
// "YYYY-MM-DD" parses as UTC midnight and is stepped with `getUTC*`, which is
// correct in every zone (day.js's header). Those calls are `getUTCDay()` etc.,
// which none of the patterns below match.
//
// Comments are stripped first, because the prose about these calls is the
// hazard: half the matches in a raw grep are sentences explaining why the call
// is gone.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The shapes. Each is matched on comment-stripped source.
const SHAPES = {
  "local getter": /\.(getHours|getMinutes|getSeconds|getDate|getDay|getMonth|getFullYear)\(\)/g,
  "local setter": /\.(setHours|setMinutes|setSeconds|setDate|setMonth|setFullYear)\(/g,
  "locale date/time without timeZone": /\.toLocale(?:Date|Time)String\((?![^)]*timeZone)[^)]*\)/g,
  "Date.toLocaleString without timeZone": /new Date\([^)]*\)\.toLocaleString\((?![^)]*timeZone)[^)]*\)/g,
  "Intl.DateTimeFormat without timeZone": /Intl\.DateTimeFormat\((?![^)]*timeZone)[^)]*\)/g,
  "UTC today": /new Date\(\)\.toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/g,
};

// The files allowed to keep a match, each with its count and its reason.
// day.js itself is the one place the device's clock is read on purpose.
const ALLOWED = {
  "src/lib/day.js": "the one reader: `wallClock`'s device fallback and `deviceTimeZone`",
};

function hitsIn(src) {
  const out = {};
  for (const [name, re] of Object.entries(SHAPES)) {
    const n = (src.match(re) || []).length;
    if (n) out[name] = n;
  }
  return out;
}

describe("the guard sees each shape", () => {
  it("matches every shape it names, and leaves the UTC and number forms alone", () => {
    expect(hitsIn("d.getHours()*60+d.getMinutes()")).toEqual({ "local getter": 2 });
    expect(hitsIn("d.setHours(23, 59, 59, 999)")).toEqual({ "local setter": 1 });
    expect(hitsIn('d.toLocaleTimeString("en-GB", { hour: "2-digit" })')).toEqual({ "locale date/time without timeZone": 1 });
    expect(hitsIn('new Date(at).toLocaleString("en-GB")')).toEqual({ "Date.toLocaleString without timeZone": 1 });
    expect(hitsIn('new Intl.DateTimeFormat("en-GB", { hour: "numeric" })')).toEqual({ "Intl.DateTimeFormat without timeZone": 1 });
    expect(hitsIn("new Date().toISOString().slice(0, 10)")).toEqual({ "UTC today": 1 });
    // What must NOT match: date-only arithmetic, an explicit zone, and numbers.
    expect(hitsIn("new Date(dateStr).getUTCDay(); d.setUTCDate(d.getUTCDate() + 1)")).toEqual({});
    expect(hitsIn('d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })')).toEqual({});
    expect(hitsIn('new Date(s).toLocaleString("en-GB", { month: "long", timeZone: "UTC" })')).toEqual({});
    expect(hitsIn('FREE_TIER_MONTHLY.toLocaleString("en-GB")')).toEqual({});
  });
});

describe("no clock read outside lib/day.js", () => {
  it("src/ and api/ ask day.js for the restaurant's clock", () => {
    const found = {};
    for (const top of ["src", "api"]) {
      (function walk(dir) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.(js|jsx|mjs)$/.test(e.name)) {
            const rel = p.slice(ROOT.length + 1);
            if (Object.prototype.hasOwnProperty.call(ALLOWED, rel)) continue;
            const h = hitsIn(stripComments(readFileSync(p, "utf8")).join("\n"));
            if (Object.keys(h).length) found[rel] = h;
          }
        }
      })(join(ROOT, top));
    }
    expect(found).toEqual({});
  });

  it("every allowed file still exists, so the list cannot outlive its reason", () => {
    for (const rel of Object.keys(ALLOWED)) {
      expect(() => readFileSync(join(ROOT, rel), "utf8"), rel).not.toThrow();
    }
  });
});
