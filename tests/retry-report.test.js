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
import { goneRefusal, applyEdit } from "../src/lib/booking-save.js";
import { replayOutcome, tellDiscarded } from "../src/lib/write-path.js";
import { EMPTY_FORM } from "../src/lib/constants.js";

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
    // Added to a warning already on screen, never over it: the slot is one string.
    expect(DRAIN).toMatch(/if\(refusals\.length\)\{[\s\S]*setWriteWarning\(function\(was\)\{[\s\S]*return fresh\.length\?\(was\?was\+" ":""\)\+fresh\.join\(" "\):was;/);
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
    expect(fn).toContain("LANDED.has(report)");
    expect(HOOK, "one set for the module, not one per render").toMatch(/^const LANDED=new WeakSet\(\);$/m);
    expect(fn).toMatch(/try\{report\.onLanded\(\);\}catch/);
  });
});

// ── v18.4.8: the other answer — a write that will never land ────────────────
// `onDiscarded` is how a caller undoes what it did on the promise of the write
// (a waitlist party hidden while its booking was on the way). The rule is that
// every report hears ONE of the two, unless the tab goes away first.
describe("tellDiscarded — once per report, and never after it landed", () => {
  const sets = () => [new WeakSet(), new WeakSet()];
  it("calls onDiscarded once", () => {
    const [landed, discarded] = sets();
    let n = 0;
    const report = { onDiscarded: () => { n++; } };
    expect(tellDiscarded(report, landed, discarded)).toBe(true);
    expect(tellDiscarded(report, landed, discarded)).toBe(false);
    expect(n).toBe(1);
  });
  it("says nothing for a report that landed", () => {
    const [landed, discarded] = sets();
    let n = 0;
    const report = { onDiscarded: () => { n++; } };
    landed.add(report);
    expect(tellDiscarded(report, landed, discarded)).toBe(false);
    expect(n).toBe(0);
  });
  it("is quiet for no report, and for one with nothing to say", () => {
    const [landed, discarded] = sets();
    expect(tellDiscarded(undefined, landed, discarded)).toBe(false);
    expect(tellDiscarded({ onLanded() {} }, landed, discarded)).toBe(false);
  });
  it("swallows a throw, so the items behind it are still told", () => {
    const [landed, discarded] = sets();
    expect(() => tellDiscarded({ onDiscarded() { throw new Error("x"); } }, landed, discarded)).not.toThrow();
  });
});

describe("the hook tells it wherever a write is dropped", () => {
  const DISCARD = body("discardParked", "function clearStale(");
  it("Discard on the parked banner tells every item it drops", () => {
    expect(DISCARD).toContain("items.forEach(function(it){tellDiscarded(it.report,LANDED,DISCARDED);});");
    expect(HOOK).toMatch(/^const DISCARDED=new WeakSet\(\);$/m);
  });
  it("a replay its caller refuses", () => {
    expect(DRAIN).toContain('else if(d.action==="refuse"){refusals.push(d.message);tellDiscarded(item.report,LANDED,DISCARDED);}');
  });
  it("a write held or rejected with no place in the queue: each of the three doors queues it or says so", () => {
    expect(SAVE).toContain("function dropped(){tellDiscarded(report,LANDED,DISCARDED);}");
    // Each door, with its own `else` on the line after its push. The stale
    // gate's push sits in a block (the optimistic show follows it), so its
    // `else` follows the block's last statement; the other two are one-liners.
    expect(SAVE).toMatch(/pendingRetriesRef\.current\.push\(item\);[\s\S]*?setBookings\(computedHeld\);\s*\}\s*else dropped\(\);\s*markStale\(\);\s*return false;/);
    const oneLiners = SAVE.match(/if\(typeof next==="function"&&!isSilent\) pendingRetriesRef\.current\.push\(\{fn:next,[^}]*\}\);\s*else dropped\(\);\s*markStale\(\);/g) || [];
    expect(oneLiners.length, "the legacy-shape hold and the rejection").toBe(2);
    expect((SAVE.match(/else dropped\(\);/g) || []).length).toBe(3);
  });
  it("and the two outright refusals (not loaded, the empty array)", () => {
    const refusals = SAVE.match(/dropped\(\);\s+dispatched=false;return;/g) || [];
    expect(refusals.length).toBe(2);
  });
  it("a write parked or handed back to the queue is told nothing", () => {
    const RETRY = body("retryParked", "function discardParked(");
    expect(RETRY).not.toContain("tellDiscarded");
    expect(DRAIN.match(/tellDiscarded/g).length, "the refusal alone, not the park").toBe(1);
  });
});

// A refused patch is not "the same write" to skip. Measured on DEV with the
// write forced to reject, before this: ONE rejection, no retry, no parked
// banner, and the booking drawn from local state with nothing on the server —
// the replay built an identical patch 40ms later and returned at the dedupe.
// After it: four attempts, then the parked banner.
describe("a rejected write disarms the duplicate-patch window", () => {
  it("in the catch, and only if the signature is still this patch's", () => {
    const caught = SAVE.slice(SAVE.indexOf("}).catch("));
    const clear = caught.indexOf('if(lastPatchSigRef.current.sig===sig) lastPatchSigRef.current={sig:"",at:0};');
    const queue = caught.indexOf("pendingRetriesRef.current.push(");
    expect(clear).toBeGreaterThan(-1);
    expect(queue, "cleared before the write is queued for its replay").toBeGreaterThan(clear);
  });
});

// ── A change replayed after its booking was deleted on another device ────────
const APP = stripComments(
  readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).join("\n");
const row = (o) => Object.assign({ id: "a", name: "Rita", date: "2099-06-15", time: "21:00", size: 2, duration: 90, status: "confirmed", tables: ["2"], history: [] }, o);

describe("goneRefusal — the sentence a replay shows for a booking that is gone", () => {
  it("is null while the booking is in the fresh list", () => {
    expect(goneRefusal("a", [row()])([row({ name: "Renamed" })])).toBe(null);
  });
  it("names the booking as it was when the action was taken", () => {
    expect(goneRefusal("a", [row()])([row({ id: "b" })]))
      .toBe("The change to Rita, 21:00 was not saved: the booking was deleted on another device.");
  });
  it("still has a sentence for a booking it could not name", () => {
    expect(goneRefusal("zz", [])([])).toBe("The change to a booking was not saved: the booking was deleted on another device.");
    expect(goneRefusal("a", [row({ name: "", time: "" })])([])).toContain("to a booking was");
  });
  it("is what the queue drops the write on, parked or not", () => {
    const report = { replayRefusal: goneRefusal("a", [row()]) };
    expect(replayOutcome({ tries: 0, report }, [row()]).action).toBe("retry");
    expect(replayOutcome({ tries: 0, report }, []).action).toBe("refuse");
    expect(replayOutcome({ tries: 99, report }, []).action).toBe("refuse");
  });
});

describe("the form's edit carries it", () => {
  it("applyEdit's plan has a replayRefusal for the booking it edits", () => {
    const list = [row()];
    const draft = Object.assign({}, EMPTY_FORM, list[0], { notes: "window seat" });
    const plan = applyEdit({ list, live: list, id: "a", draft, blocks: [], swap: null, autoOptimizer: false, today: "2099-06-01", nowMins: 600, phonePrefix: "+34", getUser: () => "t" });
    expect(plan.refusal).toBeUndefined();
    expect(plan.replayRefusal(list)).toBe(null);
    expect(plan.replayRefusal([])).toContain("Rita, 21:00");
    // And the replay itself is why it is needed: on a list without the
    // booking the write changes nothing for it.
    expect(plan.next([]).some((b) => b.id === "a")).toBe(false);
  });
});

// Every change to ONE booking. A new such writer joins this list or says why
// not; the count below fails when a `saveBookings` call is added to App.
describe("every single-booking write in App hands saveBookings the report", () => {
  const calls = APP.match(/saveBookings\(/g) || [];
  const WITH = [
    ["the form's edit", "saveBookings(plan.next,false,{replayRefusal:plan.replayRefusal})"],
    ["reassign", "},false,goneReport(id));\n    setError(\"\");"],
    ["the timeline drop", "saveBookings(plan.transform,false,goneReport(id))"],
    ["a status change", /\},false,goneReport\(id\)\);\s+if\(ok&&\(status==="completed"\|\|status==="seated"\)\)/],
    ["the voucher carry", "},false,goneReport(c.to));"],
    ["cancel and no-show", "saveBookings(cancelMemo,false,goneReport(id))"],
    ["manual assign", "saveBookings(plan.transform,false,goneReport(bookingId))"],
  ];
  WITH.forEach(([what, code]) => it(what, () => (
    typeof code === "string" ? expect(APP).toContain(code) : expect(APP).toMatch(code))));
  it("goneReport is goneRefusal on the list the action was taken on", () => {
    expect(APP).toContain("function goneReport(id){return {replayRefusal:goneRefusal(id,bookings)};}");
  });
  it("and the rest are decided: 17 calls, 7 with it, 1 with onLanded", () => {
    // Without: reconciliation and recurring generation (silent, never
    // queued), delete customer and force reshuffle (many bookings), delete
    // (a booking already gone is the delete done), complete-and-seat's first
    // write (several parties), undo (it puts bookings back), add / remove
    // block (the day, not a booking). The new booking carries `onLanded`.
    expect(calls.length).toBe(17);
    expect((APP.match(/goneReport\(/g) || []).length - 1, "uses, less the declaration").toBe(6);
  });
});

