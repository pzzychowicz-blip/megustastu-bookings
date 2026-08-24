// src/hooks/useDismissals.js — v17.14.0
//
// The notification strip's per-row ✕ dismissals: four session-only Sets that
// had been written out four times.
//
// Each was a `useState(() => new Set())`, a `dismissXRow(id)` that copied the
// Set and added to it, and a filter-the-map-by-the-Set memo — identical bodies,
// four names. What differed between them was only ever the KEY (`clash` is
// keyed by pair, the rest by booking id) and the LIFECYCLE (below), and neither
// of those is a reason to write the mechanism out again.
//
// ── The two lifecycles, which are a real distinction ────────────────────────
// `late`, `overlap` and `wait` are TODAY-only sections whose conditions are
// monotonic within a day — a late booking stays late, an overstay stays an
// overstay — so they never prune and are simply emptied on a day change.
//
// `clash` is scoped to the VIEWED date and is the opposite: a double-booking is
// the one notification whose whole point is that you go and fix it, so it
// clears, and it can recur on the same pair. It therefore PRUNES against the
// live pairs instead, which also covers the day change for free (the live set
// is already viewDate-scoped). It is deliberately absent from the day-change
// reset; that is not the drift it looks like.
//
// ── Identity ────────────────────────────────────────────────────────────────
// The pure helpers return the SAME outer object when nothing changed, and
// always carry untouched Sets through by reference. Both halves matter: the
// first lets React bail out, and the second keeps `[sets.late]` a stable memo
// dep when an overlap row is dismissed — four independent `useState`s had that
// property for free, and a naive single object would have quietly lost it.
import { useState, useCallback } from "react";

export const DISMISS_KEYS=["late","overlap","wait","clash"];

function emptySets(){
  const s={};
  DISMISS_KEYS.forEach(function(k){s[k]=new Set();});
  return s;
}

// ── Pure core (exported for tests) ──────────────────────────────────────────
export function dismissIn(sets,key,id){
  const cur=sets[key];
  if(!cur||cur.has(id)) return sets;
  const next=new Set(cur);
  next.add(id);
  return Object.assign({},sets,{[key]:next});
}

// Keep only ids still in `live`. Returns `sets` unchanged when nothing drops,
// which is what stops the effect that calls this from re-entering.
export function pruneIn(sets,key,live){
  const cur=sets[key];
  if(!cur||cur.size===0) return sets;
  let drop=false;
  cur.forEach(function(id){if(!live.has(id)) drop=true;});
  if(!drop) return sets;
  const next=new Set();
  cur.forEach(function(id){if(live.has(id)) next.add(id);});
  return Object.assign({},sets,{[key]:next});
}

export function resetIn(sets,keys){
  let out=sets;
  keys.forEach(function(k){
    if(!out[k]||out[k].size===0) return;
    if(out===sets) out=Object.assign({},sets);
    out[k]=new Set();
  });
  return out;
}

// ── The hook ────────────────────────────────────────────────────────────────
export function useDismissals(){
  const [sets,setSets]=useState(emptySets);
  const dismiss=useCallback(function(key,id){
    setSets(function(prev){return dismissIn(prev,key,id);});
  },[]);
  const prune=useCallback(function(key,live){
    setSets(function(prev){return pruneIn(prev,key,live);});
  },[]);
  const reset=useCallback(function(keys){
    setSets(function(prev){return resetIn(prev,keys);});
  },[]);
  return {sets:sets,dismiss:dismiss,prune:prune,reset:reset};
}
