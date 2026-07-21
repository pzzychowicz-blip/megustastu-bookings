// src/hooks/usePresence.js
//
// v17.3.0 — real-time device presence for the connection-status popover.
// Each connected browser tab writes ONE ephemeral child under `presence/{pushKey}`
// ({email, ua, since}), sets an onDisconnect().remove() so the socket dropping
// (tab close, sleep, network loss) auto-cleans it, and subscribes to the whole
// `presence` node to render "who's connected" across all devices/users.
//
// EXEMPT from the CAS/revGuard rule (CLAUDE.md "any NEW persisted node must ship
// with a stamp/rev pair"): presence is NOT persisted app data — it's ephemeral,
// per-connection, and each connection only ever writes/removes its OWN disjoint
// push-key child (never another device's), so there is no stale-overwrite class
// to protect against. The `presence` node inherits the top-level
// `.write: auth != null` rule with no `.validate`, so it needs no Firebase console
// step (rolling-safe). See ConnectionStatus.jsx for the render side.

import { useState, useEffect, useRef } from "react";
import { ref, onValue, onDisconnect, push, set, remove, serverTimestamp } from "firebase/database";
import { db, auth } from "../firebase";

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
  const myRefRef = useRef(null);

  // Register this connection whenever the socket is up (and re-register after a
  // reconnect — onDisconnect fires server-side on drop, so a fresh connect needs
  // a fresh child). Keyed on the authed email so a re-login refreshes it.
  useEffect(function(){
    const email=(auth.currentUser&&auth.currentUser.email)||"unknown";
    let active=true;
    const unsub=onValue(ref(db,".info/connected"),function(snap){
      if(snap.val()!==true) return;              // only write once actually connected
      if(!active) return;
      if(myRefRef.current) return;                // already registered this connection
      const myRef=push(ref(db,"presence"));
      myRefRef.current=myRef;
      setMyKey(myRef.key);
      // onDisconnect FIRST so a write that races a drop is still cleaned up.
      onDisconnect(myRef).remove();
      set(myRef,{email:email,ua:deviceLabel(),since:serverTimestamp()}).catch(function(){});
    });
    return function(){
      active=false;
      unsub();
      // Graceful teardown (logout / unmount) — onDisconnect covers ungraceful drops.
      if(myRefRef.current){ remove(myRefRef.current).catch(function(){}); myRefRef.current=null; }
    };
  },[auth.currentUser&&auth.currentUser.email]);

  // Live list of everyone connected.
  useEffect(function(){
    const unsub=onValue(ref(db,"presence"),function(snap){
      const val=snap.val();
      if(!val){ setDevices([]); return; }
      const list=Object.keys(val).map(function(k){
        const v=val[k]||{};
        return {key:k,email:v.email||"unknown",ua:v.ua||"Device",since:typeof v.since==="number"?v.since:null};
      });
      setDevices(list);
    });
    return unsub;
  },[]);

  return { devices, myKey };
}
