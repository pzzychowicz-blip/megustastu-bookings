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
import { presenceState, BEAT_MS } from "../lib/presence-state";

// v17.8.0 tech-debt: the thresholds and the read model live in
// lib/presence-state.js — pure, and therefore testable. This file keeps the
// subscription, the refs, and the writes.

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
  // This connection's OWN resolved `since`, learned from the first presence
  // snapshot that contains our child. The heartbeat rewrites the whole record
  // (see below), and it must not reset `since` to "now" every 45s — that would
  // make every device permanently read "just now". Null until the echo lands;
  // the beat falls back to serverTimestamp() only in that first window, which
  // is the one moment where "now" IS the right answer.
  const sinceRef = useRef(null);
  // Has .info/serverTimeOffset actually delivered a value yet? The prune DELETES
  // other devices' children off a serverTimestamp comparison, so it must not run
  // on an assumed offset of 0 — see the gate in the presence listener.
  const offsetReadyRef = useRef(false);
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
      offsetReadyRef.current=true;
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
        sinceRef.current=null;   // the next connection is a new child, new since
        stopBeat();
        return;
      }
      if(myRefRef.current) return;                // already registered this connection
      const myRef=push(ref(db,"presence"));
      myRefRef.current=myRef;
      sinceRef.current=null;
      setMyKey(myRef.key);
      // onDisconnect FIRST so a clean drop is cleaned up immediately. The
      // heartbeat below is what covers the cases this cannot (see the header).
      onDisconnect(myRef).remove();
      set(myRef,{email:email,ua:deviceLabel(),since:serverTimestamp(),lastSeen:serverTimestamp()}).catch(function(){});
      // Heartbeat: re-prove this connection every BEAT_MS for as long as it lasts.
      stopBeat();
      // The beat rewrites the IDENTITY fields too, not just lastSeen. update()
      // on a path that no longer exists CREATES it — so if this child is ever
      // removed underneath us (another device's prune after a long stall, a
      // console cleanup), a lastSeen-only beat would resurrect it as a nameless
      // stub and the popover would list "unknown · Device" for the rest of the
      // session. Writing the whole record makes any resurrection complete.
      beatRef.current=setInterval(function(){
        const r=myRefRef.current;
        if(!r) return;
        // `since` is in here for the same reason as email/ua: on a resurrection
        // this update() is the ONLY write that will ever recreate the child, so
        // anything left out is gone for the rest of the session. Without it the
        // row came back with no "connected since" text. It is NOT a lie about
        // when the connection started — the socket has been up continuously
        // since this child was first registered; only the record was deleted.
        update(r,{email:email,ua:deviceLabel(),since:sinceRef.current||serverTimestamp(),lastSeen:serverTimestamp()}).catch(function(){});
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
      // presenceState decides everything; this callback only does the IO it
      // decides on. `canPrune` is armed-on-connect AND a real server offset:
      // without one `now` is local time, and on a device whose clock runs fast
      // every live child looks ancient and the prune would empty the node.
      // Staying armed means the next snapshot retries.
      const canPrune=pruneArmedRef.current&&offsetReadyRef.current;
      const st=presenceState(
        val,
        Date.now()+offsetRef.current,
        myRefRef.current&&myRefRef.current.key,
        canPrune
      );
      if(canPrune) pruneArmedRef.current=false;
      // Fire-and-forget: a failed delete just means the next connect retries.
      st.prunable.forEach(function(k){ remove(ref(db,"presence/"+k)).catch(function(){}); });
      // Our own resolved `since`, so the heartbeat rewrites it verbatim rather
      // than stamping a fresh one every beat.
      if(st.mySince!=null) sinceRef.current=st.mySince;
      setDevices(st.devices);
    },dbError("presence"));
    return unsub;
  },[]);

  return { devices, myKey, offset };
}
