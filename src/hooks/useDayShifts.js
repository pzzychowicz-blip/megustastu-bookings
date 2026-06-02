// src/hooks/useDayShifts.js
//
// v14.6.0: Day-shifts subsystem. Owns the editable Afternoon/Evening split
// hour, persisted to Firebase under `settings/dayShifts` and SHARED across
// devices — the app's SECOND Firebase `settings` node (after
// `settings/operatingHours`). Restaurant-wide config, so it lives in Firebase,
// not localStorage (same rule as operating hours; see CLAUDE.md).
//
// Model: ONE split hour. Afternoon = OPEN..split, Evening = split..CLOSE — two
// contiguous shifts with no gap/overlap possible. Drives the day Summary
// panel's per-shift cover totals.
//
// Write-guard mirrors useOperatingHours: a `loaded` ref refuses writes until
// the initial read completes, so a stray early write can't clobber the node.
// The empty-array guard doesn't apply (small object, not a collection).

import { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase";
import { OPEN, CLOSE } from "../lib/constants";

// Clamp the split strictly inside the service window so BOTH shifts stay
// non-empty. Reads OPEN/CLOSE at call time (they're live module bindings that
// useOperatingHours may have updated). Defensive against malformed Firebase data.
function sanitizeSplit(split){
  let s = Math.round(Number(split));
  if(!Number.isFinite(s)) s = 17;
  s = Math.max(OPEN + 1, Math.min(CLOSE - 1, s));
  return s;
}

export function useDayShifts(){
  // Seed with the 17:00 default until Firebase responds.
  const [dayShifts, setDS] = useState({ split: 17 });
  const loaded = useRef(false);

  useEffect(function(){
    const unsub = onValue(ref(db, "settings/dayShifts"), function(snap){
      const val = snap.val();
      if(val && typeof val === "object" && val.split != null){
        setDS({ split: sanitizeSplit(val.split) });
      }
      // Node absent (first run): keep the 17:00 default — nothing to push.
      loaded.current = true;
    });
    return unsub;
  }, []);

  // Guarded write — refuse until the initial read has landed. Applies locally
  // right away for snappy UI; the onValue echo re-applies the same value.
  function saveDayShifts(split){
    if(!loaded.current){
      console.warn("[SAFE] Refused to write dayShifts — initial read has not completed yet.");
      return;
    }
    const s = sanitizeSplit(split);
    setDS({ split: s });
    set(ref(db, "settings/dayShifts"), { split: s }).catch(function(){});
  }

  return { dayShifts, saveDayShifts };
}
