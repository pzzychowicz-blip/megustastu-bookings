// src/hooks/useWaitlist.js
//
// v16.0.0 — Waitlist persistence + CRUD. Firebase node `waitlist` (the 6th
// persisted collection), cloned from the useReminders shape: whole-array
// set() with the loaded-ref write-guard (small, low-contention list — the
// per-node diff model bookings use would be overkill). Reports refusals via
// the shared setWriteWarning banner, like every other collection.
//
// Entry shape: { id, name, phone, size, date, prefTime|null, notes,
//                createdAt, status:"waiting" }
// Ordering is first-come-first-served (createdAt asc) — the panel sorts.
// `available` (does a table fit right now?) is DERIVED in BookingApp via
// trialFits, never persisted.
//
// Auto-prune: entries whose date has passed are silently dropped on load
// (the pruneOldReminderFires pattern) — a stale waitlist has no value.
//
// GOTCHA (hit live during v16.0.0 QA): set() must NOT run inside the setState
// updater here. Firebase fires local listeners SYNCHRONOUSLY on set(), so the
// echo's setWaitlist lands mid-update and React (StrictMode dev) re-applies
// the queued concat updater on the echo state → the entry duplicates AND the
// duplicate is persisted. Fix = the ref-mirror pattern: compute the next array
// ONCE from a ref of current state, then setState + set() as plain statements
// (see memory/firebase-set-in-updater-doubling — useReminders still carries
// the old shape; port this fix if its adds ever double).

import { useState, useRef, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { genId } from "../lib/booking-logic";
import { attachRev, writeWithRev } from "../lib/revGuard";

export function useWaitlist({ setWriteWarning }){
  const waitlistLoaded=useRef(false);
  const [waitlist, setWaitlist] = useState([]);
  const waitlistRef=useRef([]); // mirror for updater-free saves (see gotcha above)
  const waitlistRevRef=useRef(0); // v16.0.0: revision-CAS ref (lib/revGuard.js)

  function saveWaitlist(next,isSilent){
    if(!waitlistLoaded.current){
      console.warn("[SAFE] Refused to write waitlist — initial read has not completed yet.");
      if(!isSilent) setWriteWarning("Refused to write: Firebase not yet connected. If this persists, reload the page.");
      return;
    }
    const computed=typeof next==="function"?next(waitlistRef.current):next;
    waitlistRef.current=computed;
    setWaitlist(computed);
    // v16.0.0: revision-CAS write — a stale device's overwrite is rejected
    // server-side; the rollback echo restores waitlistRef/state via onValue.
    writeWithRev("waitlist",computed,waitlistRevRef,function(){
      if(!isSilent) setWriteWarning("Couldn't save — this device's data was out of date and has been refreshed. Please redo the change.");
    });
  }

  useEffect(function(){
    const unsub=onValue(ref(db,"waitlist"),function(snap){
      const val=snap.val();
      const arr=val?(Array.isArray(val)?val:Object.values(val)).filter(Boolean):[];
      waitlistRef.current=arr;
      setWaitlist(arr);
      waitlistLoaded.current=true;
    });
    return unsub;
  },[]);
  useEffect(function(){ return attachRev("waitlist",waitlistRevRef); },[]);

  // Auto-prune past-date entries once per load (and whenever a snapshot brings
  // stale ones in). Silent write — an auto-effect, per the write-guard contract.
  useEffect(function(){
    if(!waitlistLoaded.current) return;
    const today=new Date().toISOString().slice(0,10);
    const stale=waitlist.some(function(w){return w&&w.date&&w.date<today;});
    if(!stale) return;
    saveWaitlist(function(prev){return prev.filter(function(w){return w&&(!w.date||w.date>=today);});},true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[waitlist]);

  // ── CRUD ────────────────────────────────────────────────────────────────────
  // addToWaitlist accepts the raw fields (typically the booking/walk-in form's
  // current draft) and stamps id/createdAt/status.
  function addToWaitlist({name,phone,size,date,prefTime,notes}){
    const entry={
      id:genId(),
      name:name||"",
      phone:phone||"",
      size:Number(size)||2,
      date:date||new Date().toISOString().slice(0,10),
      prefTime:prefTime||null,
      notes:notes||"",
      createdAt:Date.now(),
      status:"waiting"
    };
    saveWaitlist(function(prev){return prev.concat([entry]);});
    return entry;
  }
  function removeFromWaitlist(id){
    saveWaitlist(function(prev){return prev.filter(function(w){return w.id!==id;});});
  }

  return { waitlist, saveWaitlist, addToWaitlist, removeFromWaitlist };
}
