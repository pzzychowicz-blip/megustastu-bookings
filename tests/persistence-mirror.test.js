// tests/persistence-mirror.test.js — the ref-mirror invariant in usePersistence.js.
//
// Since v17.16.10 (CT-2A-09) a save computes from the `bookingsRef` / `blocksRef`
// mirrors instead of inside a setState updater. The file states the one thing
// that can break it: every `setBookings` / `setTableBlocks` must assign its mirror
// on the line above, or the NEXT save diffs against a stale `prev` — and a diff
// that sees fields "changing back" writes them. That is stale data reaching the
// server, the failure this repo has lost production data to twice.
//
// Until the 2026-09-23 tech-debt scan the invariant was held by prose alone: the
// hook is executed by no test, and nothing read the file for it. This reads it.
//
// Read STRIPPED (tests/test-hygiene.test.js): the file's own header describes the
// invariant in prose that names both setters, and a raw read would match that.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "usePersistence.js");

const MIRROR = { setBookings: "bookingsRef", setTableBlocks: "blocksRef" };

// The argument of the call starting at `open` (the index of its "("), by paren
// balancing; null if it does not close on this line.
function callArg(line, open) {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")" && --depth === 0) return line.slice(open + 1, i).trim();
  }
  return null;
}

// Every setter call in `text`, each with a verdict: the statement just before it
// — earlier on the same line, or else the previous non-blank line once comments
// are stripped — must assign the MATCHING mirror to the SAME value.
function checkMirrors(text) {
  const lines = stripComments(text);
  const out = [];
  lines.forEach((line, idx) => {
    const re = /\b(setBookings|setTableBlocks)\(/g;
    let m;
    while ((m = re.exec(line))) {
      const setter = m[1];
      const arg = callArg(line, m.index + setter.length);
      let before = line.slice(0, m.index).trim();
      if (!before) {
        for (let j = idx - 1; j >= 0; j--) {
          if (lines[j].trim()) { before = lines[j].trim(); break; }
        }
      }
      const statements = before.split(";").map((s) => s.trim()).filter(Boolean);
      const last = statements[statements.length - 1] || "";
      const assign = last.match(/^([A-Za-z_$][\w$]*)\.current\s*=\s*(.+)$/);
      const ok = !!assign && assign[1] === MIRROR[setter] && assign[2].trim() === arg;
      out.push({ line: idx + 1, setter, arg, before: last, ok });
    }
  });
  return out;
}

describe("usePersistence.js — every set site assigns its mirror first", () => {
  const sites = checkMirrors(readFileSync(FILE, "utf8"));

  it("finds the set sites at all (a scanner that finds nothing proves nothing)", () => {
    expect(sites.filter((s) => s.setter === "setBookings").length).toBeGreaterThan(0);
    expect(sites.filter((s) => s.setter === "setTableBlocks").length).toBeGreaterThan(0);
  });

  it("each setBookings / setTableBlocks is preceded by `<mirror>.current = <same value>`", () => {
    const bad = sites.filter((s) => !s.ok).map((s) => `L${s.line} ${s.setter}(${s.arg}) after "${s.before}"`);
    expect(bad, "a set site without its mirror hands the next save a stale prev").toEqual([]);
  });
});

describe("the checker itself — proven against known-bad input", () => {
  const verdicts = (src) => checkMirrors(src).map((s) => s.ok);

  it("accepts the house shape, on the previous line or earlier on the same line", () => {
    expect(verdicts("bookingsRef.current=bArr;\nsetBookings(bArr);")).toEqual([true]);
    expect(verdicts("blocksRef.current=tArr; setTableBlocks(tArr);")).toEqual([true]);
    expect(verdicts("bookingsRef.current=x;\n// a comment is not a statement\nsetBookings(x);")).toEqual([true]);
  });

  it("refuses a set site with no mirror assignment before it", () => {
    expect(verdicts("const y=1;\nsetBookings(x);")).toEqual([false]);
    expect(verdicts("setTableBlocks(bl);")).toEqual([false]);
  });

  it("refuses a mirror assigned a DIFFERENT value", () => {
    expect(verdicts("bookingsRef.current=a;\nsetBookings(b);")).toEqual([false]);
  });

  it("refuses the WRONG mirror", () => {
    expect(verdicts("blocksRef.current=x;\nsetBookings(x);")).toEqual([false]);
    expect(verdicts("bookingsRef.current=x;\nsetTableBlocks(x);")).toEqual([false]);
  });

  it("refuses an updater function — computing inside setState is the shape v17.16.10 removed", () => {
    expect(verdicts("bookingsRef.current=x;\nsetBookings(function(prev){return x;});")).toEqual([false]);
  });
});
