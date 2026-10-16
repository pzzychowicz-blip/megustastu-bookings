// src/wa-connect/main.jsx — the /wa-connect page's entry (v18.9.0), built by
// its own config (vite.wa-connect.config.js). It shares the app's
// stylesheet, its Firebase project (src/firebase.js, so the DEV/PROD split
// holds here too) and the sign-in already on this device; nothing else of the
// app is loaded.
import "../index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { APP_NAME } from "../lib/constants";
import { ConnectPage } from "./ConnectPage";

// The theme the app would paint, read the way index.html's boot script reads
// it (the stored choice, else the OS). That script cannot run here: this page
// has no inline script, and its CSP pins no hash. A module may, and does it
// before the first paint of the React tree.
(function applyTheme() {
  let saved = null;
  try { saved = localStorage.getItem("mgt-theme"); } catch { /* storage blocked: follow the OS */ }
  const dark = saved === "dark" || (saved !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();

// "Reduce animations" (Settings → App), the per-device flag, stamped the way
// index.html's boot script stamps it. Without it every press, hover and Reveal
// on this page played on a device that had asked for none
// (/find-animation-opportunities, v18.9.0). The OS setting needs nothing here:
// it is a media query in the stylesheet this page shares.
(function applyReduceMotion() {
  try {
    if (localStorage.getItem("mgt-reduce-motion") === "1") document.documentElement.dataset.motion = "reduce";
  } catch { /* storage blocked: the OS setting still applies */ }
})();

// iOS Safari delivers `:active` only when the document has a touch listener,
// so without one the press dip (`.mgt-press`) never plays on an iPhone or
// iPad. index.html's boot script adds this empty passive listener for the
// app; this page has its own entry, so it adds its own. Passive, so it can
// never hold up a scroll.
document.addEventListener("touchstart", function () {}, { passive: true });

document.title = "Connect WhatsApp · " + APP_NAME;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ConnectPage />
  </StrictMode>
);
