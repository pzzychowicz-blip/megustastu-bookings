// src/hooks/usePersistence.js
//
// Phase D1 (v14.1.8): Firebase persistence subsystem extracted from
// BookingApp into a self-contained hook. Owns the master `bookings` and
// `tableBlocks` state, the four write-guard refs, all four Firebase
// real-time listeners, the connection-status state pair, and the two
// guarded write helpers (saveBookings / saveBlocks). Also owns the
// auto-extend effect — kept here intentionally so the write-guard
// contract (lastExtend ref + saveBookings + bookingsLoaded ref) never
// crosses module boundaries. The auto-extend effect closes over
// `autoOptimizer` and `nowMins` which are still owned by BookingApp
// for now (they move into D3's useNowMins / useAutoOptimizer); they
// arrive as named arguments so this hook stays a single-input boundary.
//
// Returns a single object so consumers can pull only what they need
// via destructuring. `setWriteWarning` is exposed (rather than fully
// internal) because saveReminders in BookingApp also reports through
// the same banner — when D2 lands, useReminders will receive it as a
// prop and the seam disappears.

import { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase";
import { sanitizeAll, toMins, bookingsAfterAction } from "../lib/booking-logic";

export function usePersistence({ autoOptimizer, nowMins }){
  const [bookings, setBookings] = useState([]);
  const [tableBlocks, setTableBlocks] = useState([]);
  // ── Firebase write-guard system ─────────────────────────────────────────────
  // These refs track whether we've received AT LEAST ONE onValue callback from
  // Firebase for each path. Until that's happened, React state is [] / {}
  // regardless of what's in Firebase — writing that empty state would wipe
  // real data. Save helpers REFUSE to write until their respective
  // dataLoaded ref is true. This is the critical safety net added after the
  // v13 first-deploy incident where empty in-memory state was persisted to
  // Firebase before the read listener had fired.
  const bookingsLoaded=useRef(false);
  const blocksLoaded=useRef(false);
  const [writeWarning, setWriteWarning] = useState(null);
  const [loadBannerShown, setLoadBannerShown] = useState(false);
  const firstLoadCount=useRef(null); // number of bookings on first successful load
  // v14.1: Connection-status state. isOnline drives the amber offline banner;
  // reconnectShown is a brief 4-second blue flash after offline→online.
  // hasConnectedRef gates BOTH banners so we never show "offline" before
  // the very first successful Firebase connection (avoids a false flash on boot).
  const [isOnline, setIsOnline] = useState(true);
  const [reconnectShown, setReconnectShown] = useState(false);
  const hasConnectedRef=useRef(false);
  // Firebase save helpers — write-on-action only (prevents multi-device data corruption).
  // GUARDED: will refuse to write until Firebase has sent us the initial snapshot.
  // GUARDED: will refuse to overwrite non-empty Firebase with an empty in-memory array
  //   unless firstLoadCount was also 0 (i.e. DB is genuinely new/empty).
  // If `isSilent` is true, refusals only log to console — no user-facing warning.
  // If `isSilent` is false/omitted (default = user action), refusals also surface a red banner.
  // This keeps harmless mount-time effect calls quiet (auto-extend passes isSilent=true)
  // while still alerting on real user-blocked saves.
  function saveBookings(next,isSilent){
    function persist(computed){
      if(!bookingsLoaded.current){
        console.warn("[SAFE] Refused to write bookings — initial read has not completed yet.");
        if(!isSilent) setWriteWarning("Refused to write: Firebase not yet connected. If this persists, reload the page.");
        return;
      }
      if(Array.isArray(computed)&&computed.length===0&&firstLoadCount.current!==null&&firstLoadCount.current>0){
        console.warn("[SAFE] Refused to write empty bookings array — Firebase had "+firstLoadCount.current+" entries on load. This is a safety check against accidental wipe.");
        if(!isSilent) setWriteWarning("Refused to write empty data. Reload the page and try again. If you intended to delete everything, contact support.");
        return;
      }
      set(ref(db,"bookings"),computed).catch(function(){});
    }
    if(typeof next==="function"){
      setBookings(function(prev){const computed=next(prev);persist(computed);return computed;});
    } else {
      setBookings(next);persist(next);
    }
  }
  function saveBlocks(next,isSilent){
    function persist(computed){
      if(!blocksLoaded.current){
        console.warn("[SAFE] Refused to write tableBlocks — initial read has not completed yet.");
        return;
      }
      set(ref(db,"tableBlocks"),computed).catch(function(){});
    }
    if(typeof next==="function"){
      setTableBlocks(function(prev){const computed=next(prev);persist(computed);return computed;});
    } else {
      setTableBlocks(next);persist(next);
    }
  }
  // Firebase real-time listeners — read only, never write back.
  // The `bookingsLoaded.current=true` line MUST run on every callback, including
  // when val is null (truly empty DB), otherwise saves would stay blocked forever
  // on a brand-new database.
  useEffect(function(){
    const unsub=onValue(ref(db,"bookings"),function(snap){
      const val=snap.val();
      const arr=val?sanitizeAll(val):[];
      setBookings(arr);
      if(firstLoadCount.current===null){
        firstLoadCount.current=arr.length;
        setLoadBannerShown(true);
      }
      bookingsLoaded.current=true;
    });
    return unsub;
  },[]);
  useEffect(function(){
    const unsub=onValue(ref(db,"tableBlocks"),function(snap){
      const val=snap.val();
      if(val){const arr=Array.isArray(val)?val:Object.values(val);setTableBlocks(arr.filter(Boolean));}
      else setTableBlocks([]);
      blocksLoaded.current=true;
    });
    return unsub;
  },[]);
  // Auto-hide the first-load banner after 6 seconds
  useEffect(function(){
    if(!loadBannerShown) return;
    const t=setTimeout(function(){setLoadBannerShown(false);},6000);
    return function(){clearTimeout(t);};
  },[loadBannerShown]);
  // v14.1: Subscribe to Firebase's special .info/connected ref. Drives the
  // offline banner and the reconnected flash. The hasConnectedRef gate makes
  // sure the offline banner never shows before the first successful handshake.
  useEffect(function(){
    const unsub=onValue(ref(db,".info/connected"),function(snap){
      const connected=snap.val()===true;
      if(connected){
        if(!hasConnectedRef.current){
          // First successful connection on boot — silent.
          hasConnectedRef.current=true;
          setIsOnline(true);
          return;
        }
        // Reconnect after a real outage.
        setIsOnline(true);
        setReconnectShown(true);
        setTimeout(function(){setReconnectShown(false);},4000);
      } else {
        if(hasConnectedRef.current) setIsOnline(false);
      }
    });
    return unsub;
  },[]);
  // Auto-extend seated bookings that exceed their stored duration.
  // IMPORTANT: computes the update in a pure pass first and only calls saveBookings
  // if something actually needs to change. This prevents a spurious write attempt
  // on first mount (when onValue may not have returned yet, the write-guard would
  // fire even though no real change is being made).
  const lastExtend=useRef("");
  useEffect(function(){
    if(!bookingsLoaded.current) return; // no work to do until initial read lands
    const today=new Date().toISOString().slice(0,10);
    let needsUpdate=false;
    const updated=bookings.map(function(b){
      if(b.date!==today||b.status!=="seated") return b;
      const elapsed=nowMins-toMins(b.time);
      if(elapsed>b.duration){needsUpdate=true;return Object.assign({},b,{duration:elapsed,customDur:elapsed});}
      return b;
    });
    if(!needsUpdate) return;
    const seated=bookings.filter(function(b){return b.date===today&&b.status==="seated";});
    const key=seated.map(function(b){return b.id+":"+nowMins;}).join(",");
    if(key===lastExtend.current) return;
    lastExtend.current=key;
    saveBookings(bookingsAfterAction(updated,today,tableBlocks,null,false,autoOptimizer),true); // silent — non-interactive auto-extend
  },[nowMins,tableBlocks,autoOptimizer,bookings]);

  return {
    bookings, tableBlocks,
    saveBookings, saveBlocks,
    isOnline, writeWarning, setWriteWarning,
    loadBannerShown, reconnectShown,
    // firstLoadCount is exposed as a ref because the load-banner JSX in
    // BookingApp reads .current to show the booking count from the first
    // successful Firebase load. It must remain a ref (not state) so
    // saveBookings can read it synchronously inside the empty-array
    // safety guard without triggering re-renders.
    firstLoadCount,
  };
}
