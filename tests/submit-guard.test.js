// tests/submit-guard.test.js
//
// Regression test for CT-2C-01 (v17.15.7 crash test, P1): tapping Save twice
// creates two bookings. Measured live — two clicks 200 ms apart produced two
// confirmed reservations on two different tables, three synchronous clicks
// produced three — and every safeguard in the app was correctly satisfied while
// it happened, because each click is a genuinely distinct, genuinely valid
// create.
//
// TWO HALVES, and the second is the one that bites. `mayDispatch` on its own is
// a one-line predicate; what actually prevents the bug is the SEQUENCING at the
// four call sites, and this repo has no DOM test environment to exercise them
// through. So the second half sweeps the source: a guard that is correct and
// unwired is exactly the shape of the defect it was written for.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { READY, DISPATCHED, mayDispatch } from "../src/lib/submitGuard.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(resolve(HERE, "../src/", rel), "utf8");

// ── 1. the predicate ────────────────────────────────────────────────────────

describe("mayDispatch", () => {
  it("lets a freshly opened surface dispatch", () => {
    expect(mayDispatch(READY)).toBe(true);
  });

  it("refuses a surface that has already dispatched for this open", () => {
    expect(mayDispatch(DISPATCHED)).toBe(false);
  });

  it("FAILS OPEN on anything it does not recognise", () => {
    // Deliberate, and the reason is in the module header: a Save button that
    // silently does nothing is worse than one that does its job twice. The
    // first is invisible and needs a reload; the second leaves a duplicate on
    // screen that somebody can delete.
    expect(mayDispatch(undefined)).toBe(true);
    expect(mayDispatch(null)).toBe(true);
    expect(mayDispatch("")).toBe(true);
    expect(mayDispatch("something-a-later-version-invented")).toBe(true);
  });

  it("the two states are distinct", () => {
    expect(READY).not.toBe(DISPATCHED);
  });
});

// ── 2. the invariant, over the sequence that actually occurs ────────────────
//
// The model below is faithful to the one detail that makes CT-2C-01 possible:
// a form does NOT disappear when it dispatches. `Overlay` self-animates its
// close, so the subtree — Save button included — stays mounted and hit-testable
// for EXIT_MS (260 ms) afterwards. `stillMounted` is that window, and a model
// without it cannot reproduce the bug at all.

function runSequence(ops) {
  let guard = READY;      // the ref's initial value
  let stillMounted = false;
  let opens = 0, dispatches = 0;
  const perOpen = [];

  for (const op of ops) {
    if (op === "open") {
      guard = READY;                 // openForm / openWalkin — the single door
      stillMounted = true;
      opens++;
      perOpen.push(0);
    } else if (op === "tapSave") {
      // A tap only reaches the handler while the form is on screen — which
      // includes the whole of its exit animation.
      if (!stillMounted) continue;
      if (!mayDispatch(guard)) continue;
      guard = DISPATCHED;            // armed on the line that closes the form
      dispatches++;
      if (perOpen.length) perOpen[perOpen.length - 1]++;
    } else if (op === "exitFinished") {
      stillMounted = false;
    }
  }
  return { opens, dispatches, perOpen };
}

describe("one open produces at most one create", () => {
  it("the reported reproduction: two taps inside the exit window", () => {
    // This is the finding, in the smallest form that shows it.
    const r = runSequence(["open", "tapSave", "tapSave", "exitFinished"]);
    expect(r.dispatches).toBe(1);
  });

  it("three synchronous taps still produce one", () => {
    const r = runSequence(["open", "tapSave", "tapSave", "tapSave"]);
    expect(r.dispatches).toBe(1);
  });

  it("re-opening the form allows a second, deliberate booking", () => {
    // The guard must not make the app refuse real work: two guests booked one
    // after the other is the ordinary case and must still produce two.
    const r = runSequence([
      "open", "tapSave", "exitFinished",
      "open", "tapSave", "exitFinished",
    ]);
    expect(r.dispatches).toBe(2);
    expect(r.perOpen).toEqual([1, 1]);
  });

  it("a validation return does not consume the open", () => {
    // Modelled by the tap simply not reaching the dispatch: the guard is armed
    // only after a write, so Save still works once the field is corrected.
    let guard = READY;
    // …user presses Save with no date; doSave returns before arming.
    expect(mayDispatch(guard)).toBe(true);
    // …user fixes the date and presses Save again.
    expect(mayDispatch(guard)).toBe(true);
    guard = DISPATCHED;
    expect(mayDispatch(guard)).toBe(false);
  });

  it("holds over 500 random sequences", () => {
    // The general statement, rather than the three cases above: whatever order
    // opens, taps and exits arrive in, no single open ever yields two creates.
    const OPS = ["open", "tapSave", "tapSave", "exitFinished"];
    let seed = 20260831;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    for (let i = 0; i < 500; i++) {
      const len = 2 + Math.floor(rnd() * 18);
      const ops = Array.from({ length: len }, () => OPS[Math.floor(rnd() * OPS.length)]);
      const r = runSequence(ops);
      expect(r.dispatches).toBeLessThanOrEqual(r.opens);
      for (const n of r.perOpen) expect(n).toBeLessThanOrEqual(1);
    }
  });
});

// ── 3. the wiring ───────────────────────────────────────────────────────────
//
// Everything above passes against a guard nothing calls. These are the
// assertions that fail if the fix is removed from either surface.

describe("the booking form is wired to the guard", () => {
  const app = src("App.jsx");

  it("doSave consults the guard BEFORE it validates anything", () => {
    const body = app.slice(app.indexOf("function doSave(){"));
    const check = body.indexOf("mayDispatch(saveGuardRef.current)");
    const firstValidation = body.indexOf('setError("Customer name is required.")');
    expect(check).toBeGreaterThan(-1);
    expect(firstValidation).toBeGreaterThan(-1);
    // A guard placed after validation would let a second tap through whenever
    // the draft happened to be invalid on the first — and the draft is valid by
    // definition on a double-tap, so the bug would be intact.
    expect(check).toBeLessThan(firstValidation);
  });

  it("openForm resets the guard — the single door, per rule 3", () => {
    const line = app.split("\n").find((l) => l.includes("function openForm(next)"));
    expect(line).toBeTruthy();
    expect(line).toContain("saveGuardRef.current=READY");
  });

  it("every save path that closes the form arms the guard first", () => {
    // The two dispatch paths (doSaveEdit, doSaveNew) end with the same tail.
    // `setViewDate(f.date)` is what distinguishes them from the six other
    // `setShowForm(false)` sites, which are cancels and must NOT arm.
    const tails = app.split("setShowForm(false);setViewDate(f.date);");
    expect(tails.length - 1).toBe(2);
    for (const before of tails.slice(0, -1)) {
      expect(before.trimEnd().endsWith("saveGuardRef.current=DISPATCHED;")).toBe(true);
    }
  });

  it("guards the BUTTON's handler too, not only doSave", () => {
    // `save()` is what the Save button calls. It can raise the kitchen-busy
    // confirm and RETURN before doSave is ever reached, so a guard only in
    // doSave lets a second tap produce a stray dialog for a booking that has
    // already been written — the first tap's booking is in `bookings` by then,
    // which is exactly what pushes the kitchen load over the limit.
    const body = app.slice(app.indexOf("function save(statusOverride){"));
    const check = body.indexOf("mayDispatch(saveGuardRef.current)");
    const kitchen = body.indexOf("setConfirmKitchen(\"form\")");
    expect(check).toBeGreaterThan(-1);
    expect(kitchen).toBeGreaterThan(-1);
    expect(check).toBeLessThan(kitchen);
  });

  it("arms in exactly as many places as it dispatches", () => {
    // A third save path added later without arming would pass every test above.
    const arms = (app.match(/saveGuardRef\.current=DISPATCHED/g) || []).length;
    const closes = (app.match(/setShowForm\(false\);setViewDate\(f\.date\);/g) || []).length;
    expect(arms).toBe(closes);
  });
});

describe("the walk-in form is wired to the guard", () => {
  const walkin = src("hooks/useWalkin.js");

  it("doSaveWalkin consults the guard before its own validation", () => {
    const body = walkin.slice(walkin.indexOf("function doSaveWalkin(){"));
    const check = body.indexOf("mayDispatch(walkinGuardRef.current)");
    const validation = body.indexOf('setWalkinError("Please assign tables first.")');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(validation);
  });

  it("openWalkin resets it and the dispatch path arms it", () => {
    expect(walkin).toContain("walkinGuardRef.current=READY");
    expect(walkin).toContain("walkinGuardRef.current=DISPATCHED");
    // Armed AFTER the write, not before: a throw inside saveBookings must not
    // leave the form open and permanently unable to save.
    const write = walkin.indexOf("saveBookings(function(prev){return prev.concat([nb]);});");
    const arm = walkin.indexOf("walkinGuardRef.current=DISPATCHED");
    expect(write).toBeGreaterThan(-1);
    expect(arm).toBeGreaterThan(write);
  });

  it("guards saveWalkin as well as doSaveWalkin", () => {
    // Same shape: saveWalkin is the Seat button's handler and its kitchen
    // branch returns before doSaveWalkin.
    const body = walkin.slice(walkin.indexOf("function saveWalkin(){"));
    const check = body.indexOf("mayDispatch(walkinGuardRef.current)");
    const kitchen = body.indexOf("setConfirmKitchen(\"walkin\")");
    expect(check).toBeGreaterThan(-1);
    expect(kitchen).toBeGreaterThan(-1);
    expect(check).toBeLessThan(kitchen);
  });

  it("holds the guard in a ref, not in state", () => {
    // State would not be current within the tick that the second tap arrives in,
    // which is the entire window this guard covers.
    expect(walkin).toContain("const walkinGuardRef = useRef(READY)");
  });
});
