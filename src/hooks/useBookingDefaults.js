// src/hooks/useBookingDefaults.js
//
// v16.1.0: Booking-defaults subsystem — the 5th `settings` node. Owns two
// restaurant-wide knobs (Firebase-shared, NOT localStorage — same rule as the
// other settings hooks; see CLAUDE.md):
//
//   1. Default booking DURATIONS by party size — three tiers with editable
//      band boundaries: size ≤ t1Max → t1Dur min, ≤ t2Max → t2Dur, else t3Dur.
//      Consumed by booking-logic's getDur() via the DUR_TIERS live binding
//      (setDurTiers, same mechanism as setLayout/setActiveDayHours). Only NEW
//      bookings pick up a change — stored duration/originalDuration are frozen.
//   2. RUNNING-LATE thresholds — a confirmed booking lateWarnMin+ minutes past
//      its time (today, not seated) highlights amber; at lateNoShowMin+ the UI
//      offers a one-tap "No show". lateEnabled is the master switch. Consumed
//      by booking-logic's lateState() via the lateMap derivation in BookingApp.
//
// Model: { v, t1Max, t1Dur, t2Max, t2Dur, t3Dur, lateEnabled, lateWarnMin,
// lateNoShowMin }. `v:1` is the presence marker (RTDB drops empty objects —
// the v15.9.0 priorities lesson). Seed = the historical hard-coded behaviour
// (90/90/120, warn 15 / no-show 20), so an absent node is a no-op.
//
// Write-guard mirrors useOptimizerSettings: `loaded` ref refuses writes until
// the initial read completes; revGuard CAS (bookingDefaultsRev) rejects a stale
// device's overwrite server-side (the v16.0.0 rule of law for new nodes).

import { useState, useRef, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { setDurTiers } from "../lib/constants";

export const DEFAULT_BOOKING_DEFAULTS = {
  v: 1,
  t1Max: 1, t1Dur: 90,
  t2Max: 4, t2Dur: 90,
  t3Dur: 120,
  lateEnabled: true,
  lateWarnMin: 15,
  lateNoShowMin: 20
};

// Clamp helpers. Durations snap to the 15-min grid (the app's quarter-hour
// resolution); late thresholds to 5-min steps. Band bounds keep t1Max < t2Max.
function clampStep(n, def, min, max, step){
  let v = Math.round(Number(n) / step) * step;
  if(!Number.isFinite(v)) v = def;
  return Math.max(min, Math.min(max, v));
}

function sanitizeBookingDefaults(raw){
  const src = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_BOOKING_DEFAULTS;
  let t1Max = clampStep(src.t1Max, d.t1Max, 1, 19, 1);
  let t2Max = clampStep(src.t2Max, d.t2Max, 2, 20, 1);
  if(t2Max <= t1Max) t2Max = t1Max + 1; // invariant: t1Max < t2Max
  const out = {
    v: 1,
    t1Max: t1Max,
    t1Dur: clampStep(src.t1Dur, d.t1Dur, 15, 360, 15),
    t2Max: t2Max,
    t2Dur: clampStep(src.t2Dur, d.t2Dur, 15, 360, 15),
    t3Dur: clampStep(src.t3Dur, d.t3Dur, 15, 360, 15),
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
