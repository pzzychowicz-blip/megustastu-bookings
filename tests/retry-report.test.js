// tests/retry-report.test.js — v18.4.6, the report a bookings write carries.
//
// `saveBookings` returns its boolean at the dispatch; a held or rejected write
// is settled later, by the retry queue. The `report` is how a caller hears
// about that (`onLanded`, `replayRefusal`), and it only works if it rides with
// the write through EVERY door into the queue. There are three, written out
// three times, and no test executes the hook, so this reads it.
//
// Read STRIPPED (tests/test-hygiene.test.js): the hook's comments describe all
// of this in prose.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const HOOK = stripComments(
  readFileSync(new URL("../src/hooks/usePersistence.js", import.meta.url), "utf8")).join("\n");

function body(name, endMarker) {
  const start = HOOK.indexOf("function " + name + "(");
  const end = HOOK.indexOf(endMarker, start);
  expect(start, name).toBeGreaterThan(-1);
  expect(end, name + " end").toBeGreaterThan(start);
  return HOOK.slice(start, end);
}
const SAVE = body("saveBookings", "function saveBlocks(");
const DRAIN = body("drainPending", "function resync(");

describe("a queued bookings write keeps its report", () => {
  it("every item built for the queue carries it", () => {
    const items = SAVE.match(/\{fn:next,[^}]*\}/g) || [];
    expect(items.length, "the stale gate, the legacy-shape hold and the rejection").toBe(3);
    items.forEach((it) => expect(it).toContain("report:report"));
  });
  it("a replay hands it back to saveBookings, in the report's position", () => {
    expect(SAVE).toMatch(/^function saveBookings\(next,isSilent,report,tryN,carriedLabel\)/);
    expect(DRAIN).toContain("saveBookings(item.fn,false,item.report,d.tries,item.label)");
  });
  it("the drain asks replayOutcome on the mirror, and shows what it refuses", () => {
    expect(DRAIN).toContain("replayOutcome(item,bookingsRef.current)");
    expect(DRAIN).toMatch(/if\(refusals\.length\) setWriteWarning\(/);
  });
});

describe("onLanded fires for a write the server has, and only then", () => {
  it("after the update resolves, ahead of its catch", () => {
    const write = SAVE.indexOf('update(ref(db,"bookings"),patch).then(');
    const landed = SAVE.indexOf("landed();", write);
    const caught = SAVE.indexOf("}).catch(", write);
    expect(write).toBeGreaterThan(-1);
    expect(landed).toBeGreaterThan(write);
    expect(caught, "a .catch-handled promise fulfils: landed() below it would run for a refusal").toBeGreaterThan(landed);
  });
  it("and for a replay with nothing left to write", () => {
    expect(SAVE).toMatch(/if\(!Object\.keys\(patch\)\.length\)\{landed\(\);return;\}/);
  });
  it("not for a patch skipped as a duplicate, whose twin reports", () => {
    expect(SAVE).toMatch(/if\(isDuplicatePatch\(sig,lastPatchSigRef\.current,nowMs\)\) return;/);
  });
  it("once per report, and a throw in it cannot reach the write's catch", () => {
    const fn = SAVE.slice(SAVE.indexOf("function landed("), SAVE.indexOf("if(isStaleGap("));
    expect(fn).toContain("landedRef.current.has(report)");
    expect(fn).toMatch(/try\{report\.onLanded\(\);\}catch/);
  });
});
