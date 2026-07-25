import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// v17.4.0 (PWA): register the offline-shell service worker — PRODUCTION ONLY.
// In dev a SW would cache-shadow Vite's module graph and make HMR lie; the
// registration is also bundled here (NOT an inline <script> in index.html)
// because the CSP pins exactly ONE inline-script hash — a second inline block
// would be blocked in prod. See public/sw.js for the (deliberately
// conservative) caching strategy.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}
