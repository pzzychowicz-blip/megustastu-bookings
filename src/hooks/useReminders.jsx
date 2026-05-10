// src/hooks/useReminders.jsx
//
// Phase D2 (v14.1.9): Reminder subsystem extracted from BookingApp into a
// self-contained hook. Owns all reminder state (list, fires, editor draft,
// delete-confirm), both write-guard refs (remindersLoaded, reminderFiresLoaded),
// both Firebase listeners (reminders / reminderFires), the prune-old-fires
// effect, the 30s tick that keeps banners snooze-accurate, both guarded write
// helpers (saveReminders / saveReminderFires), all eight action handlers, and
// the banner derivation + JSX. Banner JSX is built inside the hook so the
// `markReminderDone` / `snoozeReminderFire` handlers stay internal — they're
// only ever called from those banner buttons, never from outside.
//
// Hook signature:
//   const { ... } = useReminders({ nowMins, setWriteWarning });
//
// `nowMins` drives banner re-evaluation (passes through to getActiveReminderBanners).
// `setWriteWarning` is the same banner setter that usePersistence owns — exposed
// from the persistence hook so multiple subsystems can surface refusals through
// one UI element. When more save helpers appear in future hooks, this same
// argument pattern will repeat.
//
// What stays in BookingApp: the confirm-delete Overlay JSX and the ReminderEditor
// modal mount (both use App-scope styling like S, BTN, Overlay). Their state
// and handlers come back from the destructure; the JSX itself is rendered
// inline by BookingApp.

import { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase";
import { BTN } from "../lib/constants";
import { mkBtn } from "../components/atoms";
import { genId } from "../lib/booking-logic";
import {
  getActiveReminderBanners,
  pruneOldReminderFires,
  validateReminderDraft
} from "../lib/reminders";

export function useReminders({ nowMins, setWriteWarning }){
  // v14 p7 deployment: same write-guard pattern as bookings/tableBlocks.
  const remindersLoaded=useRef(false);
  const reminderFiresLoaded=useRef(false);
  // v14 preview 7: Reminders state.
  //   reminders        — list of staff-set reminders (see reminderAppliesTo).
  //   reminderFires    — map of slot-key → {status, until?, at?} for dismissed
  //                      or snoozed fire slots. Scoped per-day via slot-key.
  //   reminderEditor   — null = editor closed; {id, draft} = editing/creating.
  //                      Sits on top of Settings (z=250) when open.
  //   setReminderTick  — unused readback; 30s interval bumps this so banners
  //                      re-evaluate even between nowMins minute-boundary
  //                      updates (catches snooze expiry and time-arrivals).
  const [reminders, setReminders] = useState([]);
  const [reminderFires, setReminderFires] = useState({});
  const [reminderEditor, setReminderEditor] = useState(null);
  // v14 p7 fix: in-app confirmation for reminder deletion — window.confirm is
  // blocked in sandboxed / embedded preview environments, so it never showed
  // the dialog. Matches the confirmDel / confirmCancel pattern used elsewhere.
  const [confirmReminderDel, setConfirmReminderDel] = useState(null);
  const [, setReminderTick] = useState(0);
  // v14 p7 deployment: Firebase-persisted reminder writes, write-guarded.
  //   `reminders` uses the same empty-array safety guard as bookings: if the
  //   DB had any reminders on load, saving an empty array would be refused
  //   unless user intent is explicit (i.e. prior delete+confirm flow).
  //   `reminderFires` does NOT have that guard — fire-state is allowed to
  //   shrink to {} legitimately (e.g. prune after midnight).
  function saveReminders(next,isSilent){
    function persist(computed){
      if(!remindersLoaded.current){
        console.warn("[SAFE] Refused to write reminders — initial read has not completed yet.");
        if(!isSilent) setWriteWarning("Refused to write: Firebase not yet connected. If this persists, reload the page.");
        return;
      }
      set(ref(db,"reminders"),computed).catch(function(){});
    }
    if(typeof next==="function"){
      setReminders(function(prev){const c=next(prev);persist(c);return c;});
    } else {setReminders(next);persist(next);}
  }
  function saveReminderFires(next){
    function persist(computed){
      if(!reminderFiresLoaded.current){
        console.warn("[SAFE] Refused to write reminderFires — initial read has not completed yet.");
        return;
      }
      set(ref(db,"reminderFires"),computed).catch(function(){});
    }
    if(typeof next==="function"){
      setReminderFires(function(prev){const c=next(prev);persist(c);return c;});
    } else {setReminderFires(next);persist(next);}
  }
  // Firebase listeners — reminders. Array stored; object-form also tolerated
  // (defensive — matches the tableBlocks pattern).
  useEffect(function(){
    const unsub=onValue(ref(db,"reminders"),function(snap){
      const val=snap.val();
      if(val){
        const arr=Array.isArray(val)?val:Object.values(val);
        setReminders(arr.filter(Boolean));
      } else {
        setReminders([]);
      }
      remindersLoaded.current=true;
    });
    return unsub;
  },[]);
  useEffect(function(){
    const unsub=onValue(ref(db,"reminderFires"),function(snap){
      const val=snap.val();
      setReminderFires(val&&typeof val==="object"?val:{});
      reminderFiresLoaded.current=true;
    });
    return unsub;
  },[]);
  // Prune fire-state entries older than today. Runs AFTER reminderFires has
  // loaded (hence the dep on reminderFiresLoaded.current via a second effect
  // that watches `reminderFires` itself — once data arrives, we clean it).
  // Using `reminderFires` as dep could loop infinitely if prune is a no-op
  // each time; we guard by only writing when the key set actually shrinks.
  useEffect(function(){
    if(!reminderFiresLoaded.current) return;
    const today=new Date().toISOString().slice(0,10);
    const pruned=pruneOldReminderFires(reminderFires,today);
    if(Object.keys(pruned).length!==Object.keys(reminderFires||{}).length){
      saveReminderFires(pruned);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[reminderFires]);
  // 30s tick so the banner list re-evaluates between nowMins ticks (which
  // only update on minute boundaries). Without this, a snooze expiring
  // mid-minute could stay hidden for up to 60s longer than intended.
  useEffect(function(){
    const t=setInterval(function(){setReminderTick(function(x){return x+1;});},30000);
    return function(){clearInterval(t);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  // Reminder action handlers.
  function markReminderDone(fireKey){
    saveReminderFires(function(prev){const n=Object.assign({},prev);n[fireKey]={status:"done",at:Date.now()};return n;});
  }
  function snoozeReminderFire(fireKey){
    saveReminderFires(function(prev){const n=Object.assign({},prev);n[fireKey]={status:"snoozed",until:Date.now()+15*60*1000};return n;});
  }
  function openNewReminder(){
    const today=new Date().toISOString().slice(0,10);
    setReminderEditor({id:"new",draft:{text:"",times:["21:00"],recurrence:{type:"once",date:today,days:[]},active:true}});
  }
  function openEditReminder(r){
    // Deep-clone to prevent live-editing the stored reminder.
    const draft={
      text:r.text,
      times:(r.times||[]).slice(),
      recurrence:Object.assign({},r.recurrence||{},{days:(r.recurrence&&r.recurrence.days||[]).slice()}),
      active:!!r.active
    };
    setReminderEditor({id:r.id,draft:draft});
  }
  function saveReminderFromEditor(){
    if(!reminderEditor) return;
    const d=reminderEditor.draft;
    if(validateReminderDraft(d)) return; // UI button is disabled; guard here too.
    // Normalize: dedupe times, sort ascending, trim text.
    const uniqTimes=Array.from(new Set(d.times));uniqTimes.sort();
    const cleanDraft=Object.assign({},d,{times:uniqTimes,text:d.text.trim()});
    const id=reminderEditor.id;
    if(id==="new"){
      const newR=Object.assign({id:genId(),createdAt:Date.now()},cleanDraft);
      saveReminders(function(prev){return prev.concat([newR]);});
    } else {
      saveReminders(function(prev){return prev.map(function(r){return r.id===id?Object.assign({},r,cleanDraft):r;});});
    }
    setReminderEditor(null);
  }
  function deleteReminder(id){
    // v14 p7 fix: open in-app confirmation. Actual removal happens in doDeleteReminder.
    setConfirmReminderDel(id);
  }
  function doDeleteReminder(id){
    saveReminders(function(prev){return prev.filter(function(r){return r.id!==id;});});
    setConfirmReminderDel(null);
  }
  function toggleReminderActive(id){
    saveReminders(function(prev){return prev.map(function(r){return r.id===id?Object.assign({},r,{active:!r.active}):r;});});
  }

  // v14 p7: reminder banners. Recomputed each render (cheap). nowMins ticks
  // every minute; reminderTick forces re-render every 30s for snooze-expiry.
  // Uses TODAY (not viewDate) — reminders are operational, not tied to the
  // day being viewed. So a reminder fires at 21:00 regardless of whether
  // staff are looking at tomorrow's timeline.
  const reminderTodayStr=new Date().toISOString().slice(0,10);
  const activeReminderBanners=getActiveReminderBanners(reminders,reminderFires,reminderTodayStr,nowMins);
  // One row per active fire slot, stacked vertically. Amber (distinct from the
  // green success toasts and red error banners), with Done + Snooze actions.
  const reminderBanners=activeReminderBanners.length?<div style={{marginBottom:10}}>{activeReminderBanners.map(function(ab){
      return (
        <div
          key={ab.fireKey}
          style={{background:"rgba(254,243,199,0.8)",border:"2px solid rgba(251,191,36,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:6,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}><div
            style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0,flexWrap:"wrap"}}><span style={{fontSize:14,fontWeight:700,color:"#78350f"}}>⏰ Reminder</span><span
              style={{fontSize:11,padding:"2px 8px",borderRadius:6,background:"rgba(146,64,14,0.15)",color:"#78350f",fontWeight:700,letterSpacing:"0.02em",whiteSpace:"nowrap"}}>{ab.time}</span><span
              style={{fontSize:14,color:"#78350f",fontWeight:700,wordBreak:"break-word"}}>{ab.reminder.text}</span></div><div style={{display:"flex",gap:6,flexShrink:0}}><button
              onClick={function(){snoozeReminderFire(ab.fireKey);}}
              style={mkBtn({fontSize:12,minHeight:34,padding:"4px 12px",background:BTN.nav})}>Snooze 15m</button><button
              onClick={function(){markReminderDone(ab.fireKey);}}
              style={{background:"rgba(22,101,52,0.8)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:"#fff",minHeight:34,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Done</button></div></div>
      );
    })}</div>:null;

  return {
    reminders,
    reminderEditor, setReminderEditor,
    confirmReminderDel, setConfirmReminderDel,
    saveReminderFromEditor,
    doDeleteReminder,
    openNewReminder, openEditReminder,
    deleteReminder, toggleReminderActive,
    reminderBanners,
  };
}
