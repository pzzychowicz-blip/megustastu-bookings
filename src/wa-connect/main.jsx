// src/wa-connect/main.jsx — the /wa-connect page's entry (v18.9.0), Vite's
// second input beside index.html (vite.config.js). It shares the app's
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

document.title = "Connect WhatsApp · " + APP_NAME;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ConnectPage />
  </StrictMode>
);
