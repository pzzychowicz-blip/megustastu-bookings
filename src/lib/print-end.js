// src/lib/print-end.js
//
// v18.4.0 — when a print is really over. `afterprint` says so on a desktop
// browser, where it fires as the print dialog closes. On iOS it does not:
// WebKit fires `beforeprint` and `afterprint` back to back and THEN shows its
// print sheet (Patryk's iPhone, the DEV beacon: both events in the same
// millisecond, six prints of six), and it lays the page out again from the
// live DOM whenever an option in that sheet changes. So a job that was tidied
// away on `afterprint` printed correctly only until he turned the page to
// landscape: the re-layout found no `data-print` and no TimelineSheet and gave
// one page of the day sheet whatever he had chosen, under the app's name
// instead of the day's.
//
// `onPrintEnd(onEnd)` calls `onEnd` on `afterprint` when the print took time
// (a dialog was open in between), and otherwise when the user is back on the
// page: the first pointer or key event. The print sheet is the system's, so
// none reaches the page while it is up. A `beforeprint` during the wait (the
// re-layout fires the pair again) keeps waiting.
//
// Returns the unsubscribe; it does not call `onEnd`.

export const PRINT_EARLY_MS = 500;

export function onPrintEnd(onEnd, win) {
  const w = win || window;
  let began = 0, waiting = false;
  function back() { stopWaiting(); onEnd(); }
  function stopWaiting() {
    if (!waiting) return;
    waiting = false;
    w.removeEventListener("pointerdown", back, true);
    w.removeEventListener("keydown", back, true);
  }
  function before() { began = Date.now(); }
  function after() {
    if (Date.now() - began >= PRINT_EARLY_MS) { stopWaiting(); onEnd(); return; }
    if (waiting) return;
    waiting = true;
    w.addEventListener("pointerdown", back, true);
    w.addEventListener("keydown", back, true);
  }
  w.addEventListener("beforeprint", before);
  w.addEventListener("afterprint", after);
  return function () {
    w.removeEventListener("beforeprint", before);
    w.removeEventListener("afterprint", after);
    stopWaiting();
  };
}

// v18.4.6 — a print the device IGNORES. An iPhone or iPad running the app from
// its Home Screen drops `window.print()`: measured on the iOS 27 simulator with
// a one-button page, the call returned in 68ms with no print sheet and neither
// print event, while the same page in a Safari tab opened the sheet. Nothing a
// page can do raises that sheet there, so the button did nothing and said
// nothing (Patryk's iPhone).
//
// `printOrReport(onIgnored)` prints, and where the page is a Home Screen app
// (`navigator.standalone`, which only iOS defines) it waits `PRINT_IGNORED_MS`
// for a `beforeprint`. None means the call was dropped: `onIgnored` runs, and
// the caller says so and takes its print job down, since no `afterprint` will
// (`onPrintEnd` above never hears of this print). It asks the EVENT, not the
// iOS version, so a Home Screen app that learns to print stops being told it
// cannot. Everywhere else it is `window.print()` and nothing more.
export const PRINT_IGNORED_MS = 500;
export const PRINT_IGNORED_TEXT = "Printing isn't available in the Home Screen app. Open the app in Safari to print.";

export function printOrReport(onIgnored, win) {
  const w = win || window;
  const standalone = !!w.navigator && w.navigator.standalone === true;
  let began = false;
  function before() { began = true; }
  if (standalone) w.addEventListener("beforeprint", before);
  w.print();
  if (!standalone) return;
  w.setTimeout(function () {
    w.removeEventListener("beforeprint", before);
    if (!began) onIgnored();
  }, PRINT_IGNORED_MS);
}

