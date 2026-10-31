// tests/write-gate.test.js — v18.13.0 (#25)
//
// ── CHARACTERIZATION: what the write gates DO, pinned before they move ───────
// The 2026-10-30 scan's top item. `lib/write-path.js` tests the arithmetic, but the
// ORDER of the gates lived inline in `saveBookings` and `persist`, in a hook no test
// executes, and no test of the bookings path mentioned `Refused to write` or
// `firstLoadCount`. The server cannot catch a mistake there either: `/bookings/$bid`
// allows a delete with no CAS (tests/rules/database-rules.test.js), so with
// `enforceRoles` on a manager's or admin's session is held back from wiping the
// bookings by the client's empty-array check and nothing else.
//
// So this file runs the hook's OWN code, the way tests/save-path.test.js runs App's:
// `saveBookings`, `saveBlocks` and the queue around them are lifted out of the
// comment-stripped source (tests/lift.js) and compiled in one scope with the real
// lib modules, the refs as plain objects, and recorded stubs for the two things
// that cannot run here: React's setters and Firebase. `revGuard.js` is the one lib
// replaced, because it imports `firebase.js`, and what it does is tested on its own.
// A gate is set by setting its ref, which is what no DOM test could have reached.
//
// Each scenario pins everything the call did, in order, and what it left behind.
//
// ── THE RULE THAT MAKES IT WORTH HAVING ─────────────────────────────────────
// The scenarios were written and their snapshots taken against v18.12.1's hook, in
// a commit of their own, before `writeGate` existed. Moving the decision moved no
// line of them. **A snapshot here that moves is a behaviour change**, a finding to
// explain and never an expectation to update, so never run this file with `-u` to
// make a change pass.
//
// Reading those snapshots is how the two defects below were found, and fixing them
// moved the lines they name, by hand, in commits of their own (Patryk's call). What a
// refusal did to the screen moved in the not-loaded and empty scenarios, and what a
// block's refusal answers moved in `saveBlocks`' not-loaded one.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { liftFunction, compiler, freeNames, importScope } from "./lift.js";
import * as bookingLogic from "../src/lib/booking-logic.js";
import * as activity from "../src/lib/activity.js";
import * as activitySink from "../src/lib/activitySink.js";
import * as dbErrorLib from "../src/lib/dbError.js";
import * as schema from "../src/lib/schema.js";
import * as writePath from "../src/lib/write-path.js";
import { appCode } from "./app-source.js";

const HOOK = stripComments(
  readFileSync(new URL("../src/hooks/usePersistence.js", import.meta.url), "utf8")).join("\n");

// The write and the queue around it. `resync` is lifted too, so a held write can be
// followed all the way to the server rather than stopping at a stub.
const LIFTED_NAMES = [
  "syncParked", "retryParked", "discardParked", "clearStale", "drainPending",
  "resync", "markStale", "gapTrip", "saveBookings", "saveBlocks",
];
const LIFTED = LIFTED_NAMES.map((n) => liftFunction(HOOK, n));

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

// A stored `/bookings` node. The rows the app holds are what `sanitizeAll` makes of
// it, as they are on every device, so a replay on fresh data diffs like the real one.
const STORED = {
  a: { id: "a", name: "Rita", date: "2026-10-31", time: "20:00", size: 2, duration: 90, status: "confirmed", tables: ["3"], updatedAt: 100 },
  b: { id: "b", name: "Pau", date: "2026-10-31", time: "21:00", size: 4, duration: 90, status: "confirmed", tables: ["4"], updatedAt: 200 },
};
const BLOCK = { id: "x", table: "1", date: "2026-10-31", from: "13:00", to: "14:00" };

const rowsOf = (list) => (list || []).map((b) => b.id + ":" + b.size).join(" ") || "(none)";
const patchLine = (patch) => Object.keys(patch).sort()
  .map((id) => id + "=" + (patch[id] === null ? "null" : patch[id].size + " base " + patch[id].baseUpdatedAt)).join(" ");

const LIB = (writeWithRev) => ({
  "booking-logic": bookingLogic,
  "activity": activity,
  "activitySink": activitySink,
  "dbError": dbErrorLib,
  "schema": schema,
  "write-path": writePath,
  "revGuard": { writeWithRev },
});

// One device, with the gates as the test wants them.
//   on       the gates that are shut, by name (`GATES` below)
//   server   what a `get()` answers; the stored node unless a scenario says
//   answers  how each `update()` is answered, in order; "ok" past the end
//   online   `.info/connected`: off by default, so a resync stops at its first line
function harness(o = {}) {
  const on = new Set(o.on || []);
  const log = [];
  const h = { log, warning: null, parked: [], server: Object.assign({ bookings: STORED, tableBlocks: [BLOCK], tableBlocksRev: 7 }, o.server) };
  const answers = (o.answers || []).slice();
  const rows = bookingLogic.sanitizeAll(STORED);
  if (on.has("schema")) schema.setStoredSchema(schema.SCHEMA + 1);
  h.refs = {
    bookingsRef: { current: rows },
    blocksRef: { current: [BLOCK] },
    bookingsLoaded: { current: !on.has("not-loaded") },
    blocksLoaded: { current: !on.has("not-loaded") },
    firstLoadCount: { current: "firstLoad" in o ? o.firstLoad : (on.has("empty") ? 2 : 0) },
    staleRef: { current: on.has("stale") },
    lastBeatRef: { current: on.has("gap") ? NOW - writePath.STALE_GAP_MS - 1 : NOW },
    isConnectedRef: { current: !!o.online },
    resyncInFlightRef: { current: false },
    lastStampRef: { current: 0 },
    lastPatchSigRef: { current: { sig: "", at: 0 } },
    blocksRevRef: { current: 7 },
    arrayShapeRef: { current: on.has("array-shape") },
    pendingRetriesRef: { current: [] },
    parkedRef: { current: [] },
  };
  const env = Object.assign({}, h.refs, {
    LANDED: new WeakSet(),
    DISCARDED: new WeakSet(),
    db: "db",
    console: { warn: (msg) => log.push("warn: " + msg) },
    ref: (db, path) => path,
    update: (path, patch) => {
      log.push("update " + path + " " + patchLine(patch));
      if ((answers.shift() || "ok") === "ok") return Promise.resolve();
      return Promise.reject(Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }));
    },
    get: (path) => {
      log.push("get " + path);
      return Promise.resolve({ val: () => h.server[path] });
    },
    setBookings: (list) => log.push("setBookings " + rowsOf(list)),
    setTableBlocks: (list) => log.push("setTableBlocks " + list.length),
    setBookingsReady: () => {},
    setResyncing: (v) => log.push("resyncing " + v),
    setWriteWarning: (v) => { h.warning = typeof v === "function" ? v(h.warning) : v; log.push("warning: " + h.warning); },
    setParkedWrites: (fn) => { h.parked = fn(h.parked); },
  });
  const writeWithRev = (path, value, revRef, onReject, onDone) => {
    log.push("writeWithRev " + path + " " + value.length);
    if (o.blocksRefused) onReject(); else onDone();
  };
  h.env = env;
  h.fn = compiler(LIB(writeWithRev))(HOOK, LIFTED, env);
  h.report = {
    subject: "a",
    onLanded: () => log.push("onLanded"),
    onDiscarded: () => log.push("onDiscarded"),
  };
  activitySink.setActivitySink((entries) => log.push("activity " + entries.length));
  return h;
}

// What a call left behind, beside what it did on the way.
const after = (h, returned) => ({
  returned,
  log: h.log.slice(),
  mirror: rowsOf(h.refs.bookingsRef.current),
  queued: h.refs.pendingRetriesRef.current.map((i) => i.tries + " " + i.label),
  parked: h.parked,
  stale: h.refs.staleRef.current,
  warning: h.warning,
});

// A change to booking `a`, as every writer hands one over.
const resize = (prev) => prev.map((b) => (b.id === "a" ? Object.assign({}, b, { size: 6 }) : b));
const flush = () => new Promise((r) => setTimeout(r, 0));

function freeze() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // The real schema gate logs through the real console, once per refusal.
  vi.spyOn(console, "warn").mockImplementation(() => {});
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  schema.resetSchemaGate();
  activitySink.setActivitySink(null);
});

function saveWith(o, next, isSilent) {
  freeze();
  const h = harness(o);
  return after(h, h.fn.saveBookings(next, isSilent, h.report));
}

describe("the harness runs the code it claims to", () => {
  it("every lifted function compiles with every free name bound", () => {
    expect(Object.keys(harness().fn)).toEqual(LIFTED_NAMES);
  });
  it("binds no stub the lifted code does not use", () => {
    const text = LIFTED.join("\n");
    const env = harness().env;
    const imports = importScope(LIB(() => {}), HOOK, text, env);
    const used = new Set(freeNames(text).filter((n) => !(n in imports)));
    expect(Object.keys(env).filter((k) => !used.has(k))).toEqual([]);
  });
  it("refuses to run with a name it cannot bind", () => {
    const env = harness().env;
    delete env.staleRef;
    expect(() => compiler(LIB(() => {}))(HOOK, LIFTED, env)).toThrow(/does not bind: staleRef/);
  });
  it("runs the real schema gate and the real stamp", () => {
    const scope = importScope(LIB(() => {}), HOOK, LIFTED.join("\n"), harness().env);
    expect(scope.writesBlocked).toBe(schema.writesBlocked);
    expect(scope.buildPatch).toBe(writePath.buildPatch);
    expect(scope.isStaleGap).toBe(writePath.isStaleGap);
  });
});

describe("a write with nothing in its way", () => {
  it("sends only what changed, on the base it read, and says true", async () => {
    freeze();
    const h = harness();
    const returned = h.fn.saveBookings(resize, false, h.report);
    await flush();
    expect(after(h, returned)).toMatchInlineSnapshot(`
      {
        "log": [
          "setBookings a:6 b:4",
          "update bookings a=6 base 100",
          "onLanded",
        ],
        "mirror": "a:6 b:4",
        "parked": [],
        "queued": [],
        "returned": true,
        "stale": false,
        "warning": null,
      }
    `);
  });
  it("writes nothing when nothing changed, and that counts as landed", async () => {
    freeze();
    const h = harness();
    const returned = h.fn.saveBookings((prev) => prev, false, h.report);
    await flush();
    expect(after(h, returned)).toMatchInlineSnapshot(`
      {
        "log": [
          "setBookings a:2 b:4",
          "onLanded",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": true,
        "stale": false,
        "warning": null,
      }
    `);
  });
  it("skips an identical patch inside the window, and its twin is the one that reports", async () => {
    freeze();
    const h = harness();
    h.fn.saveBookings(resize, false, h.report);
    h.refs.bookingsRef.current = bookingLogic.sanitizeAll(STORED);
    const returned = h.fn.saveBookings(resize, false, {});
    await flush();
    expect(after(h, returned)).toMatchInlineSnapshot(`
      {
        "log": [
          "setBookings a:6 b:4",
          "update bookings a=6 base 100",
          "setBookings a:6 b:4",
          "onLanded",
        ],
        "mirror": "a:6 b:4",
        "parked": [],
        "queued": [],
        "returned": true,
        "stale": false,
        "warning": null,
      }
    `);
  });
});

describe("the schema gate refuses", () => {
  it("first, says false, and leaves the screen alone", () => {
    expect(saveWith({ on: ["schema"] }, resize, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "onDiscarded",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": false,
        "warning": null,
      }
    `);
  });
});

describe("the freshness gate holds", () => {
  it("a person's change: queued, shown at once, never sent", () => {
    expect(saveWith({ on: ["stale"] }, resize, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] bookings write held — local data may be stale; queued for resync + retry, shown optimistically.",
          "setBookings a:6 b:4",
          "resyncing true",
        ],
        "mirror": "a:6 b:4",
        "parked": [],
        "queued": [
          "0 Rita, 20:00",
        ],
        "returned": false,
        "stale": true,
        "warning": null,
      }
    `);
  });
  it("a heartbeat gap trips it at the write itself, with no heartbeat needed", () => {
    expect(saveWith({ on: ["gap"] }, resize, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "resyncing true",
          "warn: [SAFE] bookings write held — local data may be stale; queued for resync + retry, shown optimistically.",
          "setBookings a:6 b:4",
          "resyncing true",
        ],
        "mirror": "a:6 b:4",
        "parked": [],
        "queued": [
          "0 Rita, 20:00",
        ],
        "returned": false,
        "stale": true,
        "warning": null,
      }
    `);
  });
  it("a value-form write is dropped: a precomputed list replayed is stale data", () => {
    expect(saveWith({ on: ["stale"] }, resize(bookingLogic.sanitizeAll(STORED)), false)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] bookings write held — local data may be stale; queued for resync + retry, shown optimistically.",
          "onDiscarded",
          "resyncing true",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": true,
        "warning": null,
      }
    `);
  });
  it("a silent write is dropped: the auto-effects re-derive theirs", () => {
    expect(saveWith({ on: ["stale"] }, resize, true)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] bookings write held — local data may be stale; queued for resync + retry, shown optimistically.",
          "onDiscarded",
          "resyncing true",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": true,
        "warning": null,
      }
    `);
  });
});

// A refusal is final, so it changes nothing on this device. Until v18.13.0 the mirror
// and the screen moved first: a refused wipe left the device showing no bookings at
// all, with the server untouched and a banner saying it had been refused.
describe("the loaded gate refuses", () => {
  it("a person's change, out loud", () => {
    expect(saveWith({ on: ["not-loaded"] }, resize, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] Refused to write bookings — initial read has not completed yet.",
          "warning: Refused to write: not connected to the server yet. If this persists, reload the page.",
          "onDiscarded",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": false,
        "warning": "Refused to write: not connected to the server yet. If this persists, reload the page.",
      }
    `);
  });
  it("a silent one in the console only", () => {
    expect(saveWith({ on: ["not-loaded"] }, resize, true)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] Refused to write bookings — initial read has not completed yet.",
          "onDiscarded",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": false,
        "warning": null,
      }
    `);
  });
});

describe("the empty-array gate refuses a wipe", () => {
  const wipe = () => [];
  it("of a database that held bookings when it loaded", () => {
    expect(saveWith({ on: ["empty"] }, wipe, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] Refused to write empty bookings array — Firebase had 2 entries on load. This is a safety check against accidental wipe.",
          "warning: Refused to write empty data. Reload the page and try again. If you intended to delete everything, contact support.",
          "onDiscarded",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": false,
        "warning": "Refused to write empty data. Reload the page and try again. If you intended to delete everything, contact support.",
      }
    `);
  });
  it("quietly from an auto-effect", () => {
    expect(saveWith({ on: ["empty"] }, wipe, true)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] Refused to write empty bookings array — Firebase had 2 entries on load. This is a safety check against accidental wipe.",
          "onDiscarded",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": false,
        "warning": null,
      }
    `);
  });
  it("and in value form, the shape the v13 incident wrote", () => {
    expect(saveWith({ on: ["empty"] }, [], true)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] Refused to write empty bookings array — Firebase had 2 entries on load. This is a safety check against accidental wipe.",
          "onDiscarded",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": false,
        "warning": null,
      }
    `);
  });
  it("and the next save still diffs from what is stored", () => {
    freeze();
    const h = harness({ on: ["empty"] });
    expect(h.fn.saveBookings(wipe, false, h.report)).toBe(false);
    expect(h.fn.saveBookings(resize, false, {})).toBe(true);
    expect(h.log.filter((l) => l.startsWith("update "))).toEqual(["update bookings a=6 base 100"]);
    expect(rowsOf(h.refs.bookingsRef.current)).toBe("a:6 b:4");
  });
  it("however many it loaded", () => {
    expect(saveWith({ firstLoad: 1 }, wipe, false).returned).toBe(false);
  });
  it("but deletes the last booking of a database that loaded empty", () => {
    expect(saveWith({ firstLoad: 0 }, wipe, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "setBookings (none)",
          "update bookings a=null b=null",
        ],
        "mirror": "(none)",
        "parked": [],
        "queued": [],
        "returned": true,
        "stale": false,
        "warning": null,
      }
    `);
  });
  it("and before any load has been counted, which the loaded gate answers instead", () => {
    expect(saveWith({ firstLoad: null }, wipe, false).returned).toBe(true);
    expect(saveWith({ firstLoad: null, on: ["not-loaded"] }, wipe, false).returned).toBe(false);
  });
  it("and a list that is not empty passes whatever was loaded", () => {
    expect(saveWith({ firstLoad: 99 }, (prev) => prev.slice(1), false).returned).toBe(true);
  });
});

describe("the legacy array shape holds", () => {
  it("a person's change: queued, and the hook kicks a resync", () => {
    expect(saveWith({ on: ["array-shape"] }, resize, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "setBookings a:6 b:4",
          "warn: [SAFE] bookings write held — legacy array shape, migration to per-booking nodes pending.",
          "resyncing true",
        ],
        "mirror": "a:6 b:4",
        "parked": [],
        "queued": [
          "0 Rita, 20:00",
        ],
        "returned": false,
        "stale": true,
        "warning": null,
      }
    `);
  });
  it("and a silent one is dropped", () => {
    expect(saveWith({ on: ["array-shape"] }, resize, true)).toMatchInlineSnapshot(`
      {
        "log": [
          "setBookings a:6 b:4",
          "warn: [SAFE] bookings write held — legacy array shape, migration to per-booking nodes pending.",
          "onDiscarded",
          "resyncing true",
        ],
        "mirror": "a:6 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": true,
        "warning": null,
      }
    `);
  });
});

// The order. Every combination of shut gates, in every form of write, against the
// first gate in this list on its own: whatever else is shut, the outcome must be
// that one's to the last line. Swap two gates in the code and a combination holding
// both differs. `stale` is left out of the compare: a shut gate is the test's own
// arrangement, and a refusal leaves the flag as it found it.
const GATES = ["schema", "gap", "stale", "not-loaded", "empty", "array-shape"];
const combinations = (names) => Array.from({ length: 1 << names.length }, (_, mask) => names.filter((_, i) => mask & (1 << i)));
const outcome = (r) => Object.assign({}, r, { stale: null });

describe("whichever gates are shut, the first in order answers alone", () => {
  // Always a wipe, so the empty gate has something to refuse when it is shut; the
  // gate is shut by `firstLoadCount`, which is what makes a wipe a wipe.
  const FORMS = [
    ["a person's write", () => [], false],
    ["a silent write", () => [], true],
    ["a value-form write", [], false],
    ["a silent value-form write", [], true],
  ];
  FORMS.forEach(([what, next, silent]) => it(what, () => {
    combinations(GATES).forEach((shut) => {
      const first = GATES.find((g) => shut.includes(g));
      schema.resetSchemaGate();
      const all = saveWith({ on: shut }, next, silent);
      schema.resetSchemaGate();
      const alone = saveWith({ on: first ? [first] : [] }, next, silent);
      expect(outcome(all), shut.join(" + ") || "(no gate shut)").toEqual(outcome(alone));
    });
  }));
  it("and the combinations did reach all three answers", () => {
    const outcomes = new Set(combinations(GATES).map((shut) => {
      schema.resetSchemaGate();
      const r = saveWith({ on: shut }, () => [], false);
      return r.returned + " " + r.log.some((l) => l.startsWith("update ")) + " " + (r.queued.length > 0);
    }));
    expect(Array.from(outcomes).sort()).toEqual(["false false false", "false false true", "true true false"]);
  });
});

describe("a rejected write", () => {
  it("goes back on the queue, disarms the dedupe and asks for fresh data", async () => {
    freeze();
    const h = harness({ answers: ["refuse"] });
    const returned = h.fn.saveBookings(resize, false, h.report);
    await flush();
    expect(after(h, returned)).toMatchInlineSnapshot(`
      {
        "log": [
          "setBookings a:6 b:4",
          "update bookings a=6 base 100",
          "warn: [SAFE] bookings write REJECTED — PERMISSION_DENIED: denied — a Security Rule refused it, and the error does not say which: a stale CAS base (baseUpdatedAt / <node>Rev), a failed field .validate, or rules that have not been deployed all arrive as this one code. Resyncing + retry.",
          "resyncing true",
        ],
        "mirror": "a:6 b:4",
        "parked": [],
        "queued": [
          "0 Rita, 20:00",
        ],
        "returned": true,
        "stale": true,
        "warning": null,
      }
    `);
    expect(h.refs.lastPatchSigRef.current).toEqual({ sig: "", at: 0 });
  });
  it("is dropped if it was silent", async () => {
    freeze();
    const h = harness({ answers: ["refuse"] });
    const returned = h.fn.saveBookings(resize, true, h.report);
    await flush();
    expect(after(h, returned)).toMatchInlineSnapshot(`
      {
        "log": [
          "setBookings a:6 b:4",
          "update bookings a=6 base 100",
          "warn: [SAFE] bookings write REJECTED — PERMISSION_DENIED: denied — a Security Rule refused it, and the error does not say which: a stale CAS base (baseUpdatedAt / <node>Rev), a failed field .validate, or rules that have not been deployed all arrive as this one code. Resyncing + retry.",
          "onDiscarded",
          "resyncing true",
        ],
        "mirror": "a:6 b:4",
        "parked": [],
        "queued": [],
        "returned": true,
        "stale": true,
        "warning": null,
      }
    `);
  });
});

describe("a held write is followed to the server", () => {
  it("resync, then a replay on the fresh list, once", async () => {
    freeze();
    const fresh = Object.assign({}, STORED, { b: Object.assign({}, STORED.b, { size: 5, updatedAt: 300 }) });
    const h = harness({ on: ["stale"], online: true, server: { bookings: fresh } });
    const returned = h.fn.saveBookings(resize, false, h.report);
    await flush();
    expect(after(h, returned)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] bookings write held — local data may be stale; queued for resync + retry, shown optimistically.",
          "setBookings a:6 b:4",
          "resyncing true",
          "get bookings",
          "get tableBlocks",
          "get tableBlocksRev",
          "setBookings a:2 b:5",
          "setTableBlocks 1",
          "resyncing false",
          "setBookings a:6 b:5",
          "update bookings a=6 base 100",
          "onLanded",
        ],
        "mirror": "a:6 b:5",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": false,
        "warning": null,
      }
    `);
  });
  it("parks after the automatic attempts, named, and a person can retry it", async () => {
    freeze();
    const h = harness({ online: true, answers: ["no", "no", "no", "no"] });
    h.fn.saveBookings(resize, false, h.report);
    for (let i = 0; i < 6; i++) await flush();
    expect(after(h, true)).toMatchInlineSnapshot(`
      {
        "log": [
          "setBookings a:6 b:4",
          "update bookings a=6 base 100",
          "warn: [SAFE] bookings write REJECTED — PERMISSION_DENIED: denied — a Security Rule refused it, and the error does not say which: a stale CAS base (baseUpdatedAt / <node>Rev), a failed field .validate, or rules that have not been deployed all arrive as this one code. Resyncing + retry.",
          "resyncing true",
          "get bookings",
          "get tableBlocks",
          "get tableBlocksRev",
          "setBookings a:2 b:4",
          "setTableBlocks 1",
          "resyncing false",
          "setBookings a:6 b:4",
          "update bookings a=6 base 100",
          "warn: [SAFE] bookings write REJECTED — PERMISSION_DENIED: denied — a Security Rule refused it, and the error does not say which: a stale CAS base (baseUpdatedAt / <node>Rev), a failed field .validate, or rules that have not been deployed all arrive as this one code. Resyncing + retry.",
          "resyncing true",
          "get bookings",
          "get tableBlocks",
          "get tableBlocksRev",
          "setBookings a:2 b:4",
          "setTableBlocks 1",
          "resyncing false",
          "setBookings a:6 b:4",
          "update bookings a=6 base 100",
          "warn: [SAFE] bookings write REJECTED — PERMISSION_DENIED: denied — a Security Rule refused it, and the error does not say which: a stale CAS base (baseUpdatedAt / <node>Rev), a failed field .validate, or rules that have not been deployed all arrive as this one code. Resyncing + retry.",
          "resyncing true",
          "get bookings",
          "get tableBlocks",
          "get tableBlocksRev",
          "setBookings a:2 b:4",
          "setTableBlocks 1",
          "resyncing false",
          "setBookings a:6 b:4",
          "update bookings a=6 base 100",
          "warn: [SAFE] bookings write REJECTED — PERMISSION_DENIED: denied — a Security Rule refused it, and the error does not say which: a stale CAS base (baseUpdatedAt / <node>Rev), a failed field .validate, or rules that have not been deployed all arrive as this one code. Resyncing + retry.",
          "resyncing true",
          "get bookings",
          "get tableBlocks",
          "get tableBlocksRev",
          "setBookings a:2 b:4",
          "setTableBlocks 1",
          "resyncing false",
        ],
        "mirror": "a:2 b:4",
        "parked": [
          "Rita, 20:00",
        ],
        "queued": [],
        "returned": true,
        "stale": false,
        "warning": null,
      }
    `);
    h.fn.retryParked();
    for (let i = 0; i < 6; i++) await flush();
    expect(h.log[h.log.length - 1]).toBe("onLanded");
    expect(h.parked).toEqual([]);
  });
  it("or discard it, and its caller is told", async () => {
    freeze();
    const h = harness({ online: true, answers: ["no", "no", "no", "no"] });
    h.fn.saveBookings(resize, false, h.report);
    for (let i = 0; i < 6; i++) await flush();
    h.fn.discardParked();
    expect(h.log[h.log.length - 1]).toBe("onDiscarded");
    expect(h.parked).toEqual([]);
  });
  it("a replay its caller refuses is dropped and said", async () => {
    freeze();
    const h = harness({ on: ["stale"], online: true });
    h.report.replayRefusal = () => "The booking was deleted on another device.";
    h.fn.saveBookings(resize, false, h.report);
    await flush();
    expect(after(h, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] bookings write held — local data may be stale; queued for resync + retry, shown optimistically.",
          "setBookings a:6 b:4",
          "resyncing true",
          "get bookings",
          "get tableBlocks",
          "get tableBlocksRev",
          "setBookings a:2 b:4",
          "setTableBlocks 1",
          "resyncing false",
          "onDiscarded",
          "warning: The booking was deleted on another device.",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": false,
        "warning": "The booking was deleted on another device.",
      }
    `);
  });
});

// `saveBlocks` asks three of the six: the schema gate is `writeWithRev`'s, a block
// list has no empty gate (removing the last block is an ordinary edit) and it has
// no array shape to hold for.
describe("saveBlocks", () => {
  const addBlock = (prev) => prev.concat([{ id: "y", table: "2", date: "2026-10-31", from: "15:00", to: "16:00" }]);
  function blocksWith(o, next, isSilent) {
    freeze();
    const h = harness(o);
    return after(h, h.fn.saveBlocks(next, isSilent));
  }
  it("writes through the rev pair, and logs once it lands", () => {
    expect(blocksWith({}, addBlock, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "setTableBlocks 2",
          "writeWithRev tableBlocks 2",
          "activity 1",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": true,
        "stale": false,
        "warning": null,
      }
    `);
  });
  it("may write an empty list", () => {
    const r = blocksWith({ firstLoad: 99 }, () => [], false);
    expect(r.returned).toBe(true);
    expect(r.log.some((l) => l.startsWith("writeWithRev tableBlocks 0"))).toBe(true);
  });
  it("a refused write says so, unless it was silent", () => {
    expect(blocksWith({ blocksRefused: true }, addBlock, false).warning).toContain("out of date");
    expect(blocksWith({ blocksRefused: true }, addBlock, true).warning).toBe(null);
  });
  it("is held stale, with no queue: the caller redoes it", () => {
    expect(blocksWith({ on: ["stale"] }, addBlock, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] tableBlocks write held — local data may be stale; resyncing first.",
          "resyncing true",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": true,
        "warning": null,
      }
    `);
  });
  it("is held by a heartbeat gap too", () => {
    expect(blocksWith({ on: ["gap"] }, addBlock, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "resyncing true",
          "warn: [SAFE] tableBlocks write held — local data may be stale; resyncing first.",
          "resyncing true",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": true,
        "warning": null,
      }
    `);
  });
  it("is refused before the first read: it answers false and the screen does not move", () => {
    expect(blocksWith({ on: ["not-loaded"] }, addBlock, false)).toMatchInlineSnapshot(`
      {
        "log": [
          "warn: [SAFE] Refused to write tableBlocks — initial read has not completed yet.",
        ],
        "mirror": "a:2 b:4",
        "parked": [],
        "queued": [],
        "returned": false,
        "stale": false,
        "warning": null,
      }
    `);
  });
  // `mirror` in the snapshots is the bookings'. This is the blocks' own, with the
  // write that does move it as the control.
  it("only a write that goes out moves the blocks' mirror", () => {
    const blocksAfter = (o) => {
      freeze();
      const h = harness(o);
      h.fn.saveBlocks(addBlock, false);
      return h.refs.blocksRef.current.length;
    };
    expect(blocksAfter({})).toBe(2);
    ["gap", "stale", "not-loaded"].forEach((g) => expect(blocksAfter({ on: [g] }), g).toBe(1));
  });
  it("the first shut gate answers alone here too", () => {
    const BLOCK_GATES = ["gap", "stale", "not-loaded"];
    [false, true].forEach((silent) => combinations(BLOCK_GATES).forEach((shut) => {
      const first = BLOCK_GATES.find((g) => shut.includes(g));
      expect(outcome(blocksWith({ on: shut }, addBlock, silent)), shut.join(" + ") || "(no gate shut)")
        .toEqual(outcome(blocksWith({ on: first ? [first] : [] }, addBlock, silent)));
    }));
  });
});

// ── The hook cannot go round it ──────────────────────────────────────────────
// Everything above runs the code as it stands. This is what stops a later edit
// adding a seventh `if` beside the gate, or a write that never asks: it reads the
// stripped source, because the hook's comments describe every one of these in prose.
describe("the hook decides nothing the gate decides", () => {
  const SAVE = liftFunction(HOOK, "saveBookings");
  const BLOCKS = liftFunction(HOOK, "saveBlocks");
  const persistOf = (fn) => liftFunction(fn, "persist");

  it("no gate's condition is left in saveBookings or saveBlocks", () => {
    [SAVE, BLOCKS].forEach((fn) => {
      [/if\(staleRef\.current\)/, /if\(isStaleGap\(/, /if\(writesBlocked\(/, /if\(!(bookings|blocks)Loaded\.current\)/,
        /\.length===0/, /firstLoadCount\.current[!>=]/, /if\(arrayShapeRef\.current\)/,
      ].forEach((old) => expect(fn).not.toMatch(old));
    });
  });
  it("each write asks before it runs its updater, and each fact goes in the question", () => {
    expect(SAVE).toContain('const early=writeGate({schemaBlocked:writesBlocked("bookings"),gap:isStaleGap(lastBeatRef.current,Date.now()),stale:staleRef.current});');
    expect(SAVE.indexOf("const early=writeGate(")).toBeLessThan(SAVE.indexOf("next(prevHeld)"));
    expect(SAVE.indexOf("const early=writeGate(")).toBeLessThan(SAVE.indexOf("const computed="));
    expect(BLOCKS).toContain("const early=writeGate({gap:isStaleGap(lastBeatRef.current,Date.now()),stale:staleRef.current});");
    expect(BLOCKS.indexOf("const early=writeGate(")).toBeLessThan(BLOCKS.indexOf("const computed="));
    expect(SAVE).toContain("const gate=writeGate({loaded:bookingsLoaded.current,computed:computed,firstLoadCount:firstLoadCount.current,arrayShape:arrayShapeRef.current});");
    expect(BLOCKS).toContain("writeGate({loaded:blocksLoaded.current})");
  });
  it("nothing reaches the server above its question, and a refusal never reaches the mirror", () => {
    // The update is inside `persist`, so what is read is `persist`'s one call.
    expect(SAVE.match(/\bpersist\(/g)).toHaveLength(2);
    expect(persistOf(SAVE)).toContain('update(ref(db,"bookings"),patch)');
    const asked = SAVE.indexOf("const gate=writeGate(");
    expect(asked).toBeGreaterThan(-1);
    expect(asked).toBeLessThan(SAVE.lastIndexOf("bookingsRef.current=computed;"));
    expect(SAVE.lastIndexOf("bookingsRef.current=computed;")).toBeLessThan(SAVE.indexOf("persist(prev,computed,gate);"));
    expect(persistOf(BLOCKS)).toContain('writeWithRev("tableBlocks"');
    const loaded = BLOCKS.indexOf("writeGate({loaded:");
    expect(loaded).toBeGreaterThan(-1);
    expect(loaded).toBeLessThan(BLOCKS.indexOf("blocksRef.current=computed;"));
    expect(BLOCKS.indexOf("blocksRef.current=computed;")).toBeLessThan(BLOCKS.indexOf("persist(computed);"));
  });
  // Both callers threw `saveBlocks`' answer away, and the dialog closed on a block
  // that had gone nowhere. Measured on DEV: the banner cannot be read under the
  // dialog's blur, so the sentence is the dialog's own, in a live region that is
  // mounted before it has anything to say.
  it("a block that did not go out stops short of the bookings write, and the dialog says so", () => {
    const APP = appCode();
    ["addBlock", "removeBlock"].forEach((name) => {
      const fn = liftFunction(APP, name);
      expect(fn).toContain("if(!saveBlocks(next)) return false;");
      expect(fn.indexOf("saveBlocks(next)")).toBeLessThan(fn.indexOf("saveBookings("));
    });
    const MODAL = stripComments(readFileSync("src/components/BlockModal.jsx", "utf8")).join("\n");
    expect(MODAL).toContain("setNotSaved(onSave({ tableId, date, allDay: false, from, to }) === false)");
    expect(MODAL).toContain("setNotSaved(onRemove(bl) === false)");
    expect(MODAL).toMatch(/<div role="alert">\s*<Reveal show=\{notSaved\}>/);
    expect(MODAL.match(/\{notSavedEl\}/g)).toHaveLength(2);
  });
  it("and each write has one door: the migration is the only other, and asks the schema gate itself", () => {
    expect((HOOK.match(/update\(ref\(db,"bookings"\)/g) || []).length).toBe(2);
    expect(HOOK).toMatch(/if\(writesBlocked\("the bookings migration"\)\) return;\s+update\(ref\(db,"bookings"\),Object\.assign\(nulls,keyed\)\)/);
    expect((HOOK.match(/writeWithRev\(/g) || []).length).toBe(1);
  });
});
