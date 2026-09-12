// tests/rev-guard.test.js — v18.0.0 session 8 (item 1)
//
// ONE property, and it exists because the obvious implementation gets it
// backwards: **`onDone` must fire only when the server ACCEPTED the write.**
//
// The activity log's hook point for every whole-node collection is
// `writeWithRev`, and the natural way to reach it is to chain onto the promise
// that function returns. That is wrong, and wrong in the quiet direction — it
// logs every REFUSED write as though it had landed, turning the log into a
// record of what people tried to do rather than of what happened. Which is
// worse than no log, because it would be believed.
//
// ── WHY THIS FILE DOES NOT MOCK FIREBASE ─────────────────────────────────────
// `revGuard.js` imports `../firebase`, so exercising it for real means mocking
// `firebase/database` — and **nothing in this repo has ever mocked a module**
// (`vi.mock` appears in none of the other test files). CLAUDE.md is explicit
// that `tests/error-boundary.test.js` is "the bar for repeating the trick — not
// a licence to test components generally", and importing a new testing paradigm
// as a side effect of a wiring commit is not a decision that belongs here.
//
// So the property is pinned the way this repo already pins things: the
// PROMISE SEMANTICS that make the trap real are asserted directly, and the
// SHAPE of the function is read out of the source. Neither needs a mock, and
// between them a regression has nowhere to hide — the first says why the order
// matters, the second says the order is still there.
//
// The source read is STRIPPED, and this file is the best possible argument for
// that rule: `revGuard.js` now contains several paragraphs of prose about
// `.then` and `.catch` explaining this very trap, so a raw read would happily
// match the explanation and report that the code was correct. "Prose that names
// the thing a regex hunts for is indistinguishable from the thing."
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = stripComments(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "revGuard.js"),
    "utf8"
  )
).join("\n");

// The body of writeWithRev, without the prose around it.
const BODY = (function () {
  const at = SRC.indexOf("export function writeWithRev");
  expect(at, "writeWithRev was renamed or removed").toBeGreaterThan(-1);
  // Slice from `at`, NOT `at + 1`. The +1 was there to stop the search below
  // re-finding this same function, and it silently ate the leading "e" — so
  // BODY began "xport function writeWithRev(" and the signature assertion could
  // never match, while the three shape assertions passed because they do not
  // depend on the first character. The test was wrong about the code, which is
  // the failure mode a source scan is most prone to: give the NEXT search an
  // offset instead of moving the start of the slice.
  const end = SRC.indexOf("\nexport ", at + 1);
  return end < 0 ? SRC.slice(at) : SRC.slice(at, end);
})();

describe("the trap: a .catch()-handled promise FULFILS", () => {
  it("runs a .then chained AFTER a .catch, on a REJECTED promise", async () => {
    // Measured rather than reasoned about, and the whole reason `onDone` is a
    // callback instead of something a caller chains onto the return value.
    let ran = false;
    let seen = "untouched";
    await Promise.reject(new Error("denied"))
      .catch(function () { /* the handler returns normally */ })
      .then(function (v) { ran = true; seen = v; });
    expect(ran).toBe(true);
    expect(seen).toBeUndefined();
  });

  it("so `writeWithRev(...).then(log)` would log a refused write as a success", () => {
    // The same fact stated as the consequence, so the next person reads the
    // reason and not only the mechanism.
    const refused = Promise.reject(new Error("PERMISSION_DENIED")).catch(function () {});
    return refused.then(function () { expect(true).toBe(true); });
  });
});

describe("writeWithRev hands out the success path explicitly", () => {
  it("takes onDone as a parameter", () => {
    expect(BODY).toMatch(/export function writeWithRev\([^)]*onDone[^)]*\)/);
  });

  it("invokes onDone inside a .then that comes BEFORE the .catch", () => {
    // The ordering IS the property. `.then(onDone).catch(onReject)` skips
    // onDone on a rejection; `.catch(onReject).then(onDone)` does not, because
    // of the fact pinned above.
    const then = BODY.indexOf(".then(");
    const cat = BODY.indexOf(".catch(");
    expect(then, "no .then in writeWithRev — onDone cannot be on a success path").toBeGreaterThan(-1);
    expect(cat, "no .catch in writeWithRev — onReject lost its handler").toBeGreaterThan(-1);
    expect(then).toBeLessThan(cat);
    // …and onDone is called in that .then, not merely mentioned.
    expect(BODY.slice(then, cat)).toMatch(/onDone\s*\(\s*\)/);
  });

  it("wraps onDone so a throwing log entry cannot become a write error", () => {
    // Without the try, a throw inside onDone is caught by the .catch below it
    // and reported as a failed write — a false red banner over a write that
    // actually landed. The inverse of the bug this file is about, and reachable
    // by the same edit.
    const then = BODY.indexOf(".then(");
    const cat = BODY.indexOf(".catch(");
    const success = BODY.slice(then, cat);
    expect(success).toMatch(/try\s*\{/);
    expect(success).toMatch(/catch/);
  });

  it("still advances the rev optimistically before writing", () => {
    // Unchanged by session 8, asserted because this file now edits the function
    // and the v15.3.0 technique is what makes back-to-back writes work.
    expect(BODY).toMatch(/revRef\.current\s*=\s*nextRev/);
    expect(BODY.indexOf("revRef.current = nextRev")).toBeLessThan(BODY.indexOf("update("));
  });
});
