// src/hooks/useLayout.js
//
// v15.0.0: Restaurant-layout subsystem. Owns the editable physical table layout
// (each table's id, capacity, zone) + the kitchen limit, persisted to Firebase
// under `settings/layout` and SHARED across devices — restaurant-wide config, so
// it lives in Firebase, not localStorage (same rule as operating hours / shifts /
// optimizer; see CLAUDE.md). The app's 4th `settings` node.
//
// On each snapshot the hook pushes the config into constants.js via setLayout(),
// which reassigns the live ESM bindings ALL_TABLES / INDOOR / OUTDOOR /
// TIMELINE_TABLES / TOTAL_SEATS / ZONE_OF / KITCHEN_TABLE_LIMIT / TABLE_GROUPS —
// every importer (incl. booking-logic's pure functions) sees the new layout with
// no signature changes. A React state (`layout`) drives the BookingApp repaint.
//
// Write-guard mirrors usePersistence: a `loaded` ref refuses writes until the
// initial read completes, AND a layout with no tables is refused (the layout
// equivalent of the empty-array guard) so a malformed write can't wipe the tables.
// v15.0.0 ships the capacity/zone editor; add/remove + combos arrive in Phase 4.

import { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase";
import { DEFAULT_LAYOUT, setLayout } from "../lib/constants";

// Validate + clamp a layout config. Drops malformed/duplicate tables; coerces
// capacity (1–20) and zone ("indoor"|"outdoor"); falls back to DEFAULT_LAYOUT
// when nothing usable remains. Defensive against malformed Firebase data.
function sanitizeLayout(val){
  if(!val || typeof val !== "object" || !Array.isArray(val.tables)) return DEFAULT_LAYOUT;
  const seen = {};
  const tables = [];
  val.tables.forEach(function(t){
    if(!t || typeof t !== "object") return;
    const id = String(t.id == null ? "" : t.id).trim();
    if(!id || seen[id]) return;
    seen[id] = true;
    let cap = Math.round(Number(t.capacity));
    if(!Number.isFinite(cap)) cap = 2;
    cap = Math.max(1, Math.min(20, cap));
    const zone = t.zone === "indoor" ? "indoor" : "outdoor";
    tables.push({ id: id, capacity: cap, zone: zone });
  });
  if(!tables.length) return DEFAULT_LAYOUT;
  let kitchenLimit = Math.round(Number(val.kitchenLimit));
  if(!Number.isFinite(kitchenLimit)) kitchenLimit = 3;
  kitchenLimit = Math.max(1, Math.min(20, kitchenLimit));
  return { tables: tables, kitchenLimit: kitchenLimit };
}

export function useLayout(){
  // Seeded with DEFAULT_LAYOUT (already applied to the bindings at import).
  const [layout, setLO] = useState(DEFAULT_LAYOUT);
  const loaded = useRef(false);

  useEffect(function(){
    const unsub = onValue(ref(db, "settings/layout"), function(snap){
      const val = snap.val();
      if(val && typeof val === "object"){
        const cfg = sanitizeLayout(val);
        setLayout(cfg); // update live module bindings
        setLO(cfg);     // trigger React repaint
      }
      // Node absent (first run): keep DEFAULT_LAYOUT already in force.
      loaded.current = true;
    });
    return unsub;
  }, []);

  // Guarded write. Refuses before the initial read lands, and refuses a config
  // that sanitizes down to no tables (would wipe the layout).
  function saveLayout(next){
    if(!loaded.current){
      console.warn("[SAFE] Refused to write layout — initial read has not completed yet.");
      return;
    }
    const cfg = sanitizeLayout(next);
    if(!cfg.tables.length){
      console.warn("[SAFE] Refused to write empty layout.");
      return;
    }
    setLayout(cfg);
    setLO(cfg);
    set(ref(db, "settings/layout"), cfg).catch(function(){});
  }

  return { layout, saveLayout };
}
