// src/hooks/useOptimizerSettings.js
//
// v15.0.0: Optimizer-settings subsystem. Owns the editable auto-optimizer
// behaviour — the daily `cutoff` hour (when the optimizer auto-stops reshuffling
// today's bookings) and `autoSwitch` (the master on/off for the whole automatic
// cutoff/overnight cycle). Persisted to Firebase under `settings/optimizer` and
// SHARED across devices — restaurant-wide config, so it lives in Firebase, not
// localStorage (same rule as operating hours / day shifts; see CLAUDE.md).
//
// Model: `{ cutoff, autoSwitch }`.
//   • cutoff     — hour (e.g. 15 = 15:00) at which today's optimizer flips OFF.
//   • autoSwitch — when false, NO automatic transitions fire (fully manual: the
//                  optimizer only changes via the `o` shortcut / timeline toggle).
// Consumed by useAutoOptimizer, whose two daily-reset effects read these.
//
// Write-guard mirrors useOperatingHours / useDayShifts: a `loaded` ref refuses
// writes until the initial read completes, so a stray early write can't clobber
// the node. The empty-array guard doesn't apply (small object, not a collection).

import { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase";
import { OPEN, CLOSE } from "../lib/constants";

// Clamp the cutoff inside the service window and coerce `autoSwitch` to a
// boolean (default true). Reads OPEN/CLOSE at call time (live module bindings).
// Defensive against malformed Firebase data.
function sanitizeOptimizer(raw){
  const src = raw && typeof raw === "object" ? raw : {};
  let c = Math.round(Number(src.cutoff));
  if(!Number.isFinite(c)) c = 15;
  c = Math.max(OPEN + 1, Math.min(CLOSE, c));
  return { cutoff: c, autoSwitch: src.autoSwitch !== false };
}

export function useOptimizerSettings(){
  // Seed with the defaults (cutoff 15:00, auto-switch on) until Firebase responds —
  // these match the previously hard-coded behaviour, so an absent node is a no-op.
  const [optimizerSettings, setOS] = useState({ cutoff: 15, autoSwitch: true });
  const loaded = useRef(false);

  useEffect(function(){
    const unsub = onValue(ref(db, "settings/optimizer"), function(snap){
      const val = snap.val();
      if(val && typeof val === "object"){
        setOS(sanitizeOptimizer(val));
      }
      // Node absent (first run): keep the defaults — nothing to push.
      loaded.current = true;
    });
    return unsub;
  }, []);

  // Guarded write. Accepts a PARTIAL update ({cutoff} and/or {autoSwitch}); merges
  // with current state, sanitizes, applies locally for snappy UI, then writes the
  // whole object (the onValue echo re-applies the same values).
  function saveOptimizerSettings(partial){
    if(!loaded.current){
      console.warn("[SAFE] Refused to write optimizer settings — initial read has not completed yet.");
      return;
    }
    const next = sanitizeOptimizer({ ...optimizerSettings, ...(partial || {}) });
    setOS(next);
    set(ref(db, "settings/optimizer"), next).catch(function(){});
  }

  return { optimizerSettings, saveOptimizerSettings };
}
