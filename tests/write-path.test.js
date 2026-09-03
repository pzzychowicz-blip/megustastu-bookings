// tests/write-path.test.js
//
// v17.16.2. The first tests ever to execute the bookings write path.
//
// Until this file existed, everything the app asserts about how a booking
// reaches the server — the per-child diff, the monotonic stamp, the v16.0.0
// compare-and-swap base that closed the 2026-07-05 data-loss incident, the
// StrictMode dedupe window, the retry cap — was established by READING
// `usePersistence.js`. The v17.15.7 crash test says so explicitly, in two
// separate sessions, and rates its own confidence at 55% partly because of it.
//
// So these are not regression tests for a refactor. They are the first
// verification that the arithmetic is what the comments have claimed for four
// major versions.

import { describe, it, expect } from "vitest";
import {
  contentKey, bookingChanged, stampForWrite, buildPatch,
  patchSignature, isDuplicatePatch, isStaleGap, retryDecision,
  changedIds, describeWrite,
  DEDUPE_WINDOW_MS, STALE_GAP_MS, MAX_RETRIES,
} from "../src/lib/write-path.js";

const bk = (o) => Object.assign({ id: "a", name: "T", date: "2099-06-15", time: "13:00", size: 2, duration: 90, status: "confirmed", tables: [] }, o);

describe("contentKey / bookingChanged", () => {
  it("ignores updatedAt, so a server echo is not a change", () => {
    // The whole reason the diff exists: an echo carries a fresher stamp and
    // identical content. Treating that as a change would write on every echo.
    expect(bookingChanged(bk({ updatedAt: 1 }), bk({ updatedAt: 999 }))).toBe(false);
  });
  it("sees a real field change", () => {
    expect(bookingChanged(bk({ size: 2 }), bk({ size: 4 }))).toBe(true);
    expect(bookingChanged(bk({ tables: ["7"] }), bk({ tables: ["6"] }))).toBe(true);
  });
  it("does not leak updatedAt into the key", () => {
    expect(contentKey(bk({ updatedAt: 5 }))).not.toContain("updatedAt");
  });
});

describe("stampForWrite — the three-way max", () => {
  it("clears the device's own last stamp (the StrictMode bar)", () => {
    // Second dev invoke: same wall clock, so without this the two writes would
    // carry an EQUAL stamp and the rule would reject the second.
    const r = stampForWrite(bk({}), null, 5000, 1000);
    expect(r.booking.updatedAt).toBe(5001);
    expect(r.lastStamp).toBe(5001);
  });
  it("clears the booking's stored value (the clock-skew bar)", () => {
    // A device whose clock runs BEHIND the one that last wrote this booking must
    // still produce a stamp the server accepts.
    const r = stampForWrite(bk({}), { updatedAt: 9000 }, 0, 1000);
    expect(r.booking.updatedAt).toBe(9001);
  });
  it("uses the clock when it is ahead of both", () => {
    expect(stampForWrite(bk({}), { updatedAt: 5 }, 5, 80000).booking.updatedAt).toBe(80000);
  });

  // The v16.0.0 compare-and-swap. Greater-than alone was last-writer-wins, which
  // is what let a laptop asleep since 18:00 overwrite a night of tablet bookings
  // when it woke at 01:30 — its wall clock was always "greater".
  it("carries the stored updatedAt as the CAS base on an update", () => {
    expect(stampForWrite(bk({}), { updatedAt: 4242 }, 0, 1).booking.baseUpdatedAt).toBe(4242);
  });
  it("carries base 0 on a create, which v17.16.1's rules require explicitly", () => {
    expect(stampForWrite(bk({}), null, 0, 1).booking.baseUpdatedAt).toBe(0);
  });
  it("treats a non-numeric stored stamp as 0 rather than NaN", () => {
    const r = stampForWrite(bk({}), { updatedAt: "nope" }, 0, 1);
    expect(r.booking.baseUpdatedAt).toBe(0);
    expect(Number.isFinite(r.booking.updatedAt)).toBe(true);
  });
  it("never mutates its input", () => {
    const orig = bk({});
    const before = JSON.stringify(orig);
    stampForWrite(orig, null, 0, 1);
    expect(JSON.stringify(orig)).toBe(before);
  });
});

describe("buildPatch — only what changed", () => {
  it("is EMPTY when nothing changed, which is what skips the write entirely", () => {
    const list = [bk({ id: "a" }), bk({ id: "b" })];
    expect(Object.keys(buildPatch(list, list, 0, 1).patch)).toEqual([]);
  });
  it("patches only the changed child, leaving the other path untouched", () => {
    // The point of the whole per-node model: two devices editing DIFFERENT
    // bookings write disjoint paths and Firebase merges them.
    const prev = [bk({ id: "a" }), bk({ id: "b" })];
    const next = [bk({ id: "a" }), bk({ id: "b", size: 6 })];
    const { patch } = buildPatch(prev, next, 0, 1);
    expect(Object.keys(patch)).toEqual(["b"]);
    expect(patch.b.size).toBe(6);
  });
  it("nulls a removed child (the delete shape)", () => {
    const { patch } = buildPatch([bk({ id: "a" }), bk({ id: "b" })], [bk({ id: "a" })], 0, 1);
    expect(patch.b).toBe(null);
  });
  it("creates with base 0 and updates with the stored stamp, in one pass", () => {
    const prev = [bk({ id: "a", updatedAt: 700 })];
    const next = [bk({ id: "a", updatedAt: 700, size: 8 }), bk({ id: "new" })];
    const { patch } = buildPatch(prev, next, 0, 1);
    expect(patch.a.baseUpdatedAt).toBe(700);
    expect(patch.new.baseUpdatedAt).toBe(0);
  });
  it("gives every child in one patch a DISTINCT, ascending stamp", () => {
    // They share a wall-clock millisecond, so this can only come from threading
    // the counter through. Equal stamps within a patch would be a CAS hazard the
    // moment two of them touched the same booking on a retry.
    const prev = [];
    const next = [bk({ id: "a" }), bk({ id: "b" }), bk({ id: "c" })];
    const { patch, lastStamp } = buildPatch(prev, next, 0, 1000);
    const stamps = ["a", "b", "c"].map((k) => patch[k].updatedAt);
    expect(new Set(stamps).size).toBe(3);
    expect(stamps).toEqual([...stamps].sort((x, y) => x - y));
    expect(lastStamp).toBe(Math.max(...stamps));
  });
  it("carries the counter forward so the NEXT patch cannot collide", () => {
    const first = buildPatch([], [bk({ id: "a" })], 0, 1000);
    const second = buildPatch([], [bk({ id: "b" })], first.lastStamp, 1000);
    expect(second.patch.b.updatedAt).toBeGreaterThan(first.patch.a.updatedAt);
  });
  it("skips a child with no id instead of writing to an undefined path", () => {
    const { patch } = buildPatch([], [bk({ id: null }), bk({ id: "ok" })], 0, 1);
    expect(Object.keys(patch)).toEqual(["ok"]);
  });
  it("handles a null prev (the very first write)", () => {
    expect(Object.keys(buildPatch(null, [bk({ id: "a" })], 0, 1).patch)).toEqual(["a"]);
  });
});

describe("patchSignature / isDuplicatePatch — the StrictMode window", () => {
  it("is stable across the fresh stamps that are the only difference", () => {
    // The dev double-invoke produces two patches identical but for updatedAt.
    // The second invoke shares the wall-clock millisecond, so its stamp can only
    // differ via the device counter — which by then has advanced PAST the clock.
    // (First draft used counters of 0 and 50 against a clock of 1000; the clock
    // won both times and the stamps were equal, so the assertion was wrong
    // rather than the code.)
    const a = buildPatch([], [bk({ id: "a" })], 0, 1000).patch;
    const b = buildPatch([], [bk({ id: "a" })], a.a.updatedAt, 1000).patch;
    expect(a.a.updatedAt).not.toBe(b.a.updatedAt);
    expect(patchSignature(a)).toBe(patchSignature(b));
  });
  it("is order-independent", () => {
    const p1 = { b: bk({ id: "b" }), a: bk({ id: "a" }) };
    const p2 = { a: bk({ id: "a" }), b: bk({ id: "b" }) };
    expect(patchSignature(p1)).toBe(patchSignature(p2));
  });
  it("distinguishes a deletion from a write", () => {
    expect(patchSignature({ a: null })).not.toBe(patchSignature({ a: bk({ id: "a" }) }));
  });
  it("suppresses a byte-identical redispatch inside the window", () => {
    expect(isDuplicatePatch("sig", { sig: "sig", at: 1000 }, 1500)).toBe(true);
  });
  it("admits it once the window has passed", () => {
    expect(isDuplicatePatch("sig", { sig: "sig", at: 1000 }, 1000 + DEDUPE_WINDOW_MS)).toBe(false);
  });
  it("admits a genuinely different patch immediately", () => {
    expect(isDuplicatePatch("other", { sig: "sig", at: 1000 }, 1001)).toBe(false);
  });
  it("admits everything when nothing has been dispatched yet", () => {
    expect(isDuplicatePatch("sig", { sig: "", at: 0 }, 1)).toBe(false);
    expect(isDuplicatePatch("sig", null, 1)).toBe(false);
  });
});

// ── v17.16.6: CT-2A-08, settled ──────────────────────────────────────────────
//
// The register's claim: the 2 s dedupe "can swallow a legitimate A→B→A write
// with no echo between". The settling observation ROADMAP.md asked for was
// "construct one, or close the finding". These tests are the close, and the
// argument they pin is structural rather than a failure to construct.
//
// A signature is (content, baseUpdatedAt) per child — `contentKey` deletes
// `updatedAt` and NOTHING ELSE, so the CAS base is inside it. Two patches with
// the same signature are therefore INDISTINGUISHABLE TO THE SERVER: same
// content, same claimed base, so the rule reaches the same verdict on both.
//
// That is what makes a swallow safe, and it is a complete case analysis rather
// than an absence of counterexamples. If the earlier patch landed, the server
// already holds what the swallowed one wanted, so nothing is lost. If it was
// rejected, the swallowed one carrying the identical base would have been
// rejected too — and `update().catch` has already queued the retry and tripped
// `markStale`, so recovery is armed. There is no third outcome.
//
// The property is therefore not "we could not build one" but "the two writes
// have the same fate by construction". What would MAKE the finding real is
// `baseUpdatedAt` leaving the signature — which is exactly what the first test
// below guards, and is a plausible future simplification of `contentKey`.
describe("CT-2A-08 — why swallowing a duplicate cannot diverge", () => {
  it("keeps baseUpdatedAt INSIDE the signature — the load-bearing property", () => {
    // Same content, different CAS base. These are different writes with
    // different fates and must never share a signature. Delete baseUpdatedAt in
    // contentKey alongside updatedAt and this is the assertion that fails.
    const same = { name: "Ana", size: 2 };
    const p1 = buildPatch([bk({ id: "a", updatedAt: 100, ...same })],
                          [bk({ id: "a", updatedAt: 100, ...same, size: 4 })], 0, 1000).patch;
    const p2 = buildPatch([bk({ id: "a", updatedAt: 200, ...same })],
                          [bk({ id: "a", updatedAt: 200, ...same, size: 4 })], 0, 1000).patch;
    expect(p1.a.baseUpdatedAt).toBe(100);
    expect(p2.a.baseUpdatedAt).toBe(200);
    expect(patchSignature(p1)).not.toBe(patchSignature(p2));
  });

  it("does not dedupe A→B→A once an echo has advanced the base", () => {
    // The ordinary path. An echo writes the server stamp back into local state,
    // so the third write claims a different base and is a different signature.
    const A = { id: "a", size: 2 }, B = { id: "a", size: 4 };
    const w1 = buildPatch([bk({ ...A, updatedAt: 100 })], [bk({ ...B, updatedAt: 100 })], 0, 1000).patch;
    // echo: the server value lands, base moves to the stamp w1 issued
    const echoed = bk({ ...B, updatedAt: w1.a.updatedAt });
    const w2 = buildPatch([echoed], [bk({ ...A, updatedAt: echoed.updatedAt })], w1.a.updatedAt, 1001).patch;
    expect(patchSignature(w2)).not.toBe(patchSignature(w1));
    expect(isDuplicatePatch(patchSignature(w2), { sig: patchSignature(w1), at: 1000 }, 1001)).toBe(false);
  });

  it("the swallowed patch is byte-identical to the one already sent", () => {
    // The finding's own scenario, with the base frozen (no echo). The third
    // write IS deduped — and this is what makes that harmless: it carries the
    // same content and the same base as the first, so whatever the server did
    // with the first it would do with this one.
    const A = { id: "a", size: 2 }, B = { id: "a", size: 4 };
    const base = bk({ ...A, updatedAt: 100 });
    const w1 = buildPatch([base], [bk({ ...B, updatedAt: 100 })], 0, 1000).patch;
    const w2 = buildPatch([bk({ ...B, updatedAt: 100 })], [bk({ ...A, updatedAt: 100 })], w1.a.updatedAt, 1001).patch;
    const w3 = buildPatch([bk({ ...A, updatedAt: 100 })], [bk({ ...B, updatedAt: 100 })], w2.a.updatedAt, 1002).patch;
    // w2 is a genuinely different write and is never suppressed
    expect(isDuplicatePatch(patchSignature(w2), { sig: patchSignature(w1), at: 1000 }, 1001)).toBe(false);
    // w3 repeats w1 exactly — same content, same claimed base
    expect(patchSignature(w3)).toBe(patchSignature(w1));
    expect(w3.a.baseUpdatedAt).toBe(w1.a.baseUpdatedAt);
    expect(isDuplicatePatch(patchSignature(w3), { sig: patchSignature(w1), at: 1000 }, 1002)).toBe(true);
    // ...and the stamps still advance, so nothing here depends on the swallow
    expect(w3.a.updatedAt).toBeGreaterThan(w1.a.updatedAt);
  });

  it("compares the WHOLE patch, so a repeat across different children still holds", () => {
    // Three writes touching different ids can also make sig3 === sig1. The same
    // analysis covers it, because the signature is per-child and the equality is
    // still content-and-base for every child in the patch.
    const px = buildPatch([bk({ id: "x", updatedAt: 100, size: 2 })],
                          [bk({ id: "x", updatedAt: 100, size: 4 })], 0, 1000).patch;
    const py = buildPatch([bk({ id: "y", updatedAt: 100, size: 2 })],
                          [bk({ id: "y", updatedAt: 100, size: 6 })], px.x.updatedAt, 1001).patch;
    const px2 = buildPatch([bk({ id: "x", updatedAt: 100, size: 2 })],
                           [bk({ id: "x", updatedAt: 100, size: 4 })], py.y.updatedAt, 1002).patch;
    expect(patchSignature(py)).not.toBe(patchSignature(px));
    expect(patchSignature(px2)).toBe(patchSignature(px));
  });
});

describe("isStaleGap — the freshness gate", () => {
  it("does not trip on ordinary operation", () => {
    expect(isStaleGap(0, 10000)).toBe(false);   // one heartbeat
    expect(isStaleGap(0, 60000)).toBe(false);   // a backgrounded tab's throttle
  });
  it("trips on a frozen event loop", () => {
    expect(isStaleGap(0, STALE_GAP_MS + 1)).toBe(true);
    expect(isStaleGap(0, 4 * 60 * 60 * 1000)).toBe(true); // a lid closed all afternoon
  });
  // The threshold must stay clear of the ~60s a backgrounded tab throttles to,
  // or every device trips the gate every time it is backgrounded.
  it("keeps its clearance above the background throttle", () => {
    expect(STALE_GAP_MS).toBeGreaterThan(60000);
  });
});

describe("retryDecision — the cap that was only ever a comment", () => {
  it("replays while under the cap, counting up", () => {
    expect(retryDecision(0)).toEqual({ action: "retry", tries: 1 });
    expect(retryDecision(MAX_RETRIES - 1)).toEqual({ action: "retry", tries: MAX_RETRIES });
  });
  it("gives up AT the cap rather than looping forever", () => {
    expect(retryDecision(MAX_RETRIES).action).toBe("give-up");
    expect(retryDecision(MAX_RETRIES + 1).action).toBe("give-up");
  });
  it("terminates from any starting count", () => {
    let tries = 0, hops = 0;
    while (retryDecision(tries).action === "retry" && hops < 50) { tries = retryDecision(tries).tries; hops++; }
    expect(hops).toBe(MAX_RETRIES);
  });
});

// ── v17.16.9 (CT-2A-07) ──────────────────────────────────────────────────────
// A write whose automatic retries run out is now PARKED and NAMED rather than
// dropped behind a banner naming nothing. These cover the two pure functions
// that make the naming possible.

describe("changedIds — buildPatch's diff, now shared", () => {
  it("agrees with buildPatch on every input, which is the whole reason it exists", () => {
    // The defect this guards is drift: if the banner names a booking the patch
    // does not carry, the message is worse than no message. buildPatch consumes
    // changedIds, so this pins the contract rather than merely observing it.
    const cases = [
      [[bk({ id: "a" })], [bk({ id: "a" })]],                                   // no change
      [[bk({ id: "a" })], [bk({ id: "a", size: 4 })]],                          // changed
      [[bk({ id: "a" })], [bk({ id: "a" }), bk({ id: "b" })]],                  // added
      [[bk({ id: "a" }), bk({ id: "b" })], [bk({ id: "a" })]],                  // deleted
      [[bk({ id: "a" }), bk({ id: "b" })], [bk({ id: "b", size: 6 })]],         // both at once
      [[], []], [null, null], [undefined, [bk({ id: "a" })]],
      // a duplicate id — reachable via a genId() collision, see ROADMAP
      [[bk({ id: "a", size: 2 })], [bk({ id: "a", size: 4 }), bk({ id: "a", size: 2 })]],
    ];
    cases.forEach(([prev, computed]) => {
      const ids = changedIds(prev, computed);
      const patch = buildPatch(prev, computed, 0, 1000).patch;
      expect(ids.slice().sort()).toEqual(Object.keys(patch).sort());
    });
  });
  it("on a DUPLICATE id, buildPatch still writes the CHANGED occurrence", () => {
    // Key-set agreement is NOT enough, and this is the case that proves it: the
    // extraction's first version built its lookup from every entry in `computed`
    // (last wins), which agrees on keys and writes the UNCHANGED copy — silently
    // discarding the edit. Reproduced against the pre-refactor function before
    // it was fixed: "OLD writes size: 4  NEW writes size: 2".
    const prev = [bk({ id: "x", size: 2 })];
    const computed = [bk({ id: "x", size: 4 }), bk({ id: "x", size: 2 })];
    expect(buildPatch(prev, computed, 0, 1000).patch.x.size).toBe(4);
  });
  it("returns computed order first, deletions last", () => {
    // buildPatch stamps in this order, so it is a real property, not incidental.
    const prev = [bk({ id: "gone" }), bk({ id: "b" })];
    const computed = [bk({ id: "b", size: 4 }), bk({ id: "new" })];
    expect(changedIds(prev, computed)).toEqual(["b", "new", "gone"]);
  });
  it("ignores an echo-only stamp change, like the diff it came from", () => {
    expect(changedIds([bk({ updatedAt: 1 })], [bk({ updatedAt: 999 })])).toEqual([]);
  });
  it("skips entries with no id rather than keying on undefined", () => {
    expect(changedIds([], [bk({ id: null }), { name: "x" }])).toEqual([]);
  });
});

describe("describeWrite — what the parked banner calls the change", () => {
  it("names the booking by identity, not by description", () => {
    // Deliberately NOT describeBooking's five clauses — this identifies which
    // change failed, in one line of a banner.
    expect(describeWrite([bk({ id: "a", name: "Pau", time: "20:00" })],
                         [bk({ id: "a", name: "Pau", time: "20:00", status: "seated" })]))
      .toBe("Pau, 20:00");
  });
  it("names the booking as it STILL APPEARS, not as it would have been saved", () => {
    // The first version had this the other way round and it read as obviously
    // right. It is wrong: a parked write was UNDONE, so the card still shows the
    // previous version and that is what the user has to find. Caught live —
    // seating a 19:30 booking shifts its time to now, so the banner named
    // "P3 Smoke Test, 15:05" for a card reading 19:30.
    expect(describeWrite([bk({ id: "a", name: "Old", time: "13:00" })],
                         [bk({ id: "a", name: "New", time: "19:30" })]))
      .toBe("Old, 13:00");
  });
  it("falls back to computed for a CREATE, which has no previous version", () => {
    expect(describeWrite([], [bk({ id: "n", name: "Walk-in", time: "20:15" })]))
      .toBe("Walk-in, 20:15");
  });
  it("falls back to the version being removed for a deletion", () => {
    expect(describeWrite([bk({ id: "a", name: "Rita", time: "21:00" })], []))
      .toBe("Rita, 21:00");
  });
  it("names the first and counts the rest, with the noun following the count", () => {
    const prev = [bk({ id: "a", name: "A" }), bk({ id: "b", name: "B" }), bk({ id: "c", name: "C" })];
    const two = [bk({ id: "a", name: "A", size: 4 }), bk({ id: "b", name: "B", size: 4 }), bk({ id: "c", name: "C" })];
    expect(describeWrite(prev, two)).toBe("A, 13:00 and 1 other");
    const three = two.map((b) => Object.assign({}, b, { size: 4 }));
    expect(describeWrite(prev, three)).toBe("A, 13:00 and 2 others");
  });
  it("falls back to the id when a booking has neither name nor time", () => {
    // sanitize guarantees a string name, not a non-empty one. A nameless
    // booking must still be pointed at.
    expect(describeWrite([], [bk({ id: "xyz", name: "", time: "" })])).toBe("xyz");
  });
  it("returns null when nothing changed, so the banner never claims a phantom", () => {
    expect(describeWrite([bk()], [bk()])).toBe(null);
    expect(describeWrite([], [])).toBe(null);
  });
});
