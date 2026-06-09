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
// v15.0.0 ships the full editor: tables (add/remove/rename, capacity, zone),
// join-groups, auto-combo caps, and cross-group combos — all via LayoutTabContent.

import { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase";
import { DEFAULT_LAYOUT, setLayout } from "../lib/constants";

// Validate + clamp a layout config. Drops malformed/duplicate tables; coerces
// capacity (1–20) and zone ("indoor"|"outdoor"); falls back to DEFAULT_LAYOUT
// when nothing usable remains. Defensive against malformed Firebase data.
//
// v15.0.0 Phase 4: also carries the combo config — joinGroups / comboCaps /
// megaCombos. When a field is absent (e.g. a Phase-3 node that predates combos),
// it seeds from DEFAULT_LAYOUT so the node migrates to MGT's combos on first save.
// Every combo reference is filtered to the CURRENT table ids, so stored config
// never points at a removed table (buildLayout also self-heals at derive time).
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
  const idSet = {}; tables.forEach(function(t){ idSet[t.id] = true; });

  let kitchenLimit = Math.round(Number(val.kitchenLimit));
  if(!Number.isFinite(kitchenLimit)) kitchenLimit = 3;
  kitchenLimit = Math.max(1, Math.min(20, kitchenLimit));

  // joinGroups: arrays of existing ids; empty groups dropped. A table may belong
  // to only ONE group (CLUSTERS uses .find = first match), so an id already claimed
  // by an earlier group — or repeated within a group — is filtered out (first-wins).
  const rawGroups = Array.isArray(val.joinGroups) ? val.joinGroups : DEFAULT_LAYOUT.joinGroups;
  const usedInGroup = {};
  const joinGroups = (rawGroups || [])
    .map(function(g){
      return (Array.isArray(g) ? g : []).map(String).filter(function(id){
        if(!idSet[id] || usedInGroup[id]) return false;
        usedInGroup[id] = true;
        return true;
      });
    })
    .filter(function(g){ return g.length > 0; });

  // comboCaps: numeric overrides (1–60); keys whose ids all still exist are kept.
  const rawCaps = (val.comboCaps && typeof val.comboCaps === "object") ? val.comboCaps : DEFAULT_LAYOUT.comboCaps;
  const comboCaps = {};
  Object.keys(rawCaps || {}).forEach(function(k){
    if(String(k).split("|").every(function(id){ return idSet[id]; })){
      const c = Math.round(Number(rawCaps[k]));
      if(Number.isFinite(c)) comboCaps[k] = Math.max(1, Math.min(60, c));
    }
  });

  // megaCombos: {ids,cap}; need ≥2 existing ids, cap clamped 1–60.
  const rawMega = Array.isArray(val.megaCombos) ? val.megaCombos : DEFAULT_LAYOUT.megaCombos;
  const megaCombos = [];
  (rawMega || []).forEach(function(mc){
    if(!mc || !Array.isArray(mc.ids)) return;
    const ids = mc.ids.map(String).filter(function(id){ return idSet[id]; });
    if(ids.length < 2 || ids.length !== mc.ids.length) return;
    let c = Math.round(Number(mc.cap));
    if(!Number.isFinite(c)) c = ids.length * 2;
    megaCombos.push({ ids: ids, cap: Math.max(1, Math.min(60, c)) });
  });

  return { tables: tables, joinGroups: joinGroups, comboCaps: comboCaps, megaCombos: megaCombos, kitchenLimit: kitchenLimit };
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
