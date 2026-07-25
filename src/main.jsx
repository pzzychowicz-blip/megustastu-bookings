import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// v17.4.1: the v17.4.0 service-worker registration was REMOVED. In production
// that worker froze the app at "⟳ Loading bookings…" on iPhone and iPad (the
// first Firebase snapshot never arrived) while desktop was fine, and it was not
// reproducible locally. Nothing registers a service worker any more.
//
// public/sw.js still exists, but only as a KILL SWITCH that unregisters the
// already-installed workers and clears their caches — see the comment there.
// Do NOT re-add a registration without reading the "PWA — withdrawn in v17.4.1"
// note in CLAUDE.md first: a bad worker persists on the device and cannot be
// fixed by reverting the deploy, which is what made this outage expensive.
