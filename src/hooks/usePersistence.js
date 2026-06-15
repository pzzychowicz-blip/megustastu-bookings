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
import { ref, onValue, set, get, update } from "firebase/database";
import { db } from "../firebase";
import { sanitizeAll, toMins, bookingsAfterAction, histEntry } from "../lib/booking-logic";
import { hoursFor } from "../lib/constants";

// v15.2.0: heartbeat-gap threshold for the freshness/resync gate. A foreground
// tab ticks the heartbeat every 10s; a backgrounded tab's timers throttle to
// ~60s. 90s is above both, so normal operation never trips it — but any real
// OS sleep / lid-close (minutes-to-hours of a frozen event loop) does. See the
// "Freshness / resync gate" block below.
const STALE_GAP_MS = 90000;

// v15.1.0: has `dateStr`'s closing moment already passed? Used by the
// auto-extend effect (to skip) and the auto-complete effect (to trigger).
// A booking's closing moment is its OWN date's per-weekday close (hoursFor —
// may be 24/25, i.e. past midnight), expressed in minutes since that date's
// midnight. "Now" on the same axis is dayDiff*1440 + nowMins (all-UTC date
// strings, the app's date convention). Returns the close-in-minutes when it
// has passed, else null (also null for future dates). hoursFor is called at
// run time per the constants.js live-binding rule.
function pastCloseMins(dateStr, todayStr, nowMins){
  const dayDiff=Math.round((Date.parse(todayStr)-Date.parse(dateStr))/86400000);
  if(dayDiff<0) return null; // future date — its close can't have passed
  const closeMins=hoursFor(dateStr).close*60;
  return (dayDiff*1440+nowMins)>=closeMins?closeMins:null;
}

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
  // ── v15.2.0: Freshness / resync gate ────────────────────────────────────────
  // A THIRD write-guard dimension after "loaded" and "non-empty": STALENESS.
  // A tab that was asleep/frozen holds an old snapshot; on wake the clock tick
  // fires the auto-extend / auto-complete effects, which would write that stale
  // snapshot over fresher server data. (The incident: a laptop left asleep from
  // ~18:00 overwrote a night of tablet bookings when it woke at ~01:30.) We
  // detect the freeze via a heartbeat whose gap is checked AT WRITE TIME — which
  // is race-free regardless of whether the clock interval or the heartbeat fires
  // first on wake — refuse writes while stale, and force a fresh server re-read.
  const staleRef=useRef(false);
  const lastBeatRef=useRef(Date.now()); // bumped each heartbeat; a large gap == the event loop was frozen (sleep)
  const isConnectedRef=useRef(false);
  const resyncInFlightRef=useRef(false);
  const [resyncing, setResyncing] = useState(false);
  // v15.3.0: server-side revision backstop. `bookings` writes go through an atomic
  // multi-path update that co-bumps a sibling `bookingsRev` integer; a Firebase
  // Security Rule (database.rules.json) rejects the write unless the new rev is
  // exactly serverRev+1 — i.e. our base matched the server (we weren't stale). This
  // is the compare-and-swap that catches any stale write that slips the client gate.
  // The ref tracks the last rev we've seen (from the onValue below or a resync), and
  // we advance it optimistically on write so back-to-back local writes chain cleanly.
  const bookingsRevRef=useRef(0);
  function clearStale(){
    staleRef.current=false;
    lastBeatRef.current=Date.now();
    resyncInFlightRef.current=false;
    setResyncing(false);
  }
  // Force-pull the server's current bookings + tableBlocks, replace local state,
  // then lift the gate. Runs ONLY when connected: an offline get() can resolve
  // from the stale local cache, which must never be allowed to clear the gate.
  function resync(){
    if(resyncInFlightRef.current||!isConnectedRef.current) return;
    resyncInFlightRef.current=true;
    Promise.all([get(ref(db,"bookings")),get(ref(db,"tableBlocks")),get(ref(db,"bookingsRev"))]).then(function(snaps){
      const bVal=snaps[0].val();const bArr=bVal?sanitizeAll(bVal):[];
      setBookings(bArr);
      if(firstLoadCount.current===null) firstLoadCount.current=bArr.length;
      const tVal=snaps[1].val();
      if(tVal){const a=Array.isArray(tVal)?tVal:Object.values(tVal);setTableBlocks(a.filter(Boolean));}
      else setTableBlocks([]);
      const rv=snaps[2].val(); // v15.3.0: re-anchor the rev base to the server's current value
      bookingsRevRef.current=typeof rv==="number"?rv:0;
      clearStale();
    }).catch(function(){
      // Still offline / read failed — stay stale (writes stay blocked, the safe
      // direction); the reconnect handler retries resync() when the socket returns.
      resyncInFlightRef.current=false;
    });
  }
  // Flag the local snapshot as possibly-stale and kick a resync (if connected;
  // otherwise the .info/connected reconnect handler runs it). Idempotent + cheap.
  function markStale(){
    staleRef.current=true;
    setResyncing(true);
    resync();
  }
  // Firebase save helpers — write-on-action only (prevents multi-device data corruption).
  // GUARDED: will refuse to write until Firebase has sent us the initial snapshot.
  // GUARDED: will refuse to overwrite non-empty Firebase with an empty in-memory array
  //   unless firstLoadCount was also 0 (i.e. DB is genuinely new/empty).
  // If `isSilent` is true, refusals only log to console — no user-facing warning.
  // If `isSilent` is false/omitted (default = user action), refusals also surface a red banner.
  // This keeps harmless mount-time effect calls quiet (auto-extend passes isSilent=true)
  // while still alerting on real user-blocked saves.
  function saveBookings(next,isSilent){
    // v15.2.0: staleness gate FIRST — refuse the WHOLE op (no setState, no write)
    // when the local snapshot may be stale, so a frozen tab's auto-write never
    // lands locally OR on the server. resync() then replaces local state with the
    // server's current data; the blocked auto-effect recomputes next tick.
    if(Date.now()-lastBeatRef.current>STALE_GAP_MS) markStale();
    if(staleRef.current){
      console.warn("[SAFE] Refused to write bookings — local data may be stale; resyncing to server first.");
      if(!isSilent) setWriteWarning("Syncing the latest data — your change wasn't saved. Please try again in a moment.");
      return;
    }
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
      // v15.3.0: atomic compare-and-swap — write `bookings` + bump `bookingsRev`
      // together in one multi-path update. The server rule rejects it unless the
      // new rev is exactly serverRev+1, so a stale base (e.g. a write that slipped
      // the client gate) is refused server-side. Advance the ref optimistically so
      // legitimate back-to-back writes chain; a rejection resyncs (which re-anchors
      // the ref to the true server rev) and the auto-effect retries next tick.
      const base=bookingsRevRef.current||0;
      bookingsRevRef.current=base+1;
      update(ref(db),{bookings:computed,bookingsRev:base+1}).catch(function(){
        console.warn("[SAFE] bookings write rejected by server (possible stale revision) — resyncing.");
        markStale();
      });
    }
    if(typeof next==="function"){
      setBookings(function(prev){const computed=next(prev);persist(computed);return computed;});
    } else {
      setBookings(next);persist(next);
    }
  }
  function saveBlocks(next,isSilent){
    // v15.2.0: same staleness gate as saveBookings (see there).
    if(Date.now()-lastBeatRef.current>STALE_GAP_MS) markStale();
    if(staleRef.current){
      console.warn("[SAFE] Refused to write tableBlocks — local data may be stale; resyncing to server first.");
      if(!isSilent) setWriteWarning("Syncing the latest data — your change wasn't saved. Please try again in a moment.");
      return;
    }
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
      clearStale(); // v15.2.0: a live server snapshot proves the local data is current
    });
    return unsub;
  },[]);
  useEffect(function(){
    const unsub=onValue(ref(db,"tableBlocks"),function(snap){
      const val=snap.val();
      if(val){const arr=Array.isArray(val)?val:Object.values(val);setTableBlocks(arr.filter(Boolean));}
      else setTableBlocks([]);
      blocksLoaded.current=true;
      clearStale(); // v15.2.0: a live server snapshot proves the local data is current
    });
    return unsub;
  },[]);
  // v15.3.0: track the server's bookings revision. Updates on every change —
  // including another device's write — so our next local write bumps from the
  // current value (multi-device CAS stays consistent). Read-only; never writes.
  useEffect(function(){
    const unsub=onValue(ref(db,"bookingsRev"),function(snap){
      const v=snap.val();
      bookingsRevRef.current=typeof v==="number"?v:0;
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
      isConnectedRef.current=connected; // v15.2.0: gates resync()'s server read
      if(connected){
        // v15.2.0: if we went stale while offline (a resume/heartbeat fired
        // markStale but resync couldn't read), run it now the socket is back.
        if(staleRef.current) resync();
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
  // v15.2.0: heartbeat + resume detection driving the freshness gate.
  // The heartbeat bumps lastBeatRef every 10s; a gap >STALE_GAP_MS means the
  // event loop was frozen (OS sleep / lid close) → the local snapshot is stale.
  // The resume listeners (focus/pageshow/visibility) catch the wake a beat
  // sooner; both are gap-gated so a quick tab-switch with a live socket (data
  // still fresh) doesn't needlessly resync. Network-only blips keep the loop
  // alive (gap small) so offline editing + the offline queue are untouched.
  useEffect(function(){
    const t=setInterval(function(){
      const gap=Date.now()-lastBeatRef.current;
      lastBeatRef.current=Date.now();
      if(gap>STALE_GAP_MS) markStale();
    },10000);
    function onResume(){ if(Date.now()-lastBeatRef.current>STALE_GAP_MS) markStale(); }
    function onVis(){ if(document.visibilityState==="visible") onResume(); }
    window.addEventListener("focus",onResume);
    window.addEventListener("pageshow",onResume);
    document.addEventListener("visibilitychange",onVis);
    return function(){
      clearInterval(t);
      window.removeEventListener("focus",onResume);
      window.removeEventListener("pageshow",onResume);
      document.removeEventListener("visibilitychange",onVis);
    };
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
      // v15.1.0: a seated booking past its date's close belongs to the
      // auto-complete effect below — skip it here so the same 15s tick
      // doesn't extend it and then immediately complete it (one write, not two).
      if(pastCloseMins(b.date,today,nowMins)!==null) return b;
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

  // v15.1.0: Auto-complete after closing time — any booking still `seated`
  // once its own date's closing moment has passed flips to `completed`
  // automatically. Mirrors the manual updateStatus("completed") path in
  // App.jsx: the duration is frozen at the close moment (auto-extend grew it
  // live while seated, so close is the natural cap) and the audit trail
  // records the flip as "auto" so HistoryPopup shows it wasn't a staff tap.
  // Same contract as the auto-extend effect above: pure pass first, write
  // only when something actually flips, route through bookingsAfterAction,
  // isSilent=true. No loop: the post-write snapshot echo re-runs this effect
  // but the flipped bookings are no longer seated. Past-midnight closes
  // (close = 24/25) are handled by pastCloseMins: yesterday's seated party
  // completes only when that day's 00:00/01:00 close actually passes — never
  // at the midnight date rollover itself.
  useEffect(function(){
    if(!bookingsLoaded.current) return; // no work to do until initial read lands
    const today=new Date().toISOString().slice(0,10);
    let needsUpdate=false;
    const updated=bookings.map(function(b){
      if(b.status!=="seated") return b;
      const closeMins=pastCloseMins(b.date,today,nowMins);
      if(closeMins===null) return b;
      needsUpdate=true;
      const dur=Math.max(15,closeMins-toMins(b.time));
      return Object.assign({},b,{
        status:"completed",duration:dur,customDur:dur,
        history:(b.history||[]).concat([histEntry("status → completed (auto, after closing)","auto")])
      });
    });
    if(!needsUpdate) return;
    saveBookings(bookingsAfterAction(updated,today,tableBlocks,null,false,autoOptimizer),true); // silent — non-interactive auto-complete
  },[nowMins,tableBlocks,autoOptimizer,bookings]);

  return {
    bookings, tableBlocks,
    saveBookings, saveBlocks,
    isOnline, writeWarning, setWriteWarning,
    loadBannerShown, reconnectShown, resyncing,
    // firstLoadCount is exposed as a ref because the load-banner JSX in
    // BookingApp reads .current to show the booking count from the first
    // successful Firebase load. It must remain a ref (not state) so
    // saveBookings can read it synchronously inside the empty-array
    // safety guard without triggering re-renders.
    firstLoadCount,
  };
}
