// src/hooks/useDayShifts.js
//
// v14.6.0: Day-shifts subsystem. Owns the editable Afternoon/Evening split
// hour, persisted to Firebase under `settings/dayShifts` and SHARED across
// devices — the app's SECOND Firebase `settings` node (after
// `settings/operatingHours`). Restaurant-wide config, so it lives in Firebase,
// not localStorage (same rule as operating hours; see CLAUDE.md).
//
// Model: `{split, enabled}`. ONE split hour — Afternoon = OPEN..split, Evening
// = split..CLOSE (two contiguous shifts, no gap/overlap). `enabled` (v14.6.0)
// turns the split on/off; when off the Summary shows no per-shift breakdown.
// Drives the day Summary panel's per-shift cover totals.
//
// Write-guard mirrors useOperatingHours: a `loaded` ref refuses writes until
// the initial read completes, so a stray early write can't clobber the node.
// The empty-array guard doesn't apply (small object, not a collection).

import { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase";
import { OPEN, CLOSE } from "../lib/constants";

// Clamp split strictly inside the service window so BOTH shifts stay non-empty;
// coerce `enabled` to a boolean (default true). Reads OPEN/CLOSE at call time
// (live module bindings useOperatingHours may have updated). Defensive against
// malformed Firebase data.
function sanitizeShifts(raw){
  const src = raw && typeof raw === "object" ? raw : {};
  let s = Math.round(Number(src.split));
  if(!Number.isFinite(s)) s = 17;
  s = Math.max(OPEN + 1, Math.min(CLOSE - 1, s));
  return { split: s, enabled: src.enabled !== false };
}

export function useDayShifts(){
  // Seed with the defaults (split 17:00, enabled) until Firebase responds.
  const [dayShifts, setDS] = useState({ split: 17, enabled: true });
  const loaded = useRef(false);

  useEffect(function(){
    const unsub = onValue(ref(db, "settings/dayShifts"), function(snap){
      const val = snap.val();
      if(val && typeof val === "object"){
        setDS(sanitizeShifts(val));
      }
      // Node absent (first run): keep the defaults — nothing to push.
      loaded.current = true;
    });
    return unsub;
  }, []);

  // Guarded write. Accepts a PARTIAL update ({split} and/or {enabled}); merges
  // with current state, sanitizes, applies locally for snappy UI, then writes
  // the whole object (the onValue echo re-applies the same values).
  function saveDayShifts(partial){
    if(!loaded.current){
      console.warn("[SAFE] Refused to write dayShifts — initial read has not completed yet.");
      return;
    }
    const next = sanitizeShifts({ ...dayShifts, ...(partial || {}) });
    setDS(next);
    set(ref(db, "settings/dayShifts"), next).catch(function(){});
  }

  return { dayShifts, saveDayShifts };
}
