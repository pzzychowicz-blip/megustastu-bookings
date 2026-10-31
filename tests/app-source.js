// The one place a test reads `BookingApp`'s source (v18.13.1).
//
// `BookingApp` is being split into domain hooks, a version at a time, and 49 test
// files assert over its text. A positive pin reports a move by failing. A negative
// or an order pin cannot: `expect(APP).not.toContain(x)` and
// `expect(APP.indexOf(a)).toBeLessThan(APP.indexOf(b))` both pass the day `x` or `a`
// leaves the file, because `indexOf` then answers -1. There were 118 of those, in 28
// files, and each would have gone on passing while checking nothing.
//
// So every read goes through here, and a hook joins by adding one line to
// APP_FILES. `tests/test-hygiene.test.js` fails a test that reads App.jsx directly.
//
// An ORDER pin only means something when both of its subjects sit in one file: the
// concatenation below is not the order hooks run in. When a move splits one, point
// it at the hook's own file, or restate it as hook order.
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

// Relative to src/. App.jsx stays first: a lookup that matches in two files finds
// App's copy, which is what it found before the hook existed.
export const APP_FILES = ["App.jsx"];

const raw = (rel) => readFileSync(new URL("../src/" + rel, import.meta.url), "utf8");

// The source, comments and all. Imports are kept: `tests/lift.js` reads them.
export const appSource = () => APP_FILES.map(raw).join("\n");

// The same with comments blanked, which is what a pin should match against.
export const appCode = () => APP_FILES.map((f) => stripComments(raw(f)).join("\n")).join("\n");
