// src/hooks/useWalkin.js
//
// Phase D4 (v14.1.11): Walk-in subsystem extracted from BookingApp.
// Owns the walk-in draft slots (walkinForm, walkinError), the today-scoped
// "Walk-in N" numbering helper, and the three handlers (openWalkin /
// doSaveWalkin / saveWalkin). v17.14.0: `showWalkin` moved OUT — it is an entry
// in App's modal stack and is passed in, like `confirmKitchen`.
//
// Hook signature:
//   const {
//     walkinForm, setWalkinForm,
//     walkinError, walkinDirty,
//     getNextWalkinNum,
//     openWalkin, saveWalkin, doSaveWalkin,
//   } = useWalkin({
//     bookings, saveBookings,
//     setViewDate, getUser,
//     confirmKitchen, setConfirmKitchen,
//     showWalkin, setShowWalkin,
//   });
//
// `setWalkinError` stays internal — nothing outside the hook writes to
// the walk-in error string. The WalkinForm component receives it via
// the `error` prop (read-only) and only `doSaveWalkin` raises errors;
// `openWalkin` clears them.
//
// What stays in BookingApp:
//   • The walk-in modal mount JSX (renders <WalkinForm>) — it threads
//     ~10 props of which 4 come from outside the walk-in subsystem
//     (liveBookings, bookings, tableBlocks, autoOptimizer); moving the
//     JSX would just shift prop-routing without architectural gain.
//   • The shared confirmKitchen modal — it dispatches between booking-
//     form save and walk-in save based on the confirmKitchen string
//     value, so it's legitimately cross-subsystem and belongs in
//     BookingApp alongside the booking-form save path.
//   • The "Walk-in" trigger button next to the date picker.
//
// Why confirmKitchen flows in as args rather than being owned here:
// the confirm-kitchen modal is shared with the booking-form save flow
// (doSave also raises it). Same pattern as D2's setWriteWarning being
// owned by usePersistence but threaded into useReminders so both
// subsystems' save-refusals surface through the same UI.
//
// Why getUser flows in as a function reference: it reads
// auth.currentUser at call time (not at mount time), so passing the
// function itself preserves the late-binding contract. Hoisting makes
// it callable from this hook's args even though it's textually
// declared further down BookingApp's body.

import { useState, useRef } from "react";
import { READY, DISPATCHED, mayDispatch } from "../lib/submitGuard";
import { KITCHEN_TABLE_LIMIT, hoursFor } from "../lib/constants";
import { sameDraft } from "../lib/drafts";
import {
  getDur, genId, histEntry, nowTime, getKitchenLoad
} from "../lib/booking-logic";
import { todayStr } from "../lib/day";

// v17.14.0: `showWalkin` is now OWNED BY APP and passed in — it is one entry in
// the app's single modal stack, the same "legitimately shared" arrangement
// `confirmKitchen` already had with this hook. The walk-in DRAFT, its baseline
// and its dirty flag stay here; only "is this surface on screen" moved, because
// that is a fact about the stack rather than about walk-ins.
export function useWalkin({
  bookings, saveBookings,
  setViewDate, getUser,
  confirmKitchen, setConfirmKitchen,
  showWalkin, setShowWalkin,
  defaultWalkinSize = 2, // v17.2.0: settings/general starting party size
}){
  const [walkinForm, setWalkinForm] = useState({size:defaultWalkinSize,notes:"",tables:[],time:""});
  const [walkinError, setWalkinError] = useState("");
  // v17.16.0: commit-once guard for this surface (src/lib/submitGuard.js).
  // A ref, not state: it is read synchronously at the top of doSaveWalkin and
  // must be current within the same tick as the tap that set it — a state
  // update would not have landed before the second tap arrives.
  const walkinGuardRef = useRef(READY);
  // Today-scoped "Walk-in N" numbering. Scans bookings for names
  // matching the "Walk-in " prefix on today's date and returns max+1.
  // Re-evaluated on every render that calls it (it's not memoised) —
  // cheap because the bookings array is already a single linear scan.
  function getNextWalkinNum(){
    const today=todayStr();
    let max=0;bookings.forEach(function(b){if(b.date===today&&b.name&&b.name.indexOf("Walk-in ")===0){const n=parseInt(b.name.slice(8));if(n>max) max=n;}});
    return max+1;
  }
  // v17.5.0 (unsaved-changes guard): the draft this form was OPENED with.
  // `walkinDirty` below diffs the live draft against it, so an untouched form
  // closes silently and only real edits raise the discard confirm. Every write
  // to walkinForm AFTER open is a user edit, so this is set in openWalkin only.
  // STATE, not a ref: it is read during render to produce a rendered value, so
  // a ref would be both a lint error and the wrong tool (a ref change wouldn't
  // repaint). It only ever changes when the form opens, so the extra state
  // costs nothing.
  const [walkinBaseline, setWalkinBaseline] = useState(null);

  // v17.0.0: optional table pre-select — the Plan view's "Walk-in here" passes
  // the tapped table's id. STRING-guarded because the header button wires
  // onClick={openWalkin}, which passes the click event as the first arg.
  function openWalkin(preTableId){
    const pre=typeof preTableId==="string"&&preTableId?[preTableId]:[];
    // v17.1.1: `_pre` marks the Plan-view "Walk-in here" path — the host chose
    // the table BEFORE the form, so editing the guest count must NOT deselect
    // it (WalkinForm's size steppers keep `tables` when the flag is set; the
    // normal Walk-in-button path keeps the old reset-on-size-change).
    const fresh={size:defaultWalkinSize,notes:"",tables:pre,time:nowTime(),customDur:null,_pre:pre.length>0};
    setWalkinBaseline(fresh);
    setWalkinForm(fresh);
    setWalkinError("");setShowWalkin(true);
    // v17.16.0: the commit-once guard resets HERE — openWalkin is this
    // surface's single door, and already the one place that snapshots the
    // unsaved-changes baseline. See src/lib/submitGuard.js, rule 3.
    walkinGuardRef.current=READY;
  }
  // doSaveWalkin: actual write. Builds a sanitised booking object with
  // status:"seated", _manual:true, _locked:true (walk-ins are always
  // hand-assigned and never reshuffled), and appends it. Also forces
  // viewDate to today so staff immediately see the new walk-in.
  function doSaveWalkin(){
    // v17.16.0: one open of this form produces at most one walk-in. Same defect
    // and same shape as the booking form's doSave — a walk-in mints its `genId()`
    // inline too, so two taps 200 ms apart seat two parties on the same tables
    // while the modal is still fading out. src/lib/submitGuard.js.
    if(!mayDispatch(walkinGuardRef.current)) return;
    const wf=walkinForm;
    if(!wf.tables||!wf.tables.length){setWalkinError("Please assign tables first.");return;}
    const t=wf.time||nowTime();const size=Number(wf.size)||2;const dur=wf.customDur||getDur(size);
    const nb={id:genId(),name:"Walk-in "+getNextWalkinNum(),phone:"",date:todayStr(),time:t,scheduledTime:t,size:size,duration:dur,originalDuration:dur,preference:"auto",notes:wf.notes||"",status:"seated",tables:wf.tables,customDur:wf.customDur||null,_manual:true,_locked:true,history:[histEntry("walk-in created",getUser())]};
    saveBookings(function(prev){return prev.concat([nb]);});
    // Armed after the dispatch, on the line that closes the form — the
    // "Please assign tables first" return above leaves it READY.
    walkinGuardRef.current=DISPATCHED;
    setShowWalkin(false);setViewDate(todayStr());
  }
  // saveWalkin: kitchen-load guard. If adding this walk-in would push
  // simultaneous starts over KITCHEN_TABLE_LIMIT, raise the shared
  // confirm-kitchen modal with the "walkin" key (the modal's Confirm
  // button branches on this key to dispatch back to doSaveWalkin).
  // !confirmKitchen prevents re-raising if the modal is already up.
  function saveWalkin(){
    // v17.16.0: guarded here as well as in doSaveWalkin — this is the Seat
    // button's handler and the kitchen branch below can return before
    // doSaveWalkin is reached, raising a "Kitchen busy" dialog for a walk-in
    // already seated. Same shape as App's `save`; see src/lib/submitGuard.js.
    if(!mayDispatch(walkinGuardRef.current)) return;
    const wf=walkinForm;
    const t=wf.time||nowTime();const size=Number(wf.size)||2;const dur=wf.customDur||getDur(size);
    const wDate=todayStr();
    // v15.0.0: per-weekday hours — block a walk-in when today is marked Closed.
    if(hoursFor(wDate).closed){setWalkinError("Closed today — walk-ins can't be added. Open today in Settings → Opening hours if this is wrong.");return;}
    const load=getKitchenLoad(bookings,wDate,t,dur,null);
    if(load.starts+1>=KITCHEN_TABLE_LIMIT&&!confirmKitchen){
      setConfirmKitchen("walkin");return;
    }
    setConfirmKitchen(null);doSaveWalkin();
  }

  // v17.5.0: does closing this form lose work? False whenever the form is shut
  // (a stale draft behind a closed modal must never arm the beforeunload guard).
  const walkinDirty=showWalkin&&!sameDraft(walkinForm,walkinBaseline);

  return {
    walkinForm, setWalkinForm,
    walkinError, walkinDirty,
    getNextWalkinNum,
    openWalkin, saveWalkin, doSaveWalkin,
  };
}
