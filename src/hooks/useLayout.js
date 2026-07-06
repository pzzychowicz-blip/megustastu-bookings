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
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { DEFAULT_LAYOUT, setLayout, comboKey } from "../lib/constants";

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

  // v15.9.0: priorities — the data-driven optimizer heuristics. WHOLE-OBJECT
  // fallback only: an absent object (a legacy pre-v15.9.0 node) seeds from
  // DEFAULT_LAYOUT.priorities; a present object with missing fields treats each
  // field as EMPTY (never per-field default) so deliberately-cleared rule lists
  // stay cleared — RTDB drops empty arrays, hence the `v` scalar presence marker.
  // Every table reference is filtered to current ids; sizes clamp 1–99, weights 1–10.
  const rawPri = (val.priorities && typeof val.priorities === "object") ? val.priorities : DEFAULT_LAYOUT.priorities;
  const clampSize = function(n, d){
    n = Math.round(Number(n));
    if(!Number.isFinite(n)) n = d;
    return Math.max(1, Math.min(99, n));
  };
  const bands = (Array.isArray(rawPri.bands) ? rawPri.bands : []).map(function(b){
    if(!b || typeof b !== "object") return null;
    const min = clampSize(b.min, 1);
    const max = Math.max(min, clampSize(b.max, min));
    const zo = [];
    (Array.isArray(b.zoneOrder) ? b.zoneOrder : []).forEach(function(z){
      if((z === "indoor" || z === "outdoor") && zo.indexOf(z) < 0) zo.push(z);
    });
    return { min: min, max: max,
      prefer: (Array.isArray(b.prefer) ? b.prefer : []).map(String).filter(function(id){ return idSet[id]; }),
      avoid: (Array.isArray(b.avoid) ? b.avoid : []).map(String).filter(function(id){ return idSet[id]; }),
      zoneOrder: zo, combosFirst: !!b.combosFirst };
  }).filter(Boolean);
  const comboRules = (Array.isArray(rawPri.comboRules) ? rawPri.comboRules : []).map(function(r){
    if(!r || typeof r !== "object" || !r.key) return null;
    const ids = String(r.key).split("|");
    if(!ids.length || !ids.every(function(id){ return idSet[id]; })) return null;
    const min = clampSize(r.min, 1);
    const max = Math.max(min, clampSize(r.max, min));
    let w = Math.round(Number(r.weight));
    if(!Number.isFinite(w)) w = 5;
    return { key: comboKey(ids), min: min, max: max, weight: Math.max(1, Math.min(10, w)), avoid: !!r.avoid };
  }).filter(Boolean);
  const priorities = {
    v: 1,
    bands: bands,
    comboRules: comboRules,
    anchors: (Array.isArray(rawPri.anchors) ? rawPri.anchors : []).map(String).filter(function(id){ return idSet[id]; }),
    swapRules: (Array.isArray(rawPri.swapRules) ? rawPri.swapRules : []).map(function(r){
      if(!r || typeof r !== "object" || !idSet[String(r.table)]) return null;
      return { table: String(r.table), fromSize: clampSize(r.fromSize, 4), toSize: clampSize(r.toSize, 2) };
    }).filter(Boolean),
    mixedRequire: (Array.isArray(rawPri.mixedRequire) ? rawPri.mixedRequire : []).map(String).filter(function(id){ return idSet[id]; })
  };

  return { tables: tables, joinGroups: joinGroups, comboCaps: comboCaps, megaCombos: megaCombos, kitchenLimit: kitchenLimit, priorities: priorities };
}

export function useLayout(){
  // Seeded with DEFAULT_LAYOUT (already applied to the bindings at import).
  const [layout, setLO] = useState(DEFAULT_LAYOUT);
  const loaded = useRef(false);
  // v16.0.0: revision-CAS ref (lib/revGuard.js) — a stale device's overwrite is
  // rejected server-side; the rollback echo restores state via onValue.
  const revRef = useRef(0);
  useEffect(function(){ return attachRev("settings/layout", revRef); }, []);

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
    writeWithRev("settings/layout", cfg, revRef);
  }

  return { layout, saveLayout };
}
