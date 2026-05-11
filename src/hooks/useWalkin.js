// src/hooks/useWalkin.js
//
// Phase D4 (v14.1.11): Walk-in subsystem extracted from BookingApp.
// Owns the three walk-in state slots (showWalkin, walkinForm,
// walkinError), the today-scoped "Walk-in N" numbering helper, and the
// three handlers (openWalkin / doSaveWalkin / saveWalkin).
//
// Hook signature:
//   const {
//     showWalkin, setShowWalkin,
//     walkinForm, setWalkinForm,
//     walkinError,
//     getNextWalkinNum,
//     openWalkin, saveWalkin, doSaveWalkin,
//   } = useWalkin({
//     bookings, saveBookings,
//     setViewDate, getUser,
//     confirmKitchen, setConfirmKitchen,
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

import { useState } from "react";
import { KITCHEN_TABLE_LIMIT } from "../lib/constants";
import {
  getDur, genId, histEntry, nowTime, getKitchenLoad
} from "../lib/booking-logic";

export function useWalkin({
  bookings, saveBookings,
  setViewDate, getUser,
  confirmKitchen, setConfirmKitchen,
}){
  const [showWalkin, setShowWalkin] = useState(false);
  const [walkinForm, setWalkinForm] = useState({size:2,notes:"",tables:[],time:""});
  const [walkinError, setWalkinError] = useState("");
  // Today-scoped "Walk-in N" numbering. Scans bookings for names
  // matching the "Walk-in " prefix on today's date and returns max+1.
  // Re-evaluated on every render that calls it (it's not memoised) —
  // cheap because the bookings array is already a single linear scan.
  function getNextWalkinNum(){
    const today=new Date().toISOString().slice(0,10);
    let max=0;bookings.forEach(function(b){if(b.date===today&&b.name&&b.name.indexOf("Walk-in ")===0){const n=parseInt(b.name.slice(8));if(n>max) max=n;}});
    return max+1;
  }
  function openWalkin(){setWalkinForm({size:2,notes:"",tables:[],time:nowTime(),customDur:null});setWalkinError("");setShowWalkin(true);}
  // doSaveWalkin: actual write. Builds a sanitised booking object with
  // status:"seated", _manual:true, _locked:true (walk-ins are always
  // hand-assigned and never reshuffled), and appends it. Also forces
  // viewDate to today so staff immediately see the new walk-in.
  function doSaveWalkin(){
    const wf=walkinForm;
    if(!wf.tables||!wf.tables.length){setWalkinError("Please assign tables first.");return;}
    const t=wf.time||nowTime();const size=Number(wf.size)||2;const dur=wf.customDur||getDur(size);
    const nb={id:genId(),name:"Walk-in "+getNextWalkinNum(),phone:"",date:new Date().toISOString().slice(0,10),time:t,scheduledTime:t,size:size,duration:dur,originalDuration:dur,preference:"auto",notes:wf.notes||"",status:"seated",tables:wf.tables,customDur:wf.customDur||null,_manual:true,_locked:true,history:[histEntry("walk-in created",getUser())]};
    saveBookings(function(prev){return prev.concat([nb]);});
    setShowWalkin(false);setViewDate(new Date().toISOString().slice(0,10));
  }
  // saveWalkin: kitchen-load guard. If adding this walk-in would push
  // simultaneous starts over KITCHEN_TABLE_LIMIT, raise the shared
  // confirm-kitchen modal with the "walkin" key (the modal's Confirm
  // button branches on this key to dispatch back to doSaveWalkin).
  // !confirmKitchen prevents re-raising if the modal is already up.
  function saveWalkin(){
    const wf=walkinForm;
    const t=wf.time||nowTime();const size=Number(wf.size)||2;const dur=wf.customDur||getDur(size);
    const wDate=new Date().toISOString().slice(0,10);
    const load=getKitchenLoad(bookings,wDate,t,dur,null);
    if(load.starts+1>=KITCHEN_TABLE_LIMIT&&!confirmKitchen){
      setConfirmKitchen("walkin");return;
    }
    setConfirmKitchen(null);doSaveWalkin();
  }

  return {
    showWalkin, setShowWalkin,
    walkinForm, setWalkinForm,
    walkinError,
    getNextWalkinNum,
    openWalkin, saveWalkin, doSaveWalkin,
  };
}
