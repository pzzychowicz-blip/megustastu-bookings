// v17.15.1: the app stylesheet. It was an 89 kB inline <style> in index.html,
// which the service worker re-sent on every open (navigations are network-first).
// Imported here so Vite emits a hashed /assets/index-*.css — the cache-first side
// of that line. See the header of src/index.css for the full reasoning.
import "./index.css";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* v17.16.0 (CT-2A-02): until this, `<App/>` was rendered bare — and React's
        contract for an uncaught render error is to unmount the WHOLE tree, so any
        throw in render or in one of ~30 effects left `#root` empty. A white screen
        on a tablet mid-service, with no route back but a reload nobody is prompted
        to do. index.html's boot watchdog does not cover it: it fires once at T+10s
        gated on an EMPTY root, which answers "did the app never mount" rather than
        "did it mount and then throw". See src/components/ErrorBoundary.jsx. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Service worker: v17.4.0 registered one, it froze the app at
// "⟳ Loading bookings…" on iPhone and iPad in production, and v17.4.1 withdrew
// it. v17.10.1 established the root cause (a CSP-blocked JSONP fallback, fixed
// in v17.5.1 — the freeze also happened in iOS Chrome, where a service worker
// cannot run at all) and re-introduced one on strict terms.
//
// It is NOT registered here. src/lib/serviceWorker.js owns the key, the
// reader/writer and applyServiceWorker(); App.jsx calls it gated on
// `bookingsReady`, so a build that cannot reach Firebase can never cache itself
// and serve itself back. Read the "offline shell" section in CLAUDE.md before
// touching any of it: an installed worker cannot be withdrawn by reverting the
// deploy, which is what made the v17.4.0 outage expensive.
