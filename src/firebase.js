// src/firebase.js
// Environment-aware Firebase initialisation.
//   npm run dev    (import.meta.env.DEV === true)  → DEV project
//   npm run build  (import.meta.env.DEV === false) → PROD project
//
// This split exists so local development and Claude Code sessions
// never write to the production database. The Spark plan has no
// automatic backups; isolating dev writes is the only safety net.
//
// Note on API keys: Firebase web API keys are NOT secrets — they
// identify the project, they don't authorise access. Database Rules
// are the actual security layer. Hardcoding both configs is safe.

import { initializeApp } from "firebase/app";
import { getDatabase, forceWebSockets } from "firebase/database";
import { getAuth } from "firebase/auth";

const prodConfig = {
  apiKey:            "AIzaSyAliFpmNhdZjaix-EecY_0ZN99m0dktL-s",
  authDomain:        "megustastu-bookings.firebaseapp.com",
  databaseURL:       "https://megustastu-bookings-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "megustastu-bookings",
  storageBucket:     "megustastu-bookings.firebasestorage.app",
  messagingSenderId: "263618028611",
  appId:             "1:263618028611:web:c851ef6291387a895020f6"
};

const devConfig = {
  // ─── PASTE DEV PROJECT CONFIG VALUES HERE ──────────────────────────────────
  apiKey:            "AIzaSyDZ-VQNfO_t-Fj3vlbUJBeiMeBx4OmnqXY",
  authDomain:        "megustastu-bookings-dev.firebaseapp.com",
  databaseURL:       "https://megustastu-bookings-dev-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "megustastu-bookings-dev",
  storageBucket:     "megustastu-bookings-dev.firebasestorage.app",
  messagingSenderId: "709562849905",
  appId:             "1:709562849905:web:30bb72ea4d6469dd4519d0"
};

const isDev = import.meta.env.DEV;
const firebaseConfig = isDev ? devConfig : prodConfig;

// Visible boot signal — appears in the browser console next to the
// app version banner. Green DEV badge = safe to experiment. Red PROD
// badge = production database, every write is real.
console.log(
  "%c[firebase] " + (isDev ? "DEV" : "PROD") + " — " + firebaseConfig.projectId,
  "background:" + (isDev ? "#0a0" : "#c00") + ";color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold;"
);

const app = initializeApp(firebaseConfig);

// ── v17.5.1: WebSocket-only transport (the Android-tablet outage fix) ────────
// The RTDB SDK has two transports. WebSocket is the default; when a WebSocket
// attempt fails ONCE it records `firebase:previous_websocket_failure` in
// localStorage and from then on prefers LONG-POLLING on every subsequent load —
// permanently, on that device, until storage is cleared.
//
// That fallback is JSONP: it injects <script> tags into a hidden iframe
// (@firebase/database index.esm.js — createIFrame_ / doc.createElement('script')).
// Script tags are governed by the CSP's `script-src`, NOT by `connect-src`, and
// vercel.json's script-src is 'self' + one inline hash. So on any device that
// ever had a single WebSocket blip, EVERY read was blocked by CSP, forever, with
// exponential backoff — while `connect-src wss://*.firebasedatabase.app` made
// the WebSocket path look perfectly configured.
//
// That is exactly what happened to the restaurant's Android tablet: one blip,
// then a permanently dead app that no amount of reloading could fix, while the
// MacBook and iPhone (which never blipped) were fine on the same code and the
// same network. Verified on the device over USB/CDP — clearing that one
// localStorage key restored it instantly.
//
// forceWebSockets() calls BrowserPollConnection.forceDisallow(), so the JSONP
// transport is never selected and the cached failure flag becomes INERT.
//
// Deliberately NOT the alternative fix (widening script-src to the RTDB hosts):
// that was tested on the affected tablet and is INSUFFICIENT — with the hosts
// allowed the .lp scripts loaded and returned 200s, but the app still never
// received data. It would have widened the CSP for no benefit.
//
// Trade-off, accepted: no fallback on a network that blocks WebSocket outright.
// That costs nothing today, because the long-poll fallback is already 100%
// non-functional under our CSP — this replaces a silent permanent hang with a
// fast, visible connection failure (see usePersistence's load watchdog).
// MUST be called before getDatabase() — the SDK asserts transports are chosen
// before the first Database instance exists.
forceWebSockets();

export const db = getDatabase(app);
export const auth = getAuth(app);
