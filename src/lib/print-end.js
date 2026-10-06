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
