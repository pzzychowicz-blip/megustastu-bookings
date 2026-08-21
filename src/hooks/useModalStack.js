// src/hooks/useModalStack.js — v17.14.0
//
// ONE ordered stack of open modal surfaces, replacing eighteen independent
// visibility booleans in App.jsx.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// Two of the recurring bug classes CLAUDE.md documents were properties of the
// booleans, not of any one modal:
//
//   "the Esc chain bypasses every `onClose`" — the chain in
//   useKeyboardShortcuts called the state setters DIRECTLY, so any behaviour
//   attached by wrapping a mount-site `onClose` (a confirm, a cleanup) was
//   silently skipped unless you also edited the chain.
//
//   "adding a new drafting surface = three wirings, not one" — a baseline, a
//   requestClose*, AND an Esc branch, each in a different place.
//
// Both were paid per modal, and both were the same defect: the *set* of open
// surfaces and their *order* were spread across eighteen `useState` calls, a
// hand-written descending chain, a second hand-written chain for Enter, a
// hand-written `topLayer` expression, and a seventeen-term `anyModal`. Nothing
// held them in step, so the app shipped with `showWaitlist` missing from four
// of the five (found while writing this: the waitlist Overlay could not be
// closed with Esc, did not suppress single-letter shortcuts, and did not mark
// the page behind it `inert`).
//
// ── The order is DECLARED, not the push order ───────────────────────────────
// `MODAL_Z` is the app's z-order, ascending. It is exactly the old Esc chain
// read bottom-up, so Escape behaves identically — but it is now data, and a
// modal added without a place in it is a visible omission rather than a
// silently unreachable surface.
//
// Push order breaks ties. Nothing today opens two modals at the same rank.
import { useState, useCallback } from "react";

// Ascending z-order. Escape acts on the LAST open entry of this list.
export const MODAL_Z=[
  "form",        // the booking form — the bottom of every stack it takes part in
  "week",        // the More popover
  "waitlist",    // the waitlist panel
  "walkin",
  "manual",      // manual table assign — opens over the form
  "block",
  "search",
  "prefpicker",
  "del",
  "cancel",
  "reshuffle",
  "kitchen",     // the kitchen-load confirm, raised BY a save
  "history",
  "settings",
  "reminderdel", // renders above Settings in DOM order…
  "reminder",    // …and the editor is checked before it (v14 p7 order, kept)
  "discard",     // z=260 — raised by the surface below it, so it must be near the top
  "splitmenu",   // z=300 — above even the discard confirm
];
const RANK={};
MODAL_Z.forEach(function(id,i){RANK[id]=i;});

const EMPTY_STACK=[];

// ── Pure core (exported for tests) ──────────────────────────────────────────

// The one writer. `v` is the modal's payload: falsy closes, an updater function
// is applied to the current payload, anything else opens or replaces.
//
// Re-opening an ALREADY-OPEN modal replaces its payload IN PLACE rather than
// moving it to the top — `setManualTarget(other)` while the picker is open is
// a payload change, not a new layer.
export function applyModal(stack,id,v){
  const at=stack.findIndex(function(e){return e.id===id;});
  const cur=at<0?null:stack[at].payload;
  const next=typeof v==="function"?v(cur):v;
  if(!next) return at<0?stack:stack.slice(0,at).concat(stack.slice(at+1));
  if(at<0) return stack.concat([{id:id,payload:next}]);
  if(cur===next) return stack;               // identical → no re-render
  const out=stack.slice();
  out[at]={id:id,payload:next};
  return out;
}

// The id of the visually topmost open modal, or null. Highest declared rank
// wins; push order breaks a tie. An id with no place in MODAL_Z ranks below
// everything, which is the conservative direction — it can still be closed,
// it just never claims the top.
export function topModal(stack){
  let best=null,bestRank=-1;
  for(let i=0;i<stack.length;i++){
    const r=RANK[stack[i].id];
    const rank=r===undefined?-0.5:r;
    if(rank>=bestRank){bestRank=rank;best=stack[i].id;}
  }
  return best;
}

// {id: payload} for the open entries — what the derived names read.
export function modalMap(stack){
  const m={};
  for(let i=0;i<stack.length;i++) m[stack[i].id]=stack[i].payload;
  return m;
}

// ── The hook ────────────────────────────────────────────────────────────────
export function useModalStack(){
  const [stack,setStack]=useState(EMPTY_STACK);
  const setModal=useCallback(function(id,v){
    setStack(function(prev){return applyModal(prev,id,v);});
  },[]);
  return {stack:stack,setModal:setModal};
}
