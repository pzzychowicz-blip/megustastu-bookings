// src/firebase.js
// Environment-aware, tenant-selected Firebase initialisation.
//   npm run dev    (import.meta.env.DEV === true)  → the shared DEV project
//   npm run build  (import.meta.env.DEV === false) → the SELECTED TENANT's project
//
// This split exists so local development and Claude Code sessions
// never write to the production database. The Spark plan has no
// automatic backups; isolating dev writes is the only safety net.
//
// ── v18.0.0 phase 2: the tenant layer ────────────────────────────────────────
// `VITE_TENANT=<slug>` selects a module under `src/tenants/`, each exporting
// `{ firebaseConfig, profile }`. Absent, it is `mgt` — so an unset env var
// builds exactly what this file built before, which is what makes the
// generalisation invisible to the one tenant that exists.
//
// **The DEV/PROD split is preserved exactly and comes FIRST.** `isDev` is
// resolved before the tenant is consulted, and in DEV the tenant's config is
// not read at all: there is ONE dev sandbox shared by every tenant, so
// localhost can never reach any restaurant's production database however
// `VITE_TENANT` is set. The tenant selection changes which PROD project a BUILD
// points at, and nothing else.
//
// An unknown slug THROWS rather than falling back, and so does a tenant module
// of the wrong shape. A typo'd tenant that silently resolved to MGT would point
// one restaurant's build at another restaurant's live bookings — the one failure
// mode this layer must not have, and the boot watchdog in index.html turns the
// throw into a visible message. See the `hasOwnProperty` note at the lookup:
// the first version of that guard was bypassable by five inherited keys.
//
// Note on API keys: Firebase web API keys are NOT secrets — they
// identify the project, they don't authorise access. Database Rules
// are the actual security layer. Hardcoding both configs is safe.

import { initializeApp } from "firebase/app";
import { getDatabase, forceWebSockets } from "firebase/database";
import { getAuth } from "firebase/auth";
import * as mgt from "./tenants/mgt";

// Statically imported and statically keyed, deliberately: a build-time map is
// something the bundler, `grep` and a reader can all see through, where a
// dynamic import would hide which tenants exist. Adding a restaurant is a new
// module plus a line here.
const TENANTS = { mgt };

const tenantSlug = import.meta.env.VITE_TENANT || "mgt";

// `hasOwnProperty`, not a bare `TENANTS[slug]`. An object literal inherits from
// `Object.prototype`, so `TENANTS["toString"]` / `"constructor"` / `"valueOf"` /
// `"hasOwnProperty"` / `"__proto__"` all return something TRUTHY — five slugs
// that walked straight past the `if (!tenant)` below, which is the one thing
// this guard exists to prevent. Measured, not reasoned about.
//
// And the shape is checked, not just the existence: a tenant module missing
// either export would otherwise pass and fail later somewhere else — in PROD on
// `firebaseConfig.projectId` in the boot line, in DEV on `profile.name` inside
// `useGeneralSettings`' module body. Both name the symptom and not the cause.
const tenant = Object.prototype.hasOwnProperty.call(TENANTS, tenantSlug)
  ? TENANTS[tenantSlug]
  : null;
if (!tenant) {
  throw new Error(
    "[firebase] Unknown VITE_TENANT \"" + tenantSlug + "\". Known tenants: " +
    Object.keys(TENANTS).join(", ")
  );
}
if (!tenant.firebaseConfig || !tenant.profile) {
  throw new Error(
    "[firebase] Tenant \"" + tenantSlug + "\" (src/tenants/" + tenantSlug +
    ".js) must export both `firebaseConfig` and `profile`."
  );
}

// Who this restaurant is, for the app rather than for Firebase. Exported from
// here — and not imported from the tenant module directly — so every consumer
// reads the SELECTED tenant rather than a hard-coded one.
export const profile = tenant.profile;

const devConfig = {
  // The ONE shared DEV sandbox — not per-tenant, which is why it stays in this
  // file rather than moving into `src/tenants/`.
  apiKey:            "AIzaSyDZ-VQNfO_t-Fj3vlbUJBeiMeBx4OmnqXY",
  authDomain:        "megustastu-bookings-dev.firebaseapp.com",
  databaseURL:       "https://megustastu-bookings-dev-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "megustastu-bookings-dev",
  storageBucket:     "megustastu-bookings-dev.firebasestorage.app",
  messagingSenderId: "709562849905",
  appId:             "1:709562849905:web:30bb72ea4d6469dd4519d0"
};

const isDev = import.meta.env.DEV;
const firebaseConfig = isDev ? devConfig : tenant.firebaseConfig;

// Visible boot signal — appears in the browser console next to the
// app version banner. Green DEV badge = safe to experiment. Red PROD
// badge = production database, every write is real.
//
// v18.0.0 phase 2: it carries the tenant too — but ONLY in PROD does the tenant
// say anything about the database, and the badge must not claim otherwise.
//
// /code-review fix: the first version printed "· tenant mgt" in both
// environments, which reads as "this database belongs to this restaurant". In
// DEV that is false — `isDev` short-circuits the tenant's `firebaseConfig`
// entirely and EVERY tenant shares the one sandbox, so two tenants run on the
// same bookings and would overwrite each other's seeded data. A badge whose
// whole job is answering "which database am I on" must not assert a scoping the
// database does not have; the pre-v17.5.1 green connection dot is the same
// mistake in the same place.
const tenantNote = isDev
  ? " · shared sandbox — tenant " + tenantSlug + " supplies the profile only"
  : " · tenant " + tenantSlug;
console.log(
  "%c[firebase] " + (isDev ? "DEV" : "PROD") + " — " + firebaseConfig.projectId + tenantNote,
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
