// src/hooks/usePresence.js
//
// v17.3.0 — real-time device presence for the connection-status popover.
// Each connected browser tab writes ONE ephemeral child under `presence/{pushKey}`
// ({email, ua, since}), sets an onDisconnect().remove() so the socket dropping
// (tab close, sleep, network loss) auto-cleans it, and subscribes to the whole
// `presence` node to render "who's connected" across all devices/users.
//
// v17.8.0 — onDisconnect ALONE IS NOT ENOUGH. The popover was listing tablets
// that had last been on days earlier, because `presence` children leak:
//
//   onDisconnect() arms a single server-side operation that fires ONCE. If the
//   socket drops between arming it and the set() landing, the server fires the
//   (empty) removal — and then the SDK REPLAYS the queued set() on reconnect,
//   writing a child with no onDisconnect attached to it. That child is then
//   immortal. Reordering the two calls does not help; it just moves the window.
//
// The fix is not to make onDisconnect airtight — it can't be — but to stop
// treating its absence as proof of presence. A live connection now proves
// itself continuously with a 45s `lastSeen` heartbeat, and the reader trusts
// only recent heartbeats. onDisconnect is kept as the fast path (a clean drop
// still vanishes instantly); the heartbeat is what makes an unclean one expire.
//
// Three pieces:
//   • heartbeat  — update(myRef,{lastSeen:serverTimestamp()}) every 45s
//   • filter     — a child is "connected" only while its lastSeen is inside
//                  STALE_MS; enforced on READ, so it needs no write to work
//   • prune      — once per registration, delete children older than PRUNE_MS,
//                  so leaked keys don't accumulate in the node forever
//
// Server clock: lastSeen is a serverTimestamp, so comparing it against a raw
// Date.now() is wrong on any device with clock skew — and the whole staleness
// model now rests on that comparison. `.info/serverTimeOffset` gives the
// correction; it is returned so the popover's "since" text uses it too.
//
// EXEMPT from the CAS/revGuard rule (CLAUDE.md "any NEW persisted node must ship
// with a stamp/rev pair"): presence is NOT persisted app data — it's ephemeral,
// per-connection, and each connection only ever writes its OWN disjoint
// push-key child. The v17.8.0 prune writes to OTHER keys, but only to delete
// ones already proven dead, and deleting a dead key is idempotent — two devices
// racing on the same one is harmless. There is still no stale-overwrite class.
// The `presence` node inherits the top-level `.write: auth != null` rule with no
// `.validate`, so it needs no Firebase console step (rolling-safe). See
// ConnectionStatus.jsx for the render side.

import { useState, useEffect, useRef } from "react";
import { ref, onValue, onDisconnect, push, set, update, remove, serverTimestamp } from "firebase/database";
import { db, auth } from "../firebase";
import { dbError } from "../lib/dbError";

// How often a live connection re-proves itself, and how long a child survives
// without doing so. STALE_MS is three missed beats — long enough that a brief
// stall or a slow write never blinks a real device out of the list, short
// enough that a closed tab is gone while someone is still looking at the popover.
const BEAT_MS = 45 * 1000;
const STALE_MS = 150 * 1000;
// Deletion is deliberately far more conservative than hiding: hiding is free and
// reversible (the next beat brings the device back), deleting is neither. 10
// minutes is well past any plausible heartbeat stall.
const PRUNE_MS = 10 * 60 * 1000;

// Best-effort human label from the userAgent — "iPad · Safari", "Mac · Chrome",
// "Windows · Edge", "Android · Chrome". Purely cosmetic; falls back to "Device".
function deviceLabel(){
  const ua=(typeof navigator!=="undefined"&&navigator.userAgent)||"";
  let os="Device";
  if(/iPad/.test(ua)) os="iPad";
  else if(/iPhone/.test(ua)) os="iPhone";
  else if(/Android/.test(ua)) os="Android";
  else if(/Macintosh|Mac OS X/.test(ua)) os="Mac";
  else if(/Windows/.test(ua)) os="Windows";
  else if(/Linux/.test(ua)) os="Linux";
  let br="";
  // Order matters — Edge/Chrome UAs also contain "Safari"/"Chrome" tokens.
  if(/Edg\//.test(ua)) br="Edge";
  else if(/OPR\/|Opera/.test(ua)) br="Opera";
  else if(/Firefox\//.test(ua)) br="Firefox";
  else if(/Chrome\//.test(ua)&&!/Chromium/.test(ua)) br="Chrome";
  else if(/Safari\//.test(ua)) br="Safari";
  return br?os+" · "+br:os;
}

export function usePresence(){
  const [devices, setDevices] = useState([]);
  const [myKey, setMyKey] = useState(null);
  // Server-minus-local clock skew, in ms. State (not just a ref) because the
  // popover renders "since" text from it.
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const myRefRef = useRef(null);
  const beatRef = useRef(0);
  // Set when this connection registers, consumed by the FIRST presence snapshot
  // that arrives afterwards — see the prune in the listener below.
  const pruneArmedRef = useRef(false);

  // Clock correction. Subscribed first so a value is usually in hand before the
  // first presence snapshot lands; a missing offset just means 0, i.e. today's
  // behaviour.
  useEffect(function(){
    const unsub=onValue(ref(db,".info/serverTimeOffset"),function(snap){
      const v=snap.val();
      const n=typeof v==="number"?v:0;
      offsetRef.current=n;
      setOffset(n);
    },dbError(".info/serverTimeOffset"));
    return unsub;
  },[]);

  // Register this connection whenever the socket is up (and re-register after a
  // reconnect — onDisconnect fires server-side on drop, so a fresh connect needs
  // a fresh child). Keyed on the authed email so a re-login refreshes it.
  useEffect(function(){
    const email=(auth.currentUser&&auth.currentUser.email)||"unknown";
    let active=true;
    function stopBeat(){ if(beatRef.current){ clearInterval(beatRef.current); beatRef.current=0; } }
    const unsub=onValue(ref(db,".info/connected"),function(snap){
      if(!active) return;
      if(snap.val()!==true){
        // Disconnected — the server fires our onDisconnect and removes this child.
        // CLEAR the ref so the NEXT connect re-registers a fresh child; without this
        // the guard below would block re-registration and the device would vanish
        // from `presence` for the rest of the session (sleep/wake, offline blip).
        myRefRef.current=null;
        stopBeat();
        return;
      }
      if(myRefRef.current) return;                // already registered this connection
      const myRef=push(ref(db,"presence"));
      myRefRef.current=myRef;
      setMyKey(myRef.key);
      // onDisconnect FIRST so a clean drop is cleaned up immediately. The
      // heartbeat below is what covers the cases this cannot (see the header).
      onDisconnect(myRef).remove();
      set(myRef,{email:email,ua:deviceLabel(),since:serverTimestamp(),lastSeen:serverTimestamp()}).catch(function(){});
      // Heartbeat: re-prove this connection every BEAT_MS for as long as it lasts.
      stopBeat();
      beatRef.current=setInterval(function(){
        const r=myRefRef.current;
        if(!r) return;
        update(r,{lastSeen:serverTimestamp()}).catch(function(){});
      },BEAT_MS);
      // Arm the prune. It cannot run HERE: `.info/connected` resolves before the
      // first `presence` snapshot lands, so at this moment we have no node to
      // prune from and would reliably delete nothing (found in QA — the first
      // version pruned here and never once fired). The listener below consumes
      // this flag on the next real snapshot instead.
      pruneArmedRef.current=true;
    },dbError(".info/connected (presence)"));
    return function(){
      active=false;
      unsub();
      stopBeat();
      // Graceful teardown (logout / unmount) — onDisconnect covers ungraceful drops.
      if(myRefRef.current){ remove(myRefRef.current).catch(function(){}); myRefRef.current=null; }
    };
  },[auth.currentUser&&auth.currentUser.email]);

  // Live list of everyone connected. The staleness filter lives HERE, on the
  // read, so it protects the UI whether or not any write ever succeeds — and so
  // a child that leaked before this version shipped is hidden immediately
  // rather than waiting for someone to prune it.
  //
  // No ticking timer is needed to keep this fresh: every connected device beats
  // every 45s, which re-fires this listener, so the list re-evaluates well
  // inside STALE_MS for as long as anyone is connected at all.
  useEffect(function(){
    const unsub=onValue(ref(db,"presence"),function(snap){
      const val=snap.val();
      if(!val){ setDevices([]); pruneArmedRef.current=false; return; }
      const now=Date.now()+offsetRef.current;
      // Prune leaked children — ONCE per registration (armed on connect, consumed
      // here), rather than on a timer, so N devices cause N deletes at connect
      // time instead of a rolling write storm. Deletion is far more conservative
      // than hiding: hiding is free and reversible (the next beat brings a device
      // back), deleting is neither, so PRUNE_MS is 4× STALE_MS.
      if(pruneArmedRef.current){
        pruneArmedRef.current=false;
        const mine=myRefRef.current&&myRefRef.current.key;
        Object.keys(val).forEach(function(k){
          if(k===mine) return;   // never delete our own child
          const v=val[k]||{};
          const seen=typeof v.lastSeen==="number"?v.lastSeen:(typeof v.since==="number"?v.since:0);
          if(seen&&now-seen>PRUNE_MS) remove(ref(db,"presence/"+k)).catch(function(){});
        });
      }
      const list=[];
      Object.keys(val).forEach(function(k){
        const v=val[k]||{};
        // `since` is the fallback for a child written by a pre-v17.8.0 client,
        // which has no lastSeen. That keeps such a device visible for its first
        // STALE_MS and then drops it until it reloads — a transitional cost on
        // a handful of devices, and the alternative (trusting a field that is
        // never refreshed) is the bug this whole change exists to fix.
        const seen=typeof v.lastSeen==="number"?v.lastSeen:(typeof v.since==="number"?v.since:0);
        if(!seen||now-seen>STALE_MS) return;
        list.push({key:k,email:v.email||"unknown",ua:v.ua||"Device",since:typeof v.since==="number"?v.since:null,lastSeen:typeof v.lastSeen==="number"?v.lastSeen:null});
      });
      setDevices(list);
    },dbError("presence"));
    return unsub;
  },[]);

  return { devices, myKey, offset };
}
