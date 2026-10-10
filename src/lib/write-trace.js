// v18.6.0 — a DEV-only instrument for one fault, seen once and not reproduced
// (ROADMAP, "A parked write was seen stored without Retry"): a write waiting
// in the "Couldn't save" banner was found stored, and nobody recalls pressing
// Retry. If it happens again, this says what touched the queue and what was
// clicked before it.
//
// What it keeps, in memory only (nothing is written anywhere, and a reload
// empties it): the last TRACE_MAX entries in `window.__mgtTrace`.
//   - every click in the page, at the capture phase so a handler that stops
//     the event cannot hide it: `isTrusted` (false for a script's click), the
//     control's text, and whether the page was visible;
//   - each park, Retry, Discard and replay (`traceWrite`, called by
//     usePersistence), with the call stack for Retry and the clicks just
//     before it. Those four also print one console line each.
//
// DEV only (Patryk, 2026-10-10): every body is behind `import.meta.env.DEV`,
// which Vite replaces with `false` in a build, so neither the listener nor the
// strings below are in the restaurant's bundle or the sandbox's.
// tests/write-trace.test.js reads the built entry chunk when there is one.
export const TRACE_MAX = 200;
export const TRACE_KEY = "__mgtTrace";

function ring() {
  if (typeof window === "undefined") return null;
  if (!Array.isArray(window[TRACE_KEY])) window[TRACE_KEY] = [];
  return window[TRACE_KEY];
}
// Append one entry and drop the oldest past TRACE_MAX. Exported for the test.
export function pushTrace(list, entry, max) {
  list.push(entry);
  const over = list.length - (max || TRACE_MAX);
  if (over > 0) list.splice(0, over);
  return list;
}
// The words a person would use for what was clicked: the nearest control's
// label or text, cut short. A click on bare page reads as its tag.
export function clickLabel(target) {
  if (!target || !target.closest) return "";
  const el = target.closest("button, a, [role=button], [role=switch], [role=listitem], input, label") || target;
  const text = (el.getAttribute && el.getAttribute("aria-label")) || el.textContent || "";
  return (el.tagName || "").toLowerCase() + (text.trim() ? " " + JSON.stringify(text.trim().replace(/\s+/g, " ").slice(0, 60)) : "");
}
function stamp(kind) {
  return { at: new Date().toISOString(), kind, visible: typeof document === "undefined" ? null : document.visibilityState };
}

// One queue event. `detail` is plain data (labels, counts, tries).
export function traceWrite(kind, detail) {
  if (!import.meta.env.DEV) return;
  const list = ring();
  if (!list) return;
  const entry = Object.assign(stamp(kind), detail || {});
  if (kind === "retry") {
    // Who called it, and what was clicked in the ten seconds before.
    entry.stack = String(new Error("retryParked").stack || "").split("\n").slice(2, 8).map(function (l) { return l.trim(); });
    const since = Date.now() - 10000;
    entry.clicksBefore = list.filter(function (e) { return e.kind === "click" && Date.parse(e.at) >= since; })
      .map(function (e) { return e.at.slice(11, 23) + (e.trusted ? " " : " SCRIPT ") + e.target; });
  }
  pushTrace(list, entry);
  console.info("[trace] " + kind, entry);
}

// The click log. Idempotent: a hot reload of this module must not add a second
// listener, so the one installed is remembered on `window`.
export function startClickTrace() {
  if (!import.meta.env.DEV) return;
  const list = ring();
  if (!list || window.__mgtTraceClicks) return;
  window.__mgtTraceClicks = function (e) {
    pushTrace(ring(), Object.assign(stamp("click"), { trusted: e.isTrusted === true, target: clickLabel(e.target) }));
  };
  window.addEventListener("click", window.__mgtTraceClicks, true);
}
