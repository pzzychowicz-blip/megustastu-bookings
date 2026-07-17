// src/hooks/useGeneralSettings.js
//
// v17.0.0: General/branding settings — the 6th `settings` node (Firebase-shared,
// restaurant-wide config; the multi-tenancy configurability pass). Owns the
// remaining ex-hard-coded knobs, chosen with Patryk:
//
//   restaurantName — the header title + the printable day-sheet title
//                    (was the "Me Gustas Tú" literal in App.jsx / DaySheet).
//   currency       — the deposit currency symbol (was "€" in the form label,
//                    ListView chip, timeline marker, day sheet).
//   phonePrefix    — the phone field's seed (was the bare "+"); a typing
//                    convenience, e.g. "+34".
//   regularMin     — visits needed for the "Regular" label (was 2): the form's
//                    Regular chip AND the Customers-tab Regulars filter initial.
//   lateCollapseMax— a rows banner (Running-late, Overlap warnings, Waitlist
//                    "table free" — all on the BannerRows shell) starts
//                    COLLAPSED when it has more than this many rows (was 2,
//                    LateBanner open init; applied to all three in v17.1.0 —
//                    field name kept for back-compat, no data migration).
//   waitMatchWin   — the waitlist matcher's ± window (minutes) around the
//                    wanted time (was ±90 in the waitAvail effect).
//   undoSecs       — how long the undo-after-cancel toast stays (was 10 s).
//
// Model: { v, restaurantName, currency, phonePrefix, regularMin,
// lateCollapseMax, waitMatchWin, undoSecs }. `v:1` is the presence marker
// (the v15.9.0 priorities lesson). Seed = the historical literals, so an
// absent node is a no-op. Write-guard mirrors useBookingDefaults: `loaded`
// ref + revGuard CAS (generalRev) — the v16.0.0 rule of law for new nodes.
// NOTE: the generalRev rules pair in database.rules.json is Patryk's console
// step (DEV then PROD, app-first — rolling-safe, old rules ignore the node).

import { useState, useRef, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";

export const DEFAULT_GENERAL_SETTINGS = {
  v: 1,
  restaurantName: "Me Gustas Tú",
  currency: "€",
  phonePrefix: "+",
  regularMin: 2,
  lateCollapseMax: 2,
  waitMatchWin: 90,
  undoSecs: 10
};

function clampStep(n, def, min, max, step){
  // NaN check AFTER the round (see useBookingDefaults for the why).
  let v = Math.round(Number(n) / step) * step;
  if(!Number.isFinite(v)) v = def;
  return Math.max(min, Math.min(max, v));
}

// Short free-text fields: trim, cap length, fall back to the default when
// empty (an empty restaurant name / currency renders as a hole in the UI).
function cleanText(raw, def, maxLen){
  const s = typeof raw === "string" ? raw.trim().slice(0, maxLen) : "";
  return s || def;
}

function sanitizeGeneral(raw){
  const src = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_GENERAL_SETTINGS;
  // phonePrefix: always starts with "+", digits only after it, ≤5 chars total.
  let prefix = typeof src.phonePrefix === "string" ? src.phonePrefix.trim() : d.phonePrefix;
  prefix = "+" + prefix.replace(/[^\d]/g, "").slice(0, 4);
  return {
    v: 1,
    restaurantName: cleanText(src.restaurantName, d.restaurantName, 60),
    currency: cleanText(src.currency, d.currency, 4),
    phonePrefix: prefix,
    regularMin: clampStep(src.regularMin, d.regularMin, 1, 50, 1),
    lateCollapseMax: clampStep(src.lateCollapseMax, d.lateCollapseMax, 1, 20, 1),
    waitMatchWin: clampStep(src.waitMatchWin, d.waitMatchWin, 15, 240, 15),
    undoSecs: clampStep(src.undoSecs, d.undoSecs, 5, 60, 5)
  };
}

export function useGeneralSettings(){
  const [generalSettings, setGS] = useState(DEFAULT_GENERAL_SETTINGS);
  const loaded = useRef(false);
  const revRef = useRef(0);
  useEffect(function(){ return attachRev("settings/general", revRef); }, []);

  useEffect(function(){
    const unsub = onValue(ref(db, "settings/general"), function(snap){
      const val = snap.val();
      if(val && typeof val === "object"){
        setGS(sanitizeGeneral(val));
      }
      // Node absent (first run): keep the defaults (= the historical literals).
      loaded.current = true;
    });
    return unsub;
  }, []);

  // Guarded write; accepts a PARTIAL update (the useBookingDefaults contract).
  function saveGeneralSettings(partial){
    if(!loaded.current){
      console.warn("[SAFE] Refused to write general settings — initial read has not completed yet.");
      return;
    }
    const next = sanitizeGeneral({ ...generalSettings, ...(partial || {}) });
    setGS(next);
    writeWithRev("settings/general", next, revRef);
  }

  return { generalSettings, saveGeneralSettings };
}
