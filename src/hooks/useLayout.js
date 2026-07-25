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
// ── v17.0.0: floor plan (the Plan view's geometry) ───────────────────────────
// settings/layout gains a `floorPlan` field: a top-down map of the room —
// per-table position/shape/size/rotation/chairs, plus walls and doors.
// Shape: { v:1, room:{w,h}, tables:{ [id]:{x,y,shape,w,h,rot,
// chairs:{top,right,bottom,left}} }, walls:[{x1,y1,x2,y2}], doors:[{x,y,rot,width,flip}] }.
// Coordinates are CENTIMETERS (1 unit = 1 cm) rendered via an SVG viewBox.
//
// Sanitize contract (the priorities lesson): a PRESENT floorPlan treats each
// missing field as EMPTY (RTDB drops empty arrays — walls/doors default to []
// anyway, so this is naturally safe); an ABSENT floorPlan — or any table with
// no stored entry (a newly added table, or first run) — gets a deterministic
// AUTO placement (rows grouped by zone) so the Plan view works before any
// editing. Entries for removed tables are dropped. NOT part of layoutSignature
// (like priorities) — editing the plan never kills IS_MGT_LAYOUT.
const FP_MIN_ROOM = 300, FP_MAX_ROOM = 4000;
function fpNum(n, def, min, max){
  let v = Math.round(Number(n));
  if(!Number.isFinite(v)) v = def;
  return Math.max(min, Math.min(max, v));
}
// v17.0.0 review fix #7: a table is drawn CENTERED on (x,y), so clamping the
// centre to [0,room] let half the glyph render outside the room border. Clamp
// the centre by the glyph's half-extent instead; a table larger than the room
// falls back to the room centre.
function clampCenter(v, half, span){
  if(half * 2 >= span) return Math.round(span / 2);
  return Math.max(half, Math.min(span - half, v));
}
function defaultChairs(capacity){ // (shape param dropped — was unused; callers may still pass it)
  // Split capacity top/bottom for square/rect (round renders the total evenly
  // around the rim, but keeps the same per-side model for uniform editing).
  const top = Math.ceil(capacity / 2);
  return { top: top, right: 0, bottom: capacity - top, left: 0 };
}
function defaultEntry(index, table, room){
  // Deterministic grid: 5 per row, outdoor block first, indoor continues after.
  const col = index % 5, row = Math.floor(index / 5);
  const shape = table.capacity >= 4 ? "rect" : "square";
  const w = shape === "rect" ? 90 : 60;
  return {
    x: Math.min(room.w - 100, 60 + col * 150),
    y: Math.min(room.h - 100, 60 + row * 140),
    shape: shape, w: w, h: 60, rot: 0,
    chairs: defaultChairs(table.capacity, shape)
  };
}
export function sanitizeFloorPlan(raw, tables){
  const src = raw && typeof raw === "object" ? raw : {};
  const rawRoom = src.room && typeof src.room === "object" ? src.room : {};
  const room = { w: fpNum(rawRoom.w, 900, FP_MIN_ROOM, FP_MAX_ROOM), h: fpNum(rawRoom.h, 600, FP_MIN_ROOM, FP_MAX_ROOM) };
  const srcTables = src.tables && typeof src.tables === "object" ? src.tables : {};
  const outT = {};
  // Auto-placement index walks zone-sorted tables so outdoor/indoor group visually.
  const sorted = tables.slice().sort(function(a, b){
    if(a.zone !== b.zone) return a.zone === "outdoor" ? -1 : 1;
    return 0;
  });
  sorted.forEach(function(t, i){
    const e = srcTables[t.id];
    if(e && typeof e === "object"){
      const shape = (e.shape === "round" || e.shape === "rect") ? e.shape : "square";
      const w = fpNum(e.w, 60, 30, 400), h = fpNum(e.h, 60, 30, 400);
      const hEff = (shape === "square" || shape === "round") ? w : h;
      const rawCh = e.chairs && typeof e.chairs === "object" ? e.chairs : null;
      const chairs = rawCh
        ? { top: fpNum(rawCh.top, 0, 0, 12), right: fpNum(rawCh.right, 0, 0, 12), bottom: fpNum(rawCh.bottom, 0, 0, 12), left: fpNum(rawCh.left, 0, 0, 12) }
        : defaultChairs(t.capacity, shape);
      outT[t.id] = {
        x: clampCenter(fpNum(e.x, Math.round(room.w / 2), 0, room.w), w / 2, room.w),
        y: clampCenter(fpNum(e.y, Math.round(room.h / 2), 0, room.h), hEff / 2, room.h),
        shape: shape, w: w, h: shape === "square" || shape === "round" ? w : h,
        rot: fpNum(e.rot, 0, 0, 359),
        chairs: chairs
      };
    } else {
      outT[t.id] = defaultEntry(i, t, room);
    }
  });
  const walls = (Array.isArray(src.walls) ? src.walls : []).map(function(wl){
    if(!wl || typeof wl !== "object") return null;
    return { x1: fpNum(wl.x1, 0, 0, room.w), y1: fpNum(wl.y1, 0, 0, room.h), x2: fpNum(wl.x2, 0, 0, room.w), y2: fpNum(wl.y2, 0, 0, room.h) };
  }).filter(Boolean).slice(0, 200);
  const doors = (Array.isArray(src.doors) ? src.doors : []).map(function(d){
    if(!d || typeof d !== "object") return null;
    // v17.0.0 correction: `flip` mirrors the swing side (hinge left ↔ right).
    return { x: fpNum(d.x, 0, 0, room.w), y: fpNum(d.y, 0, 0, room.h), rot: fpNum(d.rot, 0, 0, 359), width: fpNum(d.width, 80, 40, 300), flip: d.flip === true };
  }).filter(Boolean).slice(0, 50);
  return { v: 1, room: room, tables: outT, walls: walls, doors: doors };
}

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

  // v17.0.0: floor plan rides along on the same node (same layoutRev CAS).
  // Deliberately NOT in layoutSignature — plan edits never affect IS_MGT_LAYOUT.
  return { tables: tables, joinGroups: joinGroups, comboCaps: comboCaps, megaCombos: megaCombos, kitchenLimit: kitchenLimit, priorities: priorities, floorPlan: sanitizeFloorPlan(val.floorPlan, tables) };
}

export function useLayout(){
  // Seeded with DEFAULT_LAYOUT (already applied to the bindings at import).
  // v17.0.0: + an auto-generated floorPlan so the Plan view/editor always have
  // geometry, even before the first settings/layout snapshot arrives.
  const [layout, setLO] = useState(function(){
    return { ...DEFAULT_LAYOUT, floorPlan: sanitizeFloorPlan(null, DEFAULT_LAYOUT.tables) };
  });
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
