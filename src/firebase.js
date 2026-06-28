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
import { getDatabase } from "firebase/database";
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

// Build-time override (WA sandbox deployment). A Vercel build runs `vite build`,
// where import.meta.env.DEV is false — so a deployed build would otherwise pick
// the PROD config. The sandbox Vercel project sets VITE_FB_TARGET=dev to force
// the DEV project; prod leaves it unset and behaves exactly as before. Accepts
// "dev" | "prod"; anything else falls back to the import.meta.env.DEV default.
const __fbTarget = import.meta.env.VITE_FB_TARGET;
const isDev = __fbTarget === "dev" ? true
            : __fbTarget === "prod" ? false
            : import.meta.env.DEV;
const firebaseConfig = isDev ? devConfig : prodConfig;

// Visible boot signal — appears in the browser console next to the
// app version banner. Green DEV badge = safe to experiment. Red PROD
// badge = production database, every write is real.
console.log(
  "%c[firebase] " + (isDev ? "DEV" : "PROD") + " — " + firebaseConfig.projectId,
  "background:" + (isDev ? "#0a0" : "#c00") + ";color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold;"
);

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
