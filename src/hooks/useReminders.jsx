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
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { BTN, R } from "../lib/constants";
import { mkBtn } from "../components/atoms";
import { genId } from "../lib/booking-logic";
import { dbError } from "../lib/dbError";
import { sameDraft } from "../lib/drafts";
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
  // v17.8.0 unsaved-changes guard: the draft the editor was OPENED with. Set
  // ONLY by openNewReminder / openEditReminder — the two doors — so every other
  // setReminderEditor is a user edit and correctly reads as dirty. State rather
  // than a ref: it feeds a value derived during render.
  const [reminderBaseline, setReminderBaseline] = useState(null);
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
  // v16.0.0: BOTH saves converted to the ref-mirror shape (compute from a live
  // ref, then setState + write as plain statements) — retiring this hook's old
  // set()-inside-updater pattern, the shape that PERSISTED a duplicate waitlist
  // entry under StrictMode (see CLAUDE.md gotcha table / useWaitlist.js). The
  // writes are revision-CAS guarded (lib/revGuard.js): a stale device's
  // overwrite is rejected server-side and the rollback echo restores state.
  const remindersRef=useRef([]);
  const reminderFiresRef=useRef({});
  const remindersRevRef=useRef(0);
  const reminderFiresRevRef=useRef(0);
  function saveReminders(next,isSilent){
    if(!remindersLoaded.current){
      console.warn("[SAFE] Refused to write reminders — initial read has not completed yet.");
      if(!isSilent) setWriteWarning("Refused to write: Firebase not yet connected. If this persists, reload the page.");
      return;
    }
    const computed=typeof next==="function"?next(remindersRef.current):next;
    remindersRef.current=computed;
    setReminders(computed);
    writeWithRev("reminders",computed,remindersRevRef,function(){
      if(!isSilent) setWriteWarning("Couldn't save — this device's data was out of date and has been refreshed. Please redo the change.");
    });
  }
  function saveReminderFires(next){
    if(!reminderFiresLoaded.current){
      console.warn("[SAFE] Refused to write reminderFires — initial read has not completed yet.");
      return;
    }
    const computed=typeof next==="function"?next(reminderFiresRef.current):next;
    reminderFiresRef.current=computed;
    setReminderFires(computed);
    writeWithRev("reminderFires",computed,reminderFiresRevRef,function(){});
  }
  // Firebase listeners — reminders. Array stored; object-form also tolerated
  // (defensive — matches the tableBlocks pattern).
  useEffect(function(){
    const unsub=onValue(ref(db,"reminders"),function(snap){
      const val=snap.val();
      const arr=val?(Array.isArray(val)?val:Object.values(val)).filter(Boolean):[];
      remindersRef.current=arr;
      setReminders(arr);
      remindersLoaded.current=true;
    },dbError("reminders"));
    return unsub;
  },[]);
  useEffect(function(){
    const unsub=onValue(ref(db,"reminderFires"),function(snap){
      const val=snap.val();
      const m=val&&typeof val==="object"?val:{};
      reminderFiresRef.current=m;
      setReminderFires(m);
      reminderFiresLoaded.current=true;
    },dbError("reminderFires"));
    return unsub;
  },[]);
  useEffect(function(){ return attachRev("reminders",remindersRevRef); },[]);
  useEffect(function(){ return attachRev("reminderFires",reminderFiresRevRef); },[]);
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
   
  },[reminderFires]);
  // 30s tick so the banner list re-evaluates between nowMins ticks (which
  // only update on minute boundaries). Without this, a snooze expiring
  // mid-minute could stay hidden for up to 60s longer than intended.
  useEffect(function(){
    const t=setInterval(function(){setReminderTick(function(x){return x+1;});},30000);
    return function(){clearInterval(t);};
   
  },[]);
  // Reminder action handlers.
  function markReminderDone(fireKey){
    saveReminderFires(function(prev){const n=Object.assign({},prev);n[fireKey]={status:"done",at:Date.now()};return n;});
  }
  function snoozeReminderFire(fireKey){
    saveReminderFires(function(prev){const n=Object.assign({},prev);n[fireKey]={status:"snoozed",until:Date.now()+15*60*1000};return n;});
  }
  // v17.8.0: flatten a reminder draft before diffing it. `sameDraft`'s norm()
  // falls back to JSON.stringify for a nested object, which is key-ORDER
  // sensitive — and `recurrence` is rebuilt by spreads all over ReminderEditor,
  // so two equivalent drafts could serialise differently and read as dirty. The
  // arrays survive as arrays because norm() sorts those, which is right here:
  // reordering `times` or `days` is not an edit.
  function flatReminder(d){
    if(!d) return null;
    const rec=d.recurrence||{};
    return {text:d.text,active:d.active,times:d.times,rec_type:rec.type,rec_date:rec.date,rec_days:rec.days};
  }
  const reminderDirty=!!reminderEditor&&!sameDraft(flatReminder(reminderEditor.draft),flatReminder(reminderBaseline));

  function openNewReminder(){
    const today=new Date().toISOString().slice(0,10);
    const draft={text:"",times:["21:00"],recurrence:{type:"once",date:today,days:[]},active:true};
    setReminderBaseline(draft);
    setReminderEditor({id:"new",draft:draft});
  }
  function openEditReminder(r){
    // Deep-clone to prevent live-editing the stored reminder.
    const draft={
      text:r.text,
      times:(r.times||[]).slice(),
      recurrence:Object.assign({},r.recurrence||{},{days:(r.recurrence&&r.recurrence.days||[]).slice()}),
      active:!!r.active
    };
    setReminderBaseline(draft);
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
  // v17.8.0: on the shared banner pane (see BannerRows.jsx / AppBanners.jsx) —
  // 1px border, soft tint, a semantic dot instead of the ⏰ glyph plus a 2px
  // amber ring. v17.8.0 had only just moved this off raw hex literals; the
  // literals were the correctness bug, this is the consistency one.
  // v17.8.0: this is a SECTION BODY now, not a pane. NotificationStrip owns the
  // one pane every notification shares (see NotificationStrip.jsx) and draws
  // the dot + "Reminder" title + count header, so each row here supplies only
  // its time, text and actions. paddingLeft 31 lines the rows up with the
  // section titles above them, and rows are hairline-separated like every other
  // section's. `reminderCount` is exported alongside because the strip needs the
  // count as data for its collapsed summary.
  const reminderCount=activeReminderBanners.length;
  const reminderBanners=reminderCount?<div>{activeReminderBanners.map(function(ab,i){
      return (
        <div
          key={ab.fireKey}
          style={{padding:"9px 14px 9px 31px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",...(i>0?{borderTop:"1px solid var(--border-soft)"}:null)}}><div
            style={{display:"flex",alignItems:"center",gap:9,flex:1,minWidth:0,flexWrap:"wrap"}}><span
              style={{fontSize:11,color:"var(--warn-text)",fontWeight:700,letterSpacing:"0.02em",whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums",opacity:0.85}}>{ab.time}</span><span
              style={{fontSize:13,color:"var(--text-primary)",fontWeight:600,wordBreak:"break-word"}}>{ab.reminder.text}</span></div><div style={{display:"flex",gap:6,flexShrink:0}}><button
              onClick={function(){snoozeReminderFire(ab.fireKey);}}
              className="mgt-hover-scale mgt-press"
              style={mkBtn({fontSize:12,minHeight:34,padding:"4px 12px",background:BTN.nav})}>Snooze 15m</button><button
              onClick={function(){markReminderDone(ab.fireKey);}}
              className="mgt-hover-scale mgt-press"
              style={mkBtn({fontSize:12,minHeight:34,padding:"6px 14px",background:"var(--app-success-solid)"})}>Done</button></div></div>
      );
    })}</div>:null;

  return {
    reminders,
    reminderEditor, setReminderEditor,
    reminderDirty,
    confirmReminderDel, setConfirmReminderDel,
    saveReminderFromEditor,
    doDeleteReminder,
    openNewReminder, openEditReminder,
    deleteReminder, toggleReminderActive,
    reminderBanners, reminderCount,
  };
}
