// src/hooks/useBookingDefaults.js
//
// v16.1.0: Booking-defaults subsystem — the 5th `settings` node. Owns two
// restaurant-wide knobs (Firebase-shared, NOT localStorage — same rule as the
// other settings hooks; see CLAUDE.md):
//
//   1. Default booking DURATIONS by party size — an EDITABLE LIST of tiers
//      (`tiers: [{max, dur}, …]`, sorted by ascending `max`) plus a catch-all
//      `restDur` for parties above the last tier. Size s gets the first tier
//      with s ≤ max, else restDur. Consumed by booking-logic's getDur() via
//      the DUR_TIERS live binding (setDurTiers, same mechanism as setLayout/
//      setActiveDayHours). Only NEW bookings pick up a change — stored
//      duration/originalDuration are frozen.
//   2. RUNNING-LATE thresholds — a confirmed booking lateWarnMin+ minutes past
//      its time (today, not seated) highlights amber; at lateNoShowMin+ the UI
//      offers a one-tap "No show". lateEnabled is the master switch. Consumed
//      by booking-logic's lateState() via the lateMap derivation in BookingApp.
//
// Model: { v, tiers: [{max, dur}…], restDur, lateEnabled, lateWarnMin,
// lateNoShowMin }. `v:1` is the presence marker (RTDB drops empty objects —
// the v15.9.0 priorities lesson; it also drops an EMPTY tiers array, so a
// PRESENT node with no tiers reads as [] — all parties get restDur — never
// as the default tiers). Seed = the historical hard-coded behaviour
// (≤1→90, ≤4→90, else 120; warn 15 / no-show 20), so an absent node is a
// no-op. A legacy flat v16.1.0 node ({t1Max, t1Dur, …}) converts on read and
// is rewritten in the new shape on the next save (lazy migration, the
// operating-hours pattern).
//
// Write-guard mirrors useOptimizerSettings: `loaded` ref refuses writes until
// the initial read completes; revGuard CAS (bookingDefaultsRev) rejects a stale
// device's overwrite server-side (the v16.0.0 rule of law for new nodes).

import { useState, useRef, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { setDurTiers } from "../lib/constants";

export const MAX_TIERS = 6;

export const DEFAULT_BOOKING_DEFAULTS = {
  v: 1,
  tiers: [{ max: 1, dur: 90 }, { max: 4, dur: 90 }],
  restDur: 120,
  lateEnabled: true,
  lateWarnMin: 15,
  lateNoShowMin: 20
};

// Clamp helpers. Durations snap to the 15-min grid (the app's quarter-hour
// resolution); late thresholds to 5-min steps.
function clampStep(n, def, min, max, step){
  let v = Math.round(Number(n) / step) * step;
  if(!Number.isFinite(v)) v = def;
  return Math.max(min, Math.min(max, v));
}

// Tier list: clamp each entry, sort ascending by `max`, drop duplicate maxes
// (first wins), cap the count. An empty/absent list is VALID (all parties →
// restDur) — per the priorities lesson, a present node's missing array field
// means EMPTY, never "fall back to the defaults".
function sanitizeTiers(raw){
  const src = Array.isArray(raw) ? raw : [];
  const out = [];
  src.forEach(function(t){
    if(!t || typeof t !== "object") return;
    const max = clampStep(t.max, NaN, 1, 19, 1);
    if(!Number.isFinite(max)) return;
    if(out.some(function(o){ return o.max === max; })) return;
    out.push({ max: max, dur: clampStep(t.dur, 90, 15, 360, 15) });
  });
  out.sort(function(a, b){ return a.max - b.max; });
  return out.slice(0, MAX_TIERS);
}

function sanitizeBookingDefaults(raw){
  const src = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_BOOKING_DEFAULTS;
  // Legacy v16.1.0 flat shape ({t1Max,t1Dur,t2Max,t2Dur,t3Dur}) → tier list.
  let tiers, restDur;
  if(!("tiers" in src) && !("restDur" in src) && ("t1Max" in src || "t3Dur" in src)){
    tiers = sanitizeTiers([
      { max: src.t1Max, dur: src.t1Dur },
      { max: src.t2Max, dur: src.t2Dur }
    ]);
    restDur = clampStep(src.t3Dur, d.restDur, 15, 360, 15);
  } else {
    tiers = sanitizeTiers(src.tiers);
    restDur = clampStep(src.restDur, d.restDur, 15, 360, 15);
  }
  const out = {
    v: 1,
    tiers: tiers,
    restDur: restDur,
    lateEnabled: src.lateEnabled !== false,
    lateWarnMin: clampStep(src.lateWarnMin, d.lateWarnMin, 5, 115, 5),
    lateNoShowMin: clampStep(src.lateNoShowMin, d.lateNoShowMin, 10, 120, 5)
  };
  // invariant: warn strictly before the no-show offer
  if(out.lateNoShowMin <= out.lateWarnMin) out.lateNoShowMin = out.lateWarnMin + 5;
  return out;
}

export function useBookingDefaults(){
  const [bookingDefaults, setBD] = useState(DEFAULT_BOOKING_DEFAULTS);
  const loaded = useRef(false);
  // revision-CAS ref (lib/revGuard.js) — stale-device overwrites rejected
  // server-side; the rollback echo restores state via onValue.
  const revRef = useRef(0);
  useEffect(function(){ return attachRev("settings/bookingDefaults", revRef); }, []);

  useEffect(function(){
    const unsub = onValue(ref(db, "settings/bookingDefaults"), function(snap){
      const val = snap.val();
      if(val && typeof val === "object"){
        const next = sanitizeBookingDefaults(val);
        setDurTiers(next);   // point the DUR_TIERS live binding at the config
        setBD(next);         // repaint so consumers re-read it
      }
      // Node absent (first run): keep the defaults (= the historical literals).
      loaded.current = true;
    });
    return unsub;
  }, []);

  // Guarded write. Accepts a PARTIAL update; merges with current state,
  // sanitizes, applies locally for snappy UI (incl. the live binding), then
  // writes the whole object (the onValue echo re-applies the same values).
  function saveBookingDefaults(partial){
    if(!loaded.current){
      console.warn("[SAFE] Refused to write booking defaults — initial read has not completed yet.");
      return;
    }
    const next = sanitizeBookingDefaults({ ...bookingDefaults, ...(partial || {}) });
    setDurTiers(next);
    setBD(next);
    writeWithRev("settings/bookingDefaults", next, revRef);
  }

  return { bookingDefaults, saveBookingDefaults };
}
