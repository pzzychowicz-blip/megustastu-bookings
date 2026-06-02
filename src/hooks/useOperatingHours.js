// src/hooks/useOperatingHours.js
//
// v14.4.0: Operating-hours subsystem. Owns the editable restaurant service
// window (open / close hour), persisted to Firebase under
// `settings/operatingHours` and SHARED across devices — this is the app's FIRST
// Firebase `settings` node. (Theme stays per-device in localStorage; only
// restaurant-wide config goes to Firebase. See CLAUDE.md.)
//
// On each Firebase snapshot the hook (a) pushes the hours into constants.js via
// `setOperatingHours()` so the live ESM bindings OPEN / CLOSE / GRID_CLOSE /
// QUARTER_HOURS update for every importer — including booking-logic's pure
// functions — with no signature changes, and (b) sets React state so BookingApp
// re-renders and the timeline/forms repaint with the new range.
//
// Write-guard: mirrors usePersistence — a `loaded` ref refuses writes until the
// initial read completes, so a stray early write can't clobber the node. The
// empty-array guard doesn't apply here (this node is a small object, not a
// collection). open < close is enforced by sanitizeHours on both read and write.

import { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase";
import { OPEN, CLOSE, setOperatingHours } from "../lib/constants";

// Clamp to sane bounds and keep open < close. Mirrors the Settings editor limits.
// open in [8..21], close in [open+1..23]. Defensive against malformed Firebase
// data (missing / NaN / inverted), since this drives the whole time axis.
function sanitizeHours(open, close){
  let o = Math.round(Number(open));
  let c = Math.round(Number(close));
  if(!Number.isFinite(o)) o = 13;
  if(!Number.isFinite(c)) c = 22;
  o = Math.max(8, Math.min(21, o));
  c = Math.max(o + 1, Math.min(23, c));
  return { open: o, close: c };
}

export function useOperatingHours(){
  // Seed from the constants.js defaults (13/22) until Firebase responds.
  const [operatingHours, setOH] = useState({ open: OPEN, close: CLOSE });
  const loaded = useRef(false);

  useEffect(function(){
    const unsub = onValue(ref(db, "settings/operatingHours"), function(snap){
      const val = snap.val();
      if(val && typeof val === "object"){
        const h = sanitizeHours(val.open, val.close);
        setOperatingHours(h.open, h.close); // update live module bindings
        setOH(h);                            // trigger React repaint
      }
      // Node absent (first run): keep the 13/22 defaults already applied at
      // import — nothing to push.
      loaded.current = true;
    });
    return unsub;
  }, []);

  // Guarded write — refuse until the initial read has landed. Applies locally
  // right away for snappy UI; the onValue echo re-applies the same values
  // (Firebase stays the single source of truth).
  function saveOperatingHours(open, close){
    if(!loaded.current){
      console.warn("[SAFE] Refused to write operatingHours — initial read has not completed yet.");
      return;
    }
    const h = sanitizeHours(open, close);
    setOperatingHours(h.open, h.close);
    setOH(h);
    set(ref(db, "settings/operatingHours"), h).catch(function(){});
  }

  return { operatingHours, saveOperatingHours };
}
