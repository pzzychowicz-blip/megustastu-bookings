// v17.15.1: the app stylesheet. It was an 89 kB inline <style> in index.html,
// which the service worker re-sent on every open (navigations are network-first).
// Imported here so Vite emits a hashed /assets/index-*.css — the cache-first side
// of that line. See the header of src/index.css for the full reasoning.
import "./index.css";

import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { hasLogAuthor, logActivity } from "./hooks/useActivityLog";
import { crashEntry, crashGate, crashView } from "./lib/crash-report";
import { deviceLabel } from "./lib/presence-state";

// v18.13.0 (#28): everything uncaught leaves one `activity` entry, so a fault on a device
// no longer depends on somebody reporting it. What the entry says, and whether it is
// written at all, is lib/crash-report.js. Three doors: the boundary for a render, and the
// two window events for everything a boundary never sees (an event handler, a timer, a
// promise). The bubble phase on `error` is deliberate: a failed <img> or <script> reaches
// a capture listener only. The try/catch is the point of this function: a report that
// throws from `componentDidCatch` would take down the error screen itself.
const admitCrash = crashGate();
function reportCrash(thrown, where, componentStack) {
  try {
    const build = window.__MGT_BUILD__;
    const report = crashEntry(thrown, {
      where,
      componentStack,
      version: build && build.version,
      view: crashView(),
      device: deviceLabel(),
    });
    if (report && hasLogAuthor() && admitCrash(report.signature)) logActivity([report.entry]);
  } catch (err) {
    console.warn("[crash] could not be reported", err);
  }
}
window.addEventListener("error", function (e) { reportCrash(e.error || e.message, "error"); });
window.addEventListener("unhandledrejection", function (e) { reportCrash(e.reason, "rejection"); });

ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/* v17.16.0 (CT-2A-02): until this, `<App/>` was rendered bare — and React's
        contract for an uncaught render error is to unmount the WHOLE tree, so any
        throw in render or in one of ~30 effects left `#root` empty. A white screen
        on a tablet mid-service, with no route back but a reload nobody is prompted
        to do. index.html's boot watchdog does not cover it: it fires once at T+10s
        gated on an EMPTY root, which answers "did the app never mount" rather than
        "did it mount and then throw". See src/components/ErrorBoundary.jsx. */}
    <ErrorBoundary onCrash={function (error, componentStack) { reportCrash(error, "render", componentStack); }}>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// Service worker: v17.4.0 registered one, it froze the app at
// "⟳ Loading bookings…" on iPhone and iPad in production, and v17.4.1 withdrew
// it. v17.10.1 established the root cause (a CSP-blocked JSONP fallback, fixed
// in v17.5.1 — the freeze also happened in iOS Chrome, where a service worker
// cannot run at all) and re-introduced one on strict terms.
//
// It is NOT registered here. src/lib/serviceWorker.js owns the key, the
// reader/writer and applyServiceWorker(); useShellPrefs calls it gated on
// `bookingsReady`, so a build that cannot reach Firebase can never cache itself
// and serve itself back. Read the "offline shell" section in CLAUDE.md before
// touching any of it: an installed worker cannot be withdrawn by reverting the
// deploy, which is what made the v17.4.0 outage expensive.
