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
