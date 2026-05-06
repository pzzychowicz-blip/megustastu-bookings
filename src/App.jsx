/**
 * Me Gustas Tú — Booking System
 * Version 14.1
 *
 * Copyright © 2026 Patryk Zychowicz. All rights reserved.
 *
 * This source code is proprietary and confidential.
 * Unauthorized copying, distribution, modification, or use
 * is strictly prohibited. See the LICENSE file in the repo root.
 *
 * Author:  Patryk Zychowicz
 * Contact: pz.zychowicz@gmail.com
 */
import React, { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { db, auth } from "./firebase";

// ── Phase A extraction (v15-refactor) ────────────────────────────────────────
// Pure data and pure logic moved into ./lib/* modules. Symbols below are now
// imported rather than defined inline. Behaviour and signatures are unchanged.
import {
  INDOOR, OUTDOOR, ALL_TABLES, TIMELINE_TABLES, VALID_COMBOS, CLUSTERS,
  OPEN, CLOSE, GRID_CLOSE, KITCHEN_TABLE_LIMIT, QUARTER_HOURS,
  ROW_H, LABEL_W, STATUS_COLORS, BLOCK_BG, S, TBL, BTN, EMPTY_FORM
} from "./lib/constants";

import {
  getDur, toMins, toTime, overlaps, genId,
  sanitize, histEntry, diffBooking, sanitizeAll,
  isIn, isAllIn, isAllOut, isMixedLarge, comboOk, comboCap, isLocked, isActive,
  getBlockSlots, getBusy, canAssign,
  findBest, findBestAny,
  trialFits, findTimes, formatSugg,
  getKitchenLoad, findKitchenFriendlyTimes, findAllOptions,
  optimise, applyOpt,
  optimizerActiveFor, syncLiveDurations, applySeatedShift, findFreeSlot, bookingsAfterAction,
  verifyClean, checkInefficent
} from "./lib/booking-logic";

import {
  reminderFireKey, reminderAppliesTo, getActiveReminderBanners,
  pruneOldReminderFires, validateReminderDraft
} from "./lib/reminders";


// ── Phase B1 (v15-refactor): UI atoms extracted to ./components/atoms.jsx ──
// First component file in the codebase using JSX syntax. App.jsx itself stays
// in RC() style for now; atoms render correctly when called from RC()
// because React.createElement accepts any component reference.
import {
  Overlay, Fld, Section, SBadge, TBadge, SmallTag, Toggle, Kbd,
  AvailBanner, mkInp, mkBtn
} from "./components/atoms";


// ── App fingerprint (do not remove) ──────────────────────────────────────────
// Module-level identity record. Survives bundling/minification — the strings
// below remain readable in any deployed bundle. Referenced by the boot banner
// (window assignment + console.log) so the bundler cannot tree-shake it.
// Forensic evidence of origin if this code appears in an unauthorized deployment.
var __APP_SIGNATURE__={
  app:"Me Gustas Tú Booking System",
  version:"14.1",
  author:"Patryk Zychowicz",
  contact:"pz.zychowicz@gmail.com",
  copyright:"© 2026 Patryk Zychowicz. All rights reserved.",
  license:"Proprietary — All rights reserved. See LICENSE.",
  build:"v14.1-deployment"
};
if(typeof window!=="undefined"){window.__MGT_BUILD__=__APP_SIGNATURE__;}

// ── Console boot banner ──────────────────────────────────────────────────────
// Logs ownership/version when the app loads. Visible to anyone opening DevTools.
console.log(
  "%c"+__APP_SIGNATURE__.app+" — v"+__APP_SIGNATURE__.version,
  "color:#60a5fa;font-size:18px;font-weight:500;font-family:Menlo,Monaco,Consolas,monospace;padding:2px 0;"
);
console.log(
  "%c"+__APP_SIGNATURE__.copyright,
  "color:#9ca3af;font-size:13px;font-family:Menlo,Monaco,Consolas,monospace;"
);
console.log(
  "%cUnauthorized use, copying, redistribution, or modification is prohibited.",
  "color:#9ca3af;font-size:12px;font-family:Menlo,Monaco,Consolas,monospace;"
);

// ── v14 Deployment — Firebase + auth integrated ───────────────────────────────
// This file is the production target for v14. All v14 preview work is overlaid
// on top of v13 dev: Book Again, Overlap Reassign fix, Seated-shift on
// Confirmed→Seated, Settings cog & tabbed modal, full keyboard shortcuts,
// thicker grid lines, and the v14 preview 7 Reminder system.
// v14.1: connection-status banner, IP protection layer (header, LICENSE,
// fingerprint, console banner, visible credit in Settings).
// In-app version label (General tab in Settings): "version 14.1".


function useWinW(){var ws=useState(typeof window!=="undefined"?window.innerWidth:1024);var w=ws[0],setW=ws[1];useEffect(function(){function h(){setW(window.innerWidth);}window.addEventListener("resize",h);return function(){window.removeEventListener("resize",h);};},[]);return w;}

var RC=React.createElement;


// ── v14 preview 3: Settings / keyboard-shortcut helpers ─────────────────────
// `Kbd` renders a single keycap. `ShortcutRow` pairs one or more keycaps with a
// description. `ShortcutsContent` is the shared cheatsheet body used in both the
// Settings modal (via the cog icon) and the standalone `?` popup — single source
// of truth so edits in one place propagate everywhere.
function ShortcutRow(props){
  var keys=props.keys;var els=[];
  keys.forEach(function(k,i){if(i>0) els.push(RC("span",{key:"s"+i,style:{fontSize:11,color:"#5a6474",margin:"0 3px"}},"/"));els.push(RC(Kbd,{key:"k"+i,k:k}));});
  return RC("div",{style:{display:"flex",alignItems:"center",gap:10,padding:"5px 0",borderBottom:"1px solid rgba(180,190,210,0.2)"}},
    RC("div",{style:{minWidth:108,display:"flex",gap:2,alignItems:"center",flexShrink:0}},els),
    RC("span",{style:{fontSize:13,color:"#1a1d24"}},props.label));
}
function ShortcutsContent(){
  var sections=[
    {title:"Navigation",rows:[
      {keys:["T"],label:"Timeline view"},
      {keys:["L"],label:"List view"},
      {keys:["D"],label:"Jump to today"},
      {keys:["←","→"],label:"Previous / next day"},
      {keys:["N"],label:"New booking"},
      {keys:["W"],label:"Walk-in"},
      {keys:["?"],label:"Show this help"}
    ]},
    {title:"Timeline",rows:[
      {keys:["F"],label:"Toggle Follow (today only)"},
      {keys:["+","="],label:"Zoom in"},
      {keys:["−"],label:"Zoom out"},
      {keys:["0"],label:"Reset zoom to 1×"},
      {keys:["O"],label:"Toggle Optimizer (today)"},
      {keys:["R"],label:"Reshuffle (today, optimizer OFF)"}
    ]},
    {title:"Edit / New Booking",rows:[
      {keys:["A"],label:"Manual table assignment"},
      {keys:["P"],label:"Preferred tables"},
      {keys:["C"],label:"Clear tables assignment"},
      {keys:["B"],label:"Book Again (edit only, seated / completed)"},
      {keys:["H"],label:"View history (edit only)"}
    ]},
    {title:"Preferred Table picker",rows:[
      {keys:["C"],label:"Clear preferred tables"}
    ]},
    {title:"Manual Table Assignment",rows:[
      {keys:["S"],label:"Toggle Swap busy"},
      {keys:["C"],label:"Clear selected tables"}
    ]},
    {title:"Settings",rows:[
      {keys:["\u2190","\u2192"],label:"Switch between tabs"}
    ]},
    {title:"Universal",rows:[
      {keys:["Esc"],label:"Close current window"},
      {keys:["Enter"],label:"Confirm primary action"}
    ]}
  ];
  return RC("div",null,sections.map(function(sec,si){
    return RC("div",{key:si,style:{marginBottom:si<sections.length-1?14:0}},
      RC("div",{style:{fontSize:11,fontWeight:700,color:"#007AFF",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}},sec.title),
      RC("div",null,sec.rows.map(function(r,ri){return RC(ShortcutRow,{key:ri,keys:r.keys,label:r.label});})));
  }));
}
// Version line + shortcuts cheatsheet — the body of the Settings modal.
// v14 preview 7: converted to tabbed layout (General / Reminders / Shortcuts).
// Takes props for tab state + reminder list handlers. The actual reminder-list
// state lives in BookingApp; this component is purely presentational.
function SettingsContent(props){
  var tab=props.tab,setTab=props.setTab;
  var content;
  if(tab==="general") content=RC(GeneralTabContent,null);
  else if(tab==="reminders") content=RC(RemindersTabContent,{
    reminders:props.reminders,
    onAdd:props.onAddReminder,
    onEdit:props.onEditReminder,
    onDelete:props.onDeleteReminder,
    onToggle:props.onToggleReminder
  });
  else content=RC(ShortcutsContent,null);
  return RC("div",null,
    RC(TabBar,{tabs:[
      {id:"general",label:"General"},
      {id:"reminders",label:"Reminders"},
      {id:"shortcuts",label:"Shortcuts"}
    ],current:tab,onSelect:setTab}),
    content);
}

// Tab switcher for the Settings modal. Pill-shaped with active tab lifted in
// white. Used only once for now but kept modular so future modals can reuse.
function TabBar(props){
  return RC("div",{style:{display:"flex",gap:4,padding:4,borderRadius:12,background:"rgba(240,243,248,0.8)",marginBottom:16,border:"1px solid rgba(210,218,230,0.6)"}},
    props.tabs.map(function(t){
      var active=t.id===props.current;
      return RC("button",{key:t.id,onClick:function(){props.onSelect(t.id);},style:{flex:1,padding:"8px 12px",borderRadius:8,border:"none",background:active?"rgba(255,255,255,0.95)":"transparent",color:active?"#007AFF":"#5a6474",fontWeight:active?700:600,fontSize:13,cursor:"pointer",boxShadow:active?"0 1px 3px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}},t.label);
    }));
}

// General tab — version line + visible copyright credit. Reserved for future
// app-level toggles (e.g. notification sound, default view preference).
function GeneralTabContent(){
  return RC("div",{style:{padding:"28px 12px",textAlign:"center"}},
    RC("div",{style:{fontSize:13,fontWeight:600,color:"#5a6474",letterSpacing:"0.02em"}},"version 14.1"),
    RC("div",{style:{fontSize:11,fontWeight:500,color:"#8a94a3",letterSpacing:"0.02em",marginTop:8}},"© 2026 Patryk Zychowicz — MGT Booking System"));
}

// One row in the Reminders tab — shows text, times, recurrence summary, an
// active/inactive toggle, and Edit / Delete buttons. Fades to 55% when
// inactive so the user can see disabled ones are still there.
var DAY_SHORT_LABELS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function ReminderListItem(props){
  var r=props.reminder;
  var rec=r.recurrence||{};
  var recText="";
  if(rec.type==="once") recText="Once on "+rec.date;
  else if(rec.type==="weekly"){
    var ds=(rec.days||[]).slice().sort(function(a,b){return a-b;}).map(function(i){return DAY_SHORT_LABELS[i];});
    recText="Weekly: "+ds.join(", ");
  }
  var timesText=(r.times||[]).join(", ");
  return RC("div",{style:{background:"rgba(248,250,253,0.9)",border:"1px solid rgba(210,218,230,0.7)",borderRadius:12,padding:"12px 14px",marginBottom:8,opacity:r.active?1:0.55,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}},
    RC("div",{style:{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,marginBottom:6}},
      RC("div",{style:{flex:1,minWidth:0}},
        RC("div",{style:{fontSize:14,fontWeight:700,color:"#1a1d24",marginBottom:2,wordBreak:"break-word"}},r.text),
        RC("div",{style:{fontSize:12,color:"#5a6474"}},timesText+"  ·  "+recText)),
      RC(Toggle,{on:r.active,onClick:function(){props.onToggle(r.id);}})),
    RC("div",{style:{display:"flex",gap:6,marginTop:8}},
      RC("button",{onClick:function(){props.onEdit(r);},style:mkBtn({fontSize:12,minHeight:32,padding:"4px 12px",background:BTN.edit})},"Edit"),
      RC("button",{onClick:function(){props.onDelete(r.id);},style:mkBtn({fontSize:12,minHeight:32,padding:"4px 12px",background:BTN.del})},"Delete")));
}

// Reminders tab body — header row with count + New button, then the list or
// an empty-state placeholder.
function RemindersTabContent(props){
  var reminders=props.reminders||[];
  var listEls=reminders.length===0
    ?RC("div",{style:{textAlign:"center",padding:"28px 14px",color:"#5a6474",fontSize:13,background:"rgba(248,250,253,0.6)",borderRadius:12,border:"1px dashed rgba(180,190,210,0.5)"}},"No reminders yet. Click \u201c+ New reminder\u201d to add one.")
    :RC("div",null,reminders.map(function(r){return RC(ReminderListItem,{key:r.id,reminder:r,onEdit:props.onEdit,onDelete:props.onDelete,onToggle:props.onToggle});}));
  return RC("div",null,
    RC("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:8,flexWrap:"wrap"}},
      RC("div",{style:{fontSize:13,color:"#5a6474"}},reminders.length+" reminder"+(reminders.length!==1?"s":"")),
      RC("button",{onClick:props.onAdd,style:mkBtn({minHeight:36,padding:"6px 14px",background:"rgba(0,122,255,0.75)"})},"+ New reminder")),
    listEls);
}

// Reminder editor — new/edit modal shown on top of Settings (z-index 250 vs
// Overlay's 200). Validation is computed on every render so Save stays live
// with field changes. Days are displayed Mon→Sun (European convention) but
// stored as getDay() indices (0=Sun).
function ReminderEditor(props){
  var draft=props.draft,setDraft=props.setDraft;
  var err=validateReminderDraft(draft);
  var rec=draft.recurrence||{};
  var todayStr=new Date().toISOString().slice(0,10);
  var DAY_LABELS=[
    {i:1,s:"Mon"},{i:2,s:"Tue"},{i:3,s:"Wed"},{i:4,s:"Thu"},
    {i:5,s:"Fri"},{i:6,s:"Sat"},{i:0,s:"Sun"}
  ];
  function updText(v){setDraft(Object.assign({},draft,{text:v}));}
  function updTime(idx,v){var ts=draft.times.slice();ts[idx]=v;setDraft(Object.assign({},draft,{times:ts}));}
  function addTime(){var ts=draft.times.slice();ts.push("21:00");setDraft(Object.assign({},draft,{times:ts}));}
  function removeTime(idx){if(draft.times.length<=1) return;var ts=draft.times.slice();ts.splice(idx,1);setDraft(Object.assign({},draft,{times:ts}));}
  function setType(t){
    var newRec;
    if(t==="once") newRec={type:"once",date:rec.date||todayStr,days:rec.days||[]};
    else newRec={type:"weekly",date:rec.date||todayStr,days:rec.days&&rec.days.length?rec.days:[new Date().getDay()]};
    setDraft(Object.assign({},draft,{recurrence:newRec}));
  }
  function setDate(v){setDraft(Object.assign({},draft,{recurrence:Object.assign({},rec,{date:v})}));}
  function toggleDay(i){
    var cur=Array.isArray(rec.days)?rec.days.slice():[];
    var idx=cur.indexOf(i);
    if(idx>=0) cur.splice(idx,1); else cur.push(i);
    setDraft(Object.assign({},draft,{recurrence:Object.assign({},rec,{days:cur})}));
  }
  function toggleActive(){setDraft(Object.assign({},draft,{active:!draft.active}));}
  return RC("div",{style:{position:"fixed",inset:0,background:"rgba(0,0,0,0.25)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:250,padding:12},onClick:function(e){if(e.target===e.currentTarget)props.onCancel();}},
    RC("div",{style:{background:"rgba(255,255,255,0.85)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderRadius:20,border:"1px solid rgba(255,255,255,0.5)",padding:"22px",width:"100%",maxWidth:520,maxHeight:"90dvh",overflowY:"auto",boxSizing:"border-box",boxShadow:"0 8px 40px rgba(0,0,0,0.15), inset 0 1px 1px rgba(255,255,255,0.8)"}},
      // v14 p7: header matches New booking / Edit booking pattern — centered
      // wrapper + pill-shaped inner with blue background, white bold text.
      RC("div",{style:{textAlign:"center",marginBottom:16}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"rgba(0,122,255,0.75)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},props.isNew?"New reminder":"Edit reminder")),
      RC(Fld,{label:"Text",style:{marginBottom:12}},
        RC("textarea",{value:draft.text,onChange:function(e){updText(e.target.value);},rows:2,placeholder:"e.g. Place order to Coca Cola today",style:Object.assign({},mkInp(),{resize:"vertical"})})),
      RC(Fld,{label:"Times",style:{marginBottom:12}},
        RC("div",null,
          draft.times.map(function(t,i){
            return RC("div",{key:i,style:{display:"flex",gap:6,alignItems:"center",marginBottom:6}},
              RC("input",{type:"time",value:t,onChange:function(e){updTime(i,e.target.value);},style:Object.assign({},mkInp(),{flex:1})}),
              draft.times.length>1?RC("button",{onClick:function(){removeTime(i);},style:mkBtn({minHeight:40,minWidth:40,padding:"0",fontSize:18,background:BTN.del,lineHeight:1})},"\u00d7"):null);
          }),
          RC("button",{onClick:addTime,style:mkBtn({minHeight:36,padding:"6px 12px",fontSize:12,background:BTN.nav})},"+ Add time"))),
      RC(Fld,{label:"Recurrence",style:{marginBottom:12}},
        RC("div",{style:{display:"flex",gap:6}},
          RC("button",{onClick:function(){setType("once");},style:mkBtn({flex:1,minHeight:40,background:rec.type==="once"?S.accent:"rgba(120,130,150,0.45)"})},"One-off"),
          RC("button",{onClick:function(){setType("weekly");},style:mkBtn({flex:1,minHeight:40,background:rec.type==="weekly"?S.accent:"rgba(120,130,150,0.45)"})},"Weekly"))),
      rec.type==="once"?RC(Fld,{label:"Date",style:{marginBottom:12}},
        RC("input",{type:"date",value:rec.date||"",min:todayStr,onChange:function(e){setDate(e.target.value);},style:mkInp()})):null,
      rec.type==="weekly"?RC(Fld,{label:"Days",style:{marginBottom:12}},
        RC("div",{style:{display:"flex",gap:4,flexWrap:"wrap"}},
          DAY_LABELS.map(function(d){
            var sel=(rec.days||[]).indexOf(d.i)>=0;
            return RC("button",{key:d.i,onClick:function(){toggleDay(d.i);},style:mkBtn({flex:1,minWidth:48,minHeight:40,padding:"8px 6px",fontSize:12,background:sel?S.accent:"rgba(120,130,150,0.45)"})},d.s);
          }))):null,
      RC("div",{style:{display:"flex",alignItems:"center",gap:10,marginBottom:14,padding:"10px 12px",background:"rgba(248,250,253,0.7)",borderRadius:12,border:"1px solid rgba(210,218,230,0.6)"}},
        RC(Toggle,{on:draft.active,onClick:toggleActive}),
        RC("span",{style:{fontSize:13,color:"#1a1d24",fontWeight:600}},draft.active?"Active":"Inactive")),
      err?RC("div",{style:{color:"#991b1b",fontSize:13,padding:"8px 12px",background:"rgba(254,226,226,0.7)",borderRadius:12,border:"1px solid rgba(252,165,165,0.55)",marginBottom:12}},err):null,
      RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8}},
        RC("button",{onClick:props.onCancel,style:mkBtn({minHeight:40,padding:"8px 18px",background:BTN.cancel})},"Cancel"),
        RC("button",{onClick:function(){if(!err) props.onSave();},disabled:!!err,style:{background:err?"rgba(180,180,190,0.4)":"rgba(22,101,52,0.8)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 22px",cursor:err?"not-allowed":"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:40,boxShadow:err?"none":"0 2px 8px rgba(22,101,52,0.2), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Save"))));
}
// Cog (gear) SVG — 20×20, used as the Settings trigger in TimelineView's
// legend row. Stroke inherits from the button's `color` via currentColor.
function CogIcon(){
  return RC("svg",{width:20,height:20,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},
    RC("circle",{cx:12,cy:12,r:3}),
    RC("path",{d:"M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"}));
}


// ── Table Grid ───────────────────────────────────────────────────────────
var TABLE_GROUPS=[
  {name:"Tables: 1A / 1B / 7",color:"#78716c",note:"1A+1B = 6 · table 7 = 4 standalone",tables:[{id:"1A",cap:2},{id:"1B",cap:2},{id:"7",cap:4}]},
  {name:"Tables: 2 / 3 / 4",color:"#78716c",note:"2+3 = 5 · 3+4 = 4 · 2+3+4 = 8",tables:[{id:"2",cap:2},{id:"3",cap:2},{id:"4",cap:2}]},
  {name:"Tables: 5A / 5B / 6",color:"#78716c",note:"5A+5B = 5 · 5B+6 = 5 · 5A+5B+6 = 8",tables:[{id:"5A",cap:2},{id:"5B",cap:2},{id:"6",cap:2}]},
  {name:"Tables: i2 / i3 / i4",color:"#7c3aed",note:"i2+i3 = 6 · i3+i4 = 6 · i2+i3+i4 = 8",tables:[{id:"i2",cap:2},{id:"i3",cap:2},{id:"i4",cap:2}]},
  {name:"Table: i1",color:"#7c3aed",note:"Standalone cap 2 · all 4 indoor = 10",tables:[{id:"i1",cap:2}]},
];
function TableGrid(props){
  var selected=props.selected,toggle=props.toggle,busy=props.busy,seatedBusy=props.seatedBusy||new Set(),swapBusy=!!props.swapBusy;
  function isBlocked(id){if(!busy.has(id)) return false;if(swapBusy&&!seatedBusy.has(id)) return false;return true;}
  var groupEls=TABLE_GROUPS.map(function(grp){
    var noteEl=grp.note?RC("div",{key:"note",style:{fontSize:12,color:S.text,marginBottom:6,fontStyle:"italic"}},grp.note):null;
    var tableEls=grp.tables.map(function(t){
      var blocked=isBlocked(t.id),isSel=selected.includes(t.id),isBusyT=busy.has(t.id)&&!blocked;
      var indoor=isIn(t.id);var tc=indoor?TBL.ind:TBL.out;
      var bg,clr,brd;
      if(isSel){bg="rgba(249,115,22,0.8)";clr="#fff";brd="2px solid rgba(249,115,22,0.9)";}
      else if(blocked){bg="rgba(220,60,60,0.75)";clr="#fff";brd="2px solid rgba(220,60,60,0.8)";}
      else if(isBusyT){bg="rgba(250,204,21,0.7)";clr="#fff";brd="2px solid rgba(250,204,21,0.8)";}
      else{bg="rgba(255,255,255,0.4)";clr=S.text;brd="2px solid "+tc.bg;}
      var label=blocked?"busy":isBusyT?"swap":isSel?"selected":"cap "+t.cap;
      var subClr=isSel||blocked||isBusyT?"rgba(255,255,255,0.8)":S.text;
      return RC("button",{key:t.id,onClick:function(){toggle(t.id);},style:{width:64,height:52,padding:0,borderRadius:12,border:brd,background:bg,color:clr,fontWeight:600,fontSize:14,cursor:blocked?"not-allowed":"pointer",opacity:blocked?0.5:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,boxSizing:"border-box",boxShadow:"0 1px 4px rgba(0,0,0,0.08), inset 0 1px 1px rgba(255,255,255,0.3)"}},
        RC("span",null,t.id),RC("span",{style:{fontSize:10,fontWeight:500,color:subClr}},label));
    });
    return RC("div",{key:grp.name,style:{marginBottom:16}},
      RC("div",{style:{fontSize:13,fontWeight:700,color:grp.color,marginBottom:2}},grp.name),
      noteEl,
      RC("div",{style:{display:"flex",gap:8,flexWrap:"wrap"}},tableEls));
  });
  return RC("div",null,groupEls);
}

// ── Manual Modal ──────────────────────────────────────────────────────────
function ManualModal(props){
  var booking=props.booking,bookings=props.bookings,onSave=props.onSave,onClose=props.onClose,titleText=props.titleText,blocks=props.blocks||[];
  var ss=useState(booking&&booking.tables?booking.tables.slice():[]);var selected=ss[0],setSelected=ss[1];
  var sbs=useState(false);var swapBusy=sbs[0],setSwapBusy=sbs[1];
  if(!booking) return null;
  var needed=booking.size||2;
  var s=toMins(booking.time||"13:00"),e=s+(booking.duration||90);
  var otherBookings=bookings.filter(function(b){return b&&b.id!==booking.id&&b.date===booking.date&&b.status!=="cancelled"&&(b.tables||[]).length>0;});
  var otherSlots=otherBookings.map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+(b.duration||90),status:b.status,id:b.id,name:b.name};}).concat(getBlockSlots(blocks,booking.date).map(function(sl){return Object.assign({},sl,{status:"blocked",id:"__block__",name:"Blocked"});}));
  var busy=getBusy(otherSlots,s,e);
  var seatedBusy=new Set();otherSlots.forEach(function(sl){if(!overlaps(s,e,sl.s,sl.e)) return;if(sl.status==="seated") sl.tables.forEach(function(id){seatedBusy.add(id);});});
  function getCapOf(ids){if(ids.length===0) return 0;var k=ids.slice().sort().join("|");var c=VALID_COMBOS.find(function(x){return x.ids.slice().sort().join("|")===k;});if(c) return c.cap;var bestCap=0,bestIds=[];VALID_COMBOS.forEach(function(combo){if(combo.ids.length<=ids.length&&combo.ids.every(function(id){return ids.includes(id);})&&combo.cap>bestCap){bestCap=combo.cap;bestIds=combo.ids;}});if(bestIds.length>0){var rem=ids.filter(function(id){return !bestIds.includes(id);});return bestCap+rem.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);}return ids.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);}
  function toggle(id){
    if(selected.includes(id)){setSelected(selected.filter(function(x){return x!==id;}));return;}
    if(busy.has(id)&&!(swapBusy&&!seatedBusy.has(id))) return;
    var next=selected.concat([id]);
    var h1=next.includes("i1"),h4=next.includes("i4"),h2=next.includes("i2"),h3=next.includes("i3");
    if(h1&&h4&&(!h2||!h3)) return;
    if(selected.length>0&&getCapOf(selected)>=needed){
      var trimmed=selected.slice();
      while(trimmed.length>0&&getCapOf(trimmed)>=needed){trimmed=trimmed.slice(1);}
      next=trimmed.concat([id]);
      h1=next.includes("i1");h4=next.includes("i4");h2=next.includes("i2");h3=next.includes("i3");
      if(h1&&h4&&(!h2||!h3)) return;
    }
    setSelected(next);
  }
  var affectedBookings=[];
  if(swapBusy&&selected.length>0){
    otherSlots.forEach(function(sl){
      if(!overlaps(s,e,sl.s,sl.e)||sl.status==="seated") return;
      var taken=sl.tables.filter(function(id){return selected.includes(id);});
      if(taken.length>0) affectedBookings.push({name:sl.name,id:sl.id,tables:taken});
    });
  }
  var cap=getCapOf(selected);
  var slotsForConflict=otherSlots.filter(function(sl){return !swapBusy||sl.status==="seated";});
  var conflict=selected.length>=2&&!canAssign(selected,slotsForConflict,s,e);
  var ok=selected.length>0&&cap>=needed&&!conflict;
  var summaryColor=conflict?"#991b1b":ok?"#166534":"#9a3412";
  var summaryText=selected.length===0?"Select tables below.":conflict?"Conflict: cannot use these tables together.":"Capacity: "+cap+(cap>=needed?" (fits "+needed+" pax)":" — need "+needed+" pax");
  var clearBtn=selected.length>0?RC("button",{key:"clr",style:mkBtn({fontSize:12,padding:"6px 12px",background:BTN.clear}),onClick:function(){setSelected([]);}},"Clear"):null;
  var isSwapping=affectedBookings.length>0;
  var assignLabel=isSwapping?"Swap & Assign":"Assign";
  var affectedEl=isSwapping?RC("div",{style:{marginTop:8,padding:"10px 14px",borderRadius:14,background:"rgba(255,237,213,0.65)",border:"2px solid rgba(253,186,116,0.55)"}},
    RC("div",{style:{fontSize:13,fontWeight:700,color:"#9a3412",marginBottom:4}},"Will reassign:"),
    affectedBookings.map(function(ab){return RC("div",{key:ab.id,style:{fontSize:12,color:"#9a3412"}},ab.name+" — losing table "+(ab.tables.join(", ")));})):null;
  var swapBg=swapBusy?"rgba(255,237,213,0.6)":S.bg;
  var swapBrd="2px solid "+(swapBusy?"rgba(253,186,116,0.6)":"rgba(255,255,255,0.5)");
  var swapTitleClr=swapBusy?"#9a3412":S.text;
  var swapSubClr=swapBusy?"#c2410c":S.text;
  // v14 preview 3: Internal keyboard shortcuts scoped to this modal.
  //   S     → toggle Swap busy (same effect as clicking the Toggle)
  //   C     → clear selected tables (same as the Clear button)
  //   Enter → primary action (Assign / Swap & Assign) if selection is valid
  // S/C are suppressed when focus is on an input/textarea/select so the user
  // can still type normally. Modifier keys (Ctrl/Meta/Alt) always pass through
  // so browser / OS shortcuts keep working.
  useEffect(function(){
    function isTyping(el){if(!el) return false;var t=el.tagName;return t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||el.isContentEditable;}
    function handler(ev){
      if(ev.ctrlKey||ev.metaKey||ev.altKey) return;
      var k=ev.key;
      if(k==="Enter"){
        if(isTyping(ev.target)&&ev.target.tagName==="TEXTAREA") return;
        if(ok){ev.preventDefault();onSave(selected,true,isSwapping?affectedBookings:null);}
        return;
      }
      if(isTyping(ev.target)) return;
      if(k==="s"||k==="S"){ev.preventDefault();var next=!swapBusy;if(next) setSelected([]);setSwapBusy(next);return;}
      if(k==="c"||k==="C"){ev.preventDefault();setSelected([]);return;}
    }
    window.addEventListener("keydown",handler);
    return function(){window.removeEventListener("keydown",handler);};
  },[swapBusy,selected,ok,isSwapping,affectedBookings,onSave]);
  return RC(Overlay,{onClose:onClose},
    RC("div",{style:{textAlign:"center",marginBottom:4}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"rgba(0,122,255,0.75)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},titleText||"Manual table assignment")),
    RC("div",{style:{fontSize:13,color:S.text,marginBottom:4,marginTop:6,textAlign:"center"}},booking.name+" · "+booking.size+" pax · "+booking.time+"–"+toTime(e)),
    RC("div",{style:{marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:14,background:swapBg,border:swapBrd,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
      RC("div",null,RC("div",{style:{fontSize:13,fontWeight:700,color:swapTitleClr}},"Swap busy"),RC("div",{style:{fontSize:11,color:swapSubClr,marginTop:2}},"Reassign confirmed bookings to other tables (not seated)")),
      RC(Toggle,{on:swapBusy,onClick:function(){var next=!swapBusy;if(next) setSelected([]);setSwapBusy(next);}})),
    RC("div",{style:{fontSize:13,color:S.text,marginBottom:14}},"Tap tables to select / deselect."),
    RC("div",{style:{marginBottom:14,padding:"12px 14px",borderRadius:14,background:"rgba(255,255,255,0.35)",border:"2px solid "+(conflict?"rgba(252,165,165,0.6)":ok?"rgba(134,239,172,0.6)":"rgba(255,255,255,0.5)"),display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
      RC("div",null,
        RC("div",{style:{fontSize:14,fontWeight:700,color:S.text}},"Selected: "+(selected.length?selected.join(" + "):"none")),
        RC("div",{style:{fontSize:13,color:summaryColor,fontWeight:500,marginTop:2}},summaryText)),
      clearBtn),
    affectedEl,
    RC(TableGrid,{selected:selected,toggle:toggle,busy:busy,seatedBusy:seatedBusy,swapBusy:swapBusy}),
    RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}},
      RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:onClose},"Cancel"),
      RC("button",{disabled:!ok,onClick:function(){if(ok)onSave(selected,true,isSwapping?affectedBookings:null);},style:{background:ok?(isSwapping?BTN.orange:S.accent):"rgba(180,180,190,0.4)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 20px",cursor:ok?"pointer":"not-allowed",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:ok?"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)":"none"}},assignLabel)));
}

// ── Block Modal ──────────────────────────────────────────────────────────
function BlockModal(props){
  var tableId=props.tableId,date=props.date,blocks=props.blocks||[],onSave=props.onSave,onRemove=props.onRemove,onClose=props.onClose;
  if(!tableId) return null;
  var existing=blocks.filter(function(bl){return bl.tableId===tableId&&bl.date===date;});
  var indoor=isIn(tableId);var tc=indoor?TBL.ind:TBL.out;
  var ms=useState(existing.length>0?"view":"add");var mode=ms[0],setMode=ms[1];
  var frs=useState(OPEN+":00");var from=frs[0],setFrom=frs[1];
  var tos=useState(GRID_CLOSE+":00");var to=tos[0],setTo=tos[1];
  function handleSave(){
    if(!from||!to||toMins(to)<=toMins(from)) return;
    onSave({tableId:tableId,date:date,allDay:false,from:from,to:to});
  }
  var viewEls=existing.map(function(bl,i){
    var label=bl.allDay?OPEN+":00 – "+GRID_CLOSE+":00":bl.from+" – "+bl.to;
    return RC("div",{key:i,style:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:14,background:"rgba(254,226,226,0.65)",border:"2px solid rgba(252,165,165,0.55)",marginBottom:8}},
      RC("div",null,RC("div",{style:{fontSize:14,fontWeight:700,color:"#991b1b"}},"Blocked"),RC("div",{style:{fontSize:13,color:"#991b1b"}},label)),
      RC("button",{onClick:function(){onRemove(bl);},style:mkBtn({background:BTN.del,fontSize:12})},"Unblock"));
  });
  if(mode==="view"&&existing.length>0){
    return RC(Overlay,{onClose:onClose},
      RC("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:16}},
        RC("span",{style:{fontSize:12,fontWeight:700,padding:"4px 10px",borderRadius:8,background:tc.bg,color:tc.text,border:"1px solid "+tc.border}},tableId),
        RC("span",{style:{fontSize:17,fontWeight:700,color:S.text}},"Table "+tableId+" — "+date)),
      viewEls,
      RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}},
        RC("button",{style:mkBtn({minHeight:40,padding:"8px 16px",background:"#64748b"}),onClick:function(){setMode("add");}},"+ Add block"),
        RC("button",{style:mkBtn({minHeight:40,padding:"8px 16px",background:BTN.cancel}),onClick:onClose},"Close")));
  }
  return RC(Overlay,{onClose:onClose},
    RC("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:4}},
      RC("span",{style:{fontSize:12,fontWeight:700,padding:"4px 10px",borderRadius:8,background:tc.bg,color:tc.text,border:"1px solid "+tc.border}},tableId),
      RC("span",{style:{fontSize:17,fontWeight:700,color:S.text}},"Block table "+tableId)),
    RC("div",{style:{fontSize:13,color:S.muted,marginBottom:16}},date),
    RC(Section,null,
      RC("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}},
        RC(Fld,{label:"From"},RC("input",{type:"time",value:from,onChange:function(e){setFrom(e.target.value);},min:OPEN+":00",max:GRID_CLOSE+":00",style:mkInp()})),
        RC(Fld,{label:"To"},RC("input",{type:"time",value:to,onChange:function(e){setTo(e.target.value);},min:OPEN+":00",max:GRID_CLOSE+":00",style:mkInp()})))),
    RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,marginTop:18}},
      RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:onClose},"Cancel"),
      RC("button",{onClick:handleSave,style:{background:"rgba(153,27,27,0.85)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 22px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Block")));
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function TimelineView(props){
  var bookings=props.bookings,date=props.date,onEdit=props.onEdit,onManual=props.onManual,onStatus=props.onStatus,blocks=props.blocks||[],onBlock=props.onBlock,nowMins=props.nowMins||0,warnings=props.warnings||{};
  var zoom=props.zoom||1,setZoom=props.setZoom;
  var followNow=props.followNow,setFollowNow=props.setFollowNow;
  var scrollPosRef=props.scrollPosRef;
  var autoOptimizer=props.autoOptimizer!==false;
  var setAutoOptimizer=props.setAutoOptimizer||function(){};
  var onReshuffle=props.onReshuffle||function(){};
  var onOpenSettings=props.onOpenSettings||function(){};
  var scrollRef=useRef(null);
  var qss=useState(null);var quickStatus=qss[0],setQuickStatus=qss[1];
  var isToday=date===new Date().toISOString().slice(0,10);
  var totalMins=(GRID_CLOSE-OPEN)*60;
  var gridW=Math.max(320,totalMins*zoom*1.2);
  useEffect(function(){
    if(!scrollRef.current) return;
    if(followNow&&isToday&&nowMins>=OPEN*60&&nowMins<=GRID_CLOSE*60){
      var targetMins=Math.max(OPEN*60,nowMins-30);
      var scrollPos=((targetMins-OPEN*60)/totalMins)*gridW;
      scrollRef.current.scrollLeft=scrollPos;
      if(scrollPosRef) scrollPosRef.current=scrollPos;
    } else if(scrollPosRef&&scrollPosRef.current>0){
      scrollRef.current.scrollLeft=scrollPosRef.current;
    }
  },[followNow,isToday,nowMins,gridW]);
  function onGridScroll(){
    if(scrollRef.current&&scrollPosRef){scrollPosRef.current=scrollRef.current.scrollLeft;}
    if(quickStatus) setQuickStatus(null);
  }
  var day=bookings.filter(function(b){return b.date===date&&b.status!=="cancelled";});
  var dayBlocks=blocks.filter(function(bl){return bl.date===date;});
  var unassigned=day.filter(function(b){return b.status!=="completed"&&(!(b.tables||[]).length||b._conflict);});
  function pct(mins){return ((mins-OPEN*60)/totalMins)*100+"%";}
  function GridLines(){
    var lines=QUARTER_HOURS.map(function(m){var isH=m%60===0;return RC("div",{key:m,style:{position:"absolute",top:0,bottom:0,left:pct(m),borderLeft:isH?"2px solid rgba(120,130,155,0.45)":"0.5px solid rgba(140,150,175,0.3)",opacity:1}});});
    lines.push(RC("div",{key:"end",style:{position:"absolute",top:0,bottom:0,right:0,borderLeft:"2px solid rgba(120,130,155,0.45)"}}));
    return RC("div",{style:{position:"absolute",inset:0}},lines);
  }
  function liveDur(b){if(b.status==="seated"){var elapsed=nowMins-toMins(b.time);return Math.max(15,elapsed);}return b.duration;}
  function Block(bp){
    var b=bp.b;var d=liveDur(b);var sm=toMins(b.time)-OPEN*60;var left=pct(OPEN*60+sm);var w=Math.max((d/totalMins)*100,0.5)+"%";
    var warn=warnings[b.id];var bgc=BLOCK_BG[b.status]||BLOCK_BG.confirmed;
    var border=warn?(warn.overdue?"3px solid #dc2626":"3px solid #f59e0b"):"none";
    var hasPrefT=b.preferredTables&&b.preferredTables.length>0;
    var lbl=b.name+" ("+b.size+")"+(isLocked(b)?" [L]":"")+(hasPrefT?" ★":"")+(warn&&warn.overdue?" !!":"");
    var pressTimer=useRef(null);var didLong=useRef(false);var touchStartPos=useRef(null);var blockEl=useRef(null);
    function onTouchStart(e){
      didLong.current=false;
      var t=e.touches[0];touchStartPos.current={x:t.clientX,y:t.clientY};
      var el=e.currentTarget;
      pressTimer.current=setTimeout(function(){didLong.current=true;var rect=el.getBoundingClientRect();setQuickStatus({booking:b,x:rect.left,y:rect.top,w:rect.width,h:rect.height});},400);
    }
    function onTouchMove(e){
      if(!touchStartPos.current) return;
      var t=e.touches[0];var dx=Math.abs(t.clientX-touchStartPos.current.x);var dy=Math.abs(t.clientY-touchStartPos.current.y);
      if(dx>8||dy>8){clearTimeout(pressTimer.current);pressTimer.current=null;}
    }
    function onTouchEnd(e){clearTimeout(pressTimer.current);pressTimer.current=null;if(didLong.current){e.preventDefault();}}
    function onCtx(e){e.preventDefault();}
    function handleClick(){if(didLong.current) return;onEdit(b);}
    return RC("div",{onClick:handleClick,onTouchStart:onTouchStart,onTouchMove:onTouchMove,onTouchEnd:onTouchEnd,onContextMenu:onCtx,style:{position:"absolute",top:3,height:ROW_H-8+"px",left:left,width:w,background:bgc,borderRadius:10,overflow:"hidden",display:"flex",alignItems:"center",boxSizing:"border-box",cursor:"pointer",border:border||"1px solid rgba(255,255,255,0.2)",WebkitTouchCallout:"none",WebkitUserSelect:"none",userSelect:"none",boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},
      RC("span",{style:{flex:1,padding:"0 8px",fontSize:11,fontWeight:700,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}},lbl),
      RC("span",{onClick:function(e){e.stopPropagation();onManual(b.id);},style:{padding:"0 6px",fontSize:13,cursor:"pointer",color:"rgba(255,255,255,0.7)",borderLeft:"1px solid rgba(255,255,255,0.3)",height:"100%",display:"flex",alignItems:"center",minWidth:28}},"="));
  }
  function BlockBar(bp){
    var bl=bp.bl;
    var bS=bl.allDay?OPEN*60:toMins(bl.from);var bE=bl.allDay?GRID_CLOSE*60:toMins(bl.to);
    var left=pct(bS);var w=Math.max(((bE-bS)/totalMins)*100,0.5)+"%";
    return RC("div",{style:{position:"absolute",top:1,height:ROW_H-4+"px",left:left,width:w,background:"repeating-linear-gradient(45deg,#991b1b,#991b1b 4px,#7f1d1d 4px,#7f1d1d 8px)",borderRadius:4,opacity:0.6,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}},
      RC("span",{style:{fontSize:9,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:1}},"blocked"));
  }
  var headerLines=QUARTER_HOURS.concat([GRID_CLOSE*60]).map(function(m){var isH=m%60===0;return RC("div",{key:"l"+m,style:{position:"absolute",top:0,left:pct(m),bottom:0,borderLeft:isH?"2px solid rgba(120,130,155,0.45)":"0.5px solid rgba(140,150,175,0.3)"}});});
  var headerLabels=QUARTER_HOURS.filter(function(m){return m%60===0&&m<GRID_CLOSE*60;}).map(function(m){var center=((m+30-OPEN*60)/totalMins)*100;return RC("span",{key:"h"+m,style:{position:"absolute",top:3,left:center+"%",transform:"translateX(-50%)",fontSize:10,fontWeight:600,color:"#fff",whiteSpace:"nowrap",pointerEvents:"none",background:"rgba(90,100,120,0.9)",padding:"2px 5px",borderRadius:6,zIndex:1,boxShadow:"0 1px 3px rgba(0,0,0,0.1)"}},String(Math.floor(m/60)).padStart(2,"0")+":00");});
  // Labels column
  var labelCol=RC("div",{style:{width:LABEL_W+"px",flexShrink:0}},
    RC("div",{style:{height:24,background:"rgba(220,225,235,0.45)",borderRadius:"6px 0 0 0",borderBottom:"2px solid rgba(180,190,210,0.3)",boxSizing:"border-box"}}),
    TIMELINE_TABLES.map(function(tbl){var id=tbl.id,indoor=isIn(id);var hasBlock=dayBlocks.some(function(bl){return bl.tableId===id;});
      return RC("div",{key:id,onClick:function(){if(onBlock) onBlock(id);},style:{height:ROW_H+"px",display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:6,borderBottom:"2px solid rgba(180,190,210,0.2)",cursor:"pointer",boxSizing:"border-box"}},
        RC("span",{style:{fontSize:11,fontWeight:600,padding:"3px 0",borderRadius:8,background:hasBlock?"rgba(153,27,27,0.85)":indoor?TBL.ind.bg:TBL.out.bg,color:hasBlock?"#fff":indoor?TBL.ind.text:TBL.out.text,border:"1px solid "+(hasBlock?"rgba(153,27,27,0.5)":indoor?TBL.ind.border:TBL.out.border),width:32,textAlign:"center",display:"inline-block",boxSizing:"border-box",boxShadow:"0 1px 3px rgba(0,0,0,0.1)"}},id));}),
    unassigned.length>0?RC("div",{style:{height:ROW_H+"px",display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:6,borderTop:"1px dashed rgba(220,60,60,0.4)",marginTop:4,boxSizing:"border-box"}},RC("span",{style:{fontSize:10,fontWeight:600,color:"#991b1b"}},"unassigned")):null);
  // Grid column (scrollable)
  var gridRows=TIMELINE_TABLES.map(function(tbl){var id=tbl.id;var rows=day.filter(function(b){return (b.tables||[]).includes(id);});var tblBlocks=dayBlocks.filter(function(bl){return bl.tableId===id;});
    return RC("div",{key:id,style:{height:ROW_H+"px",position:"relative",borderBottom:"2px solid rgba(180,190,210,0.2)",boxSizing:"border-box"}},RC(GridLines,null),tblBlocks.map(function(bl,i){return RC(BlockBar,{key:"blk"+i,bl:bl});}),rows.filter(function(b){return b.status==="seated";}).map(function(b){var origD=b.originalDuration||b.duration;var sm=toMins(b.time)-OPEN*60;var gLeft=pct(OPEN*60+sm);var gW=Math.max((origD/totalMins)*100,0.5)+"%";return RC("div",{key:"ghost_"+b.id,style:{position:"absolute",top:3,height:(ROW_H-8)+"px",left:gLeft,width:gW,background:"transparent",borderRadius:10,border:"2px dashed "+BLOCK_BG.seated,boxSizing:"border-box",pointerEvents:"none"}});}),rows.map(function(b){return RC(Block,{key:b.id,b:b});}));});
  var unassignedGrid=unassigned.length>0?RC("div",{style:{height:ROW_H+"px",position:"relative",borderTop:"1px dashed rgba(220,60,60,0.4)",marginTop:4,boxSizing:"border-box"}},RC(GridLines,null),unassigned.map(function(b){return RC(Block,{key:b.id,b:b});})):null;
  // Now line (today only)
  var nowInRange=isToday&&nowMins>=OPEN*60&&nowMins<=GRID_CLOSE*60;
  var nowLine=nowInRange?RC("div",{key:"now",style:{position:"absolute",top:0,bottom:0,left:pct(nowMins),zIndex:10,pointerEvents:"none"}},
    RC("div",{style:{position:"absolute",top:3,left:"50%",transform:"translateX(-50%)",fontSize:10,fontWeight:600,color:"#fff",background:"rgba(0,0,0,0.9)",padding:"2px 5px",borderRadius:6,whiteSpace:"nowrap",zIndex:11,boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}},toTime(nowMins)),
    RC("div",{style:{position:"absolute",top:11,bottom:0,left:"50%",transform:"translateX(-50%)",width:2,background:"rgba(0,0,0,0.6)"}})):null;
  var gridCol=RC("div",{ref:scrollRef,onScroll:onGridScroll,style:{flex:1,overflowX:"auto",overflowY:"hidden"}},
    RC("div",{style:{width:gridW+"px",minWidth:"100%",position:"relative"}},
      RC("div",{style:{position:"relative",borderBottom:"2px solid rgba(180,190,210,0.3)",background:"rgba(220,225,235,0.45)",borderRadius:"0 6px 0 0",height:24,overflow:"visible",boxSizing:"border-box"}},headerLines,headerLabels),
      gridRows,
      unassignedGrid,
      nowLine));
  var followBtn=isToday?RC("button",{onClick:function(){if(!followNow){setFollowNow(true);if(zoom<4) setZoom(4);}else{setFollowNow(false);}},style:mkBtn({minHeight:32,padding:"4px 10px",fontSize:11,background:followNow?"rgba(0,0,0,0.6)":"rgba(120,130,150,0.5)"})},followNow?"Follow":"Follow"):null;
  var zoomBtns=RC("div",{style:{display:"flex",gap:4,alignItems:"center"}},
    followBtn,
    RC("button",{onClick:function(){setZoom(function(z){return Math.max(1,z-0.5);});},style:mkBtn({minHeight:32,minWidth:32,padding:"4px 10px",fontSize:16,background:BTN.nav})},"-"),
    RC("button",{onClick:function(){setZoom(1);setFollowNow(false);},style:mkBtn({minHeight:32,padding:"4px 10px",fontSize:11,background:zoom===1?"#64748b":BTN.nav})},zoom===1?"1x":zoom+"x → 1x"),
    RC("button",{onClick:function(){setZoom(function(z){return Math.min(5,z+0.5);});},style:mkBtn({minHeight:32,minWidth:32,padding:"4px 10px",fontSize:16,background:BTN.nav})},"+"));
  // Optimizer toggle + Reshuffle (today only)
  var optBtns=isToday?RC("div",{style:{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}},
    RC("button",{onClick:function(){setAutoOptimizer(!autoOptimizer);},style:mkBtn({minHeight:32,padding:"4px 12px",fontSize:11,background:autoOptimizer?"rgba(22,101,52,0.75)":"rgba(120,130,150,0.55)"})},"Optimizer: "+(autoOptimizer?"ON":"OFF")),
    !autoOptimizer?RC("button",{onClick:onReshuffle,style:mkBtn({minHeight:32,padding:"4px 12px",fontSize:11,background:BTN.orange})},"Reshuffle"):null):null;
  var legendEls=Object.keys(STATUS_COLORS).map(function(s){return RC("span",{key:s,style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:BLOCK_BG[s]||"#999",color:"#fff",border:"1px solid rgba(255,255,255,0.2)",fontWeight:600,textTransform:"capitalize",boxShadow:"0 1px 3px rgba(0,0,0,0.08)"}},s);});
  legendEls.push(RC("span",{key:"in",style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:TBL.ind.bg,color:"#fff",border:"1px solid rgba(255,255,255,0.2)",fontWeight:600}},"indoor"));
  legendEls.push(RC("span",{key:"out",style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:TBL.out.bg,color:"#fff",border:"1px solid rgba(255,255,255,0.2)",fontWeight:600}},"outdoor"));
  legendEls.push(RC("span",{key:"blocked",style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:"rgba(153,27,27,0.85)",color:"#fff",border:"1px solid rgba(255,255,255,0.2)",fontWeight:600}},"blocked"));
  var quickPopup=quickStatus?RC("div",{onClick:function(){setQuickStatus(null);},style:{position:"fixed",inset:0,zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.18)"}},
    RC("div",{onClick:function(e){e.stopPropagation();},style:{background:"#eef1f7",borderRadius:20,border:"1px solid "+S.border,boxShadow:"0 8px 32px rgba(0,0,0,0.14)",padding:"20px 24px",minWidth:240,maxWidth:320,zIndex:301}},
      RC("div",{style:{fontSize:20,fontWeight:700,color:S.text,marginBottom:16}},quickStatus.booking.name),
      RC("div",{style:{display:"flex",gap:10,flexWrap:"wrap"}},
        ["confirmed","seated","completed","cancelled"].filter(function(st){return st!==quickStatus.booking.status;}).map(function(st){return RC("button",{key:st,style:{background:BLOCK_BG[st],border:"none",borderRadius:12,padding:"10px 18px",fontSize:14,fontWeight:700,color:"#fff",cursor:"pointer",textTransform:"capitalize",minHeight:44,flex:"1 1 auto"},onClick:function(){onStatus(quickStatus.booking.id,st);setQuickStatus(null);}},st);})))):null;
  return RC("div",{style:{background:"rgba(255,255,255,0.4)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderRadius:20,border:"1px solid rgba(255,255,255,0.45)",padding:"10px 12px",boxShadow:"0 2px 16px rgba(0,0,0,0.06), inset 0 1px 1px rgba(255,255,255,0.6)"}},
    RC("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:8,flexWrap:"wrap"}},
      optBtns||RC("div",null),
      zoomBtns),
    RC("div",{style:{display:"flex"}},labelCol,gridCol),
    RC("div",{style:{marginTop:10,display:"flex",gap:8,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}},
      RC("div",{style:{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",flex:"1 1 auto",minWidth:0}},legendEls),
      RC("button",{onClick:onOpenSettings,title:"Settings & keyboard shortcuts",style:{background:"rgba(120,130,150,0.4)",border:"1px solid rgba(255,255,255,0.45)",borderRadius:10,width:34,height:34,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,padding:0,color:S.text,boxShadow:"0 1px 3px rgba(0,0,0,0.08), inset 0 1px 1px rgba(255,255,255,0.4)"}},RC(CogIcon,null))),
    RC("div",{style:{marginTop:6,fontSize:11,color:S.muted}},"tap booking to edit  ·  = assign  ·  hold to change status  ·  tap table label to block"),
    quickPopup);
}

// ── List View ─────────────────────────────────────────────────────────────────
function ListView(props){
  var bookings=props.bookings,date=props.date,onEdit=props.onEdit,onStatus=props.onStatus,onDelete=props.onDelete,onManual=props.onManual,nowMins=props.nowMins||0,warnings=props.warnings||{};
  function statusOrder(s){return s==="seated"?0:s==="confirmed"?1:s==="completed"?2:3;}
  var day=bookings.filter(function(b){return b.date===date;}).sort(function(a,b){var sa=statusOrder(a.status),sb=statusOrder(b.status);if(sa!==sb) return sa-sb;return a.time.localeCompare(b.time);});
  if(!day.length) return RC("div",{style:{textAlign:"center",padding:"48px 0",color:S.text,fontSize:15}},"No bookings for this date.");
  return RC("div",{style:{display:"flex",flexDirection:"column",gap:10}},day.map(function(b){
    // v14 p1 (Issue 2 fix): end-time label is pinned to the scheduled plan
    // (time + duration) while the guest is within plan; once they overstay,
    // syncLiveDurations bumps b.duration to elapsed and the label starts
    // tracking live time from that moment on.
    // v14 p1 follow-up: the duration TAG is separate from end-time — it shows
    // actual minutes since seating (live, min 15) so staff can see how long
    // the party has been at the table regardless of the planned end.
    var elapsedMin=b.status==="seated"?Math.max(15,nowMins-toMins(b.time)):0;
    var liveDur=b.status==="seated"?Math.max(elapsedMin,b.duration||90):b.duration;
    var end=toTime(toMins(b.time)+liveDur);
    var durationTag=b.status==="seated"?RC(SmallTag,{label:elapsedMin+" min",style:{background:"#166534",color:"#fff",border:"none"}}):null;
    var warn=warnings[b.id];
    var warnEl=warn?RC("div",{style:{fontSize:13,fontWeight:700,marginBottom:8,padding:"6px 10px",borderRadius:12,background:warn.overdue?"rgba(254,226,226,0.65)":"rgba(255,237,213,0.65)",color:warn.overdue?"#991b1b":"#9a3412",border:"2px solid "+(warn.overdue?"rgba(252,165,165,0.55)":"rgba(253,186,116,0.55)")}},warn.overdue?"Overdue — next booking ("+warn.next+") at "+warn.nextTime+" is waiting":"Next booking ("+warn.next+") at "+warn.nextTime+" in "+warn.gap+" min"):null;
    var conflictEl=b._conflict&&b.status!=="completed"?RC("div",{style:{fontSize:13,color:"#991b1b",fontWeight:700,marginBottom:8,background:"rgba(254,226,226,0.65)",border:"2px solid rgba(252,165,165,0.55)",borderRadius:12,padding:"6px 10px"}},"No table assigned — use manual assignment."):null;
    var manualTag=b._manual&&!isLocked(b)?RC(SmallTag,{label:"manual",style:{background:"#0369a1",color:"#fff",border:"none"}}):null;
    var lockedTag=b._locked?RC(SmallTag,{label:"locked",style:{background:"#854d0e",color:"#fff",border:"none"}}):null;
    var prefTag=b.preferredTables&&b.preferredTables.length>0?RC(SmallTag,{label:"★ "+b.preferredTables.join("+"),style:{background:"#0d9488",color:"#fff",border:"none"}}):null;
    var notesEl=b.notes?RC("div",{style:{fontSize:13,color:S.text,borderTop:"0.5px solid "+S.border,paddingTop:8,marginTop:8}},b.notes):null;
    var phonEl=b.phone?RC("span",{style:{fontSize:13,color:S.text,marginLeft:4}},b.phone):null;
    var statusBtns=["confirmed","seated","completed","cancelled"].filter(function(s){return s!==b.status;}).map(function(s){return RC("button",{key:s,style:mkBtn({background:BLOCK_BG[s],textTransform:"capitalize"}),onClick:function(){onStatus(b.id,s);}},"> "+s);});
    var sc=STATUS_COLORS[b.status];
    var useStatusColor=b.status==="seated"||b.status==="completed"||b.status==="cancelled";
    var cardBg=useStatusColor?"rgba(255,255,255,0.35)":"rgba(255,255,255,0.45)";
    var cardBrd=warn?(warn.overdue?"rgba(220,60,60,0.5)":"rgba(245,158,11,0.5)"):b._conflict?"rgba(252,165,165,0.5)":useStatusColor?sc.border:"rgba(255,255,255,0.4)";
    var cardBrdW=warn?"3px":useStatusColor?"3px":"1px";
    return RC("div",{key:b.id,style:{background:cardBg,border:cardBrdW+" solid "+cardBrd,borderRadius:16,padding:"14px 16px",opacity:b.status==="completed"||b.status==="cancelled"?0.75:1,boxShadow:"0 2px 12px rgba(0,0,0,0.06), inset 0 1px 1px rgba(255,255,255,0.5)"}},
      conflictEl,
      warnEl,
      RC("div",{style:{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8}},
        RC("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}},
          RC("span",{style:{fontWeight:700,fontSize:16,color:S.text}},b.name),
          RC(SBadge,{status:b.status}),
          RC("span",{style:{fontSize:13,color:S.text,fontWeight:700}},b.size+" pax"),
          manualTag,lockedTag,prefTag,durationTag),
        RC("span",{style:{fontSize:14,fontWeight:700,color:S.text}},b.time+"–"+end)),
      RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginTop:8}},(b.tables||[]).map(function(t){return RC(TBadge,{key:t,id:t});}),phonEl),
      notesEl,
      RC("div",{style:{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}},
        RC("button",{style:mkBtn({background:BTN.tables}),onClick:function(){onManual(b.id);}},"= Tables"),
        RC("button",{style:mkBtn({background:BTN.edit}),onClick:function(){onEdit(b);}},"Edit"),
        RC("button",{style:mkBtn({background:BTN.del}),onClick:function(){onDelete(b.id);}},"Delete"),
        statusBtns));
  }));
}

// ── Booking App ───────────────────────────────────────────────────────────────
function BookingApp(){
  var bs=useState([]);var bookings=bs[0],setBookings=bs[1];
  var tbs=useState([]);var tableBlocks=tbs[0],setTableBlocks=tbs[1];
  // ── Firebase write-guard system ─────────────────────────────────────────────
  // These refs track whether we've received AT LEAST ONE onValue callback from
  // Firebase for each path. Until that's happened, React state is [] / {}
  // regardless of what's in Firebase — writing that empty state would wipe
  // real data. Save helpers REFUSE to write until their respective
  // dataLoaded ref is true. This is the critical safety net added after the
  // v13 first-deploy incident where empty in-memory state was persisted to
  // Firebase before the read listener had fired.
  var bookingsLoaded=useRef(false);
  var blocksLoaded=useRef(false);
  // v14 p7 deployment: same write-guard pattern applied to reminder data.
  var remindersLoaded=useRef(false);
  var reminderFiresLoaded=useRef(false);
  var ws=useState(null);var writeWarning=ws[0],setWriteWarning=ws[1];
  var lbs=useState(false);var loadBannerShown=lbs[0],setLoadBannerShown=lbs[1];
  var firstLoadCount=useRef(null); // number of bookings on first successful load
  // v14.1: Connection-status state. isOnline drives the amber offline banner;
  // reconnectShown is a brief 4-second blue flash after offline→online.
  // hasConnectedRef gates BOTH banners so we never show "offline" before
  // the very first successful Firebase connection (avoids a false flash on boot).
  var ots=useState(true);var isOnline=ots[0],setIsOnline=ots[1];
  var rrs=useState(false);var reconnectShown=rrs[0],setReconnectShown=rrs[1];
  var hasConnectedRef=useRef(false);
  // Ensure optimal viewport scaling on all devices
  useEffect(function(){
    var meta=document.querySelector('meta[name="viewport"]');
    if(!meta){meta=document.createElement("meta");meta.name="viewport";document.head.appendChild(meta);}
    meta.content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
    document.documentElement.style.cssText="height:100%;overflow:hidden;";
    document.body.style.cssText="height:100%;overflow:auto;margin:0;-webkit-overflow-scrolling:touch;overscroll-behavior:none;";
    return function(){document.documentElement.style.cssText="";document.body.style.cssText="";};
  },[]);
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
      setBookings(function(prev){var computed=next(prev);persist(computed);return computed;});
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
      setTableBlocks(function(prev){var computed=next(prev);persist(computed);return computed;});
    } else {
      setTableBlocks(next);persist(next);
    }
  }
  // Firebase real-time listeners — read only, never write back.
  // The `bookingsLoaded.current=true` line MUST run on every callback, including
  // when val is null (truly empty DB), otherwise saves would stay blocked forever
  // on a brand-new database.
  useEffect(function(){
    var unsub=onValue(ref(db,"bookings"),function(snap){
      var val=snap.val();
      var arr=val?sanitizeAll(val):[];
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
    var unsub=onValue(ref(db,"tableBlocks"),function(snap){
      var val=snap.val();
      if(val){var arr=Array.isArray(val)?val:Object.values(val);setTableBlocks(arr.filter(Boolean));}
      else setTableBlocks([]);
      blocksLoaded.current=true;
    });
    return unsub;
  },[]);
  // Auto-hide the first-load banner after 6 seconds
  useEffect(function(){
    if(!loadBannerShown) return;
    var t=setTimeout(function(){setLoadBannerShown(false);},6000);
    return function(){clearTimeout(t);};
  },[loadBannerShown]);
  // v14.1: Subscribe to Firebase's special .info/connected ref. Drives the
  // offline banner and the reconnected flash. The hasConnectedRef gate makes
  // sure the offline banner never shows before the first successful handshake.
  useEffect(function(){
    var unsub=onValue(ref(db,".info/connected"),function(snap){
      var connected=snap.val()===true;
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

  var vs=useState("timeline");var view=vs[0],setView=vs[1];
  var zms=useState(1);var timelineZoom=zms[0],setTimelineZoom=zms[1];
  var timelineScrollRef=useRef(0);
  var fns=useState(false);var followNow=fns[0],setFollowNow=fns[1];
  var bts=useState(null);var blockTarget=bts[0],setBlockTarget=bts[1];
  var vds=useState(new Date().toISOString().slice(0,10));var viewDate=vds[0],setViewDate=vds[1];
  var sfs=useState(false);var showForm=sfs[0],setShowForm=sfs[1];
  var fms=useState(EMPTY_FORM);var form=fms[0],setForm=fms[1];
  var eis=useState(null);var editId=eis[0],setEditId=eis[1];
  var ers=useState("");var error=ers[0],setError=ers[1];
  var cds=useState(null);var confirmDel=cds[0],setConfirmDel=cds[1];
  var crs=useState(false);var confirmReshuffle=crs[0],setConfirmReshuffle=crs[1];
  var ccs=useState(null);var confirmCancel=ccs[0],setConfirmCancel=ccs[1];
  var rss=useState(false);var reshuffled=rss[0],setReshuffled=rss[1];
  var mts=useState(null);var manualTarget=mts[0],setManualTarget=mts[1];
  var dis=useState(null);var dismissedIneff=dis[0],setDismissedIneff=dis[1];
  var formRef=useRef(EMPTY_FORM);
  var sas=useState(null);var swapAffected=sas[0],setSwapAffected=sas[1];
  var cks=useState(null);var confirmKitchen=cks[0],setConfirmKitchen=cks[1];
  var shs=useState(false);var showHistory=shs[0],setShowHistory=shs[1];
  var pps=useState(false);var showPrefPicker=pps[0],setShowPrefPicker=pps[1];
  // v14 preview 3: Settings / keyboard-shortcuts modal. Toggled by the cog
  // icon in TimelineView's legend row and by the `?` keyboard shortcut.
  var sts=useState(false);var showSettings=sts[0],setShowSettings=sts[1];
  // v14 preview 7: Reminders state.
  //   reminders        — list of staff-set reminders (see reminderAppliesTo).
  //   reminderFires    — map of slot-key → {status, until?, at?} for dismissed
  //                      or snoozed fire slots. Scoped per-day via slot-key.
  //   settingsTab      — which Settings tab is active. Resets to 'general' on
  //                      modal close so reopens start fresh.
  //   reminderEditor   — null = editor closed; {id, draft} = editing/creating.
  //                      Sits on top of Settings (z=250) when open.
  //   setReminderTick  — unused readback; 30s interval bumps this so banners
  //                      re-evaluate even between nowMins minute-boundary
  //                      updates (catches snooze expiry and time-arrivals).
  var rms=useState([]);
  var reminders=rms[0],setReminders=rms[1];
  var rfs=useState({});
  var reminderFires=rfs[0],setReminderFires=rfs[1];
  var stts=useState("general");var settingsTab=stts[0],setSettingsTab=stts[1];
  var res=useState(null);var reminderEditor=res[0],setReminderEditor=res[1];
  // v14 p7 fix: in-app confirmation for reminder deletion — window.confirm is
  // blocked in sandboxed / embedded preview environments, so it never showed
  // the dialog. Matches the confirmDel / confirmCancel pattern used elsewhere.
  var crd=useState(null);var confirmReminderDel=crd[0],setConfirmReminderDel=crd[1];
  var rts30=useState(0);var setReminderTick=rts30[1];
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
      setReminders(function(prev){var c=next(prev);persist(c);return c;});
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
      setReminderFires(function(prev){var c=next(prev);persist(c);return c;});
    } else {setReminderFires(next);persist(next);}
  }
  // Firebase listeners — reminders. Array stored; object-form also tolerated
  // (defensive — matches the tableBlocks pattern).
  useEffect(function(){
    var unsub=onValue(ref(db,"reminders"),function(snap){
      var val=snap.val();
      if(val){
        var arr=Array.isArray(val)?val:Object.values(val);
        setReminders(arr.filter(Boolean));
      } else {
        setReminders([]);
      }
      remindersLoaded.current=true;
    });
    return unsub;
  },[]);
  useEffect(function(){
    var unsub=onValue(ref(db,"reminderFires"),function(snap){
      var val=snap.val();
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
    var today=new Date().toISOString().slice(0,10);
    var pruned=pruneOldReminderFires(reminderFires,today);
    if(Object.keys(pruned).length!==Object.keys(reminderFires||{}).length){
      saveReminderFires(pruned);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[reminderFires]);
  // 30s tick so the banner list re-evaluates between nowMins ticks (which
  // only update on minute boundaries). Without this, a snooze expiring
  // mid-minute could stay hidden for up to 60s longer than intended.
  useEffect(function(){
    var t=setInterval(function(){setReminderTick(function(x){return x+1;});},30000);
    return function(){clearInterval(t);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  // Reminder action handlers.
  function markReminderDone(fireKey){
    saveReminderFires(function(prev){var n=Object.assign({},prev);n[fireKey]={status:"done",at:Date.now()};return n;});
  }
  function snoozeReminderFire(fireKey){
    saveReminderFires(function(prev){var n=Object.assign({},prev);n[fireKey]={status:"snoozed",until:Date.now()+15*60*1000};return n;});
  }
  function openNewReminder(){
    var today=new Date().toISOString().slice(0,10);
    setReminderEditor({id:"new",draft:{text:"",times:["21:00"],recurrence:{type:"once",date:today,days:[]},active:true}});
  }
  function openEditReminder(r){
    // Deep-clone to prevent live-editing the stored reminder.
    var draft={
      text:r.text,
      times:(r.times||[]).slice(),
      recurrence:Object.assign({},r.recurrence||{},{days:(r.recurrence&&r.recurrence.days||[]).slice()}),
      active:!!r.active
    };
    setReminderEditor({id:r.id,draft:draft});
  }
  function saveReminderFromEditor(){
    if(!reminderEditor) return;
    var d=reminderEditor.draft;
    if(validateReminderDraft(d)) return; // UI button is disabled; guard here too.
    // Normalize: dedupe times, sort ascending, trim text.
    var uniqTimes=Array.from(new Set(d.times));uniqTimes.sort();
    var cleanDraft=Object.assign({},d,{times:uniqTimes,text:d.text.trim()});
    var id=reminderEditor.id;
    if(id==="new"){
      var newR=Object.assign({id:genId(),createdAt:Date.now()},cleanDraft);
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
  useEffect(function(){formRef.current=form;},[form]);
  useEffect(function(){if(error) setError("");},[form.time,form.size,form.date,form.preference,form.customDur]);
  // Real-time clock for seated duration
  var nms=useState(function(){var d=new Date();return d.getHours()*60+d.getMinutes();});var nowMins=nms[0],setNowMins=nms[1];
  useEffect(function(){var t=setInterval(function(){var d=new Date();setNowMins(d.getHours()*60+d.getMinutes());},15000);return function(){clearInterval(t);};},[]);
  // Optimizer auto-off at 15:00 for today's shift
  var aos=useState(function(){var d=new Date();return d.getHours()*60+d.getMinutes()<15*60;});
  var autoOptimizer=aos[0],setAutoOptimizer=aos[1];
  var autoFlippedRef=useRef(null);
  useEffect(function(){
    if(nowMins<15*60) return;
    var today=new Date().toISOString().slice(0,10);
    if(autoFlippedRef.current===today) return;
    autoFlippedRef.current=today;
    setAutoOptimizer(false);
  },[nowMins]);
  // Optimizer auto-on at new day start (before 15:00). Day transitions detected via
  // date-string key, so this fires at ~00:00 when the new day begins — or at app
  // mount if we start before 15:00. No reshuffle on flip.
  var autoOnRef=useRef(null);
  useEffect(function(){
    if(nowMins>=15*60) return;
    var today=new Date().toISOString().slice(0,10);
    if(autoOnRef.current===today) return;
    autoOnRef.current=today;
    setAutoOptimizer(true);
  },[nowMins]);
  // Auto-extend seated bookings that exceed their stored duration.
  // IMPORTANT: computes the update in a pure pass first and only calls saveBookings
  // if something actually needs to change. This prevents a spurious write attempt
  // on first mount (when onValue may not have returned yet, the write-guard would
  // fire even though no real change is being made).
  var lastExtend=useRef("");
  useEffect(function(){
    if(!bookingsLoaded.current) return; // no work to do until initial read lands
    var today=new Date().toISOString().slice(0,10);
    var needsUpdate=false;
    var updated=bookings.map(function(b){
      if(b.date!==today||b.status!=="seated") return b;
      var elapsed=nowMins-toMins(b.time);
      if(elapsed>b.duration){needsUpdate=true;return Object.assign({},b,{duration:elapsed,customDur:elapsed});}
      return b;
    });
    if(!needsUpdate) return;
    var seated=bookings.filter(function(b){return b.date===today&&b.status==="seated";});
    var key=seated.map(function(b){return b.id+":"+nowMins;}).join(",");
    if(key===lastExtend.current) return;
    lastExtend.current=key;
    saveBookings(bookingsAfterAction(updated,today,tableBlocks,null,false,autoOptimizer),true); // silent — non-interactive auto-extend
  },[nowMins,tableBlocks,autoOptimizer,bookings]);
  // Derived: bookings with seated-today durations synced to live time.
  // Used by form/walk-in availability checks so they match what bookingsAfterAction
  // will see on save.
  var liveBookings=(function(){
    var today=new Date().toISOString().slice(0,10);
    return syncLiveDurations(bookings,today,nowMins);
  })();
  var winW=useWinW();
  var isMobile=winW<600;
  // v14 deployment fix: history entries must attribute to the logged-in user
  // (their email), not the generic "staff" stub used in standalone preview.
  // "staff" remains as a fallback for the rare case where auth.currentUser
  // is unavailable at the moment of the write.
  function getUser(){return (auth.currentUser&&auth.currentUser.email)||"staff";}

  var dayCount=bookings.filter(function(b){return b.date===viewDate&&b.status!=="cancelled";}).length;
  var inefficient=bookings.length>0&&checkInefficent(bookings,viewDate);

  // Overlap warnings: seated bookings whose live end is within 15 min of next booking on same table
  var overlapWarnings=(function(){
    var today=new Date().toISOString().slice(0,10);
    if(viewDate!==today) return {};
    var warnings={};
    var active=bookings.filter(function(b){return b.date===today&&b.status!=="cancelled"&&b.status!=="completed"&&(b.tables||[]).length>0;});
    var seated=active.filter(function(b){return b.status==="seated";});
    seated.forEach(function(sb){
      var liveEnd=nowMins;
      var sbTables=sb.tables||[];
      var nextOnTable=null;var nextStart=Infinity;
      active.forEach(function(ob){
        if(ob.id===sb.id||ob.status==="seated") return;
        var oTables=ob.tables||[];
        var shared=sbTables.some(function(t){return oTables.includes(t);});
        if(!shared) return;
        var os=toMins(ob.time);
        if(os>=toMins(sb.time)&&os<nextStart){nextStart=os;nextOnTable=ob;}
      });
      if(nextOnTable){
        var gap=nextStart-liveEnd;
        if(gap<=15) warnings[sb.id]={next:nextOnTable.name,nextTime:nextOnTable.time,gap:gap,overdue:gap<=0,nextId:nextOnTable.id};
      }
    });
    return warnings;
  })();

  function flash(){setReshuffled(true);setTimeout(function(){setReshuffled(false);},3000);}
  function openNew(){setForm(Object.assign({},EMPTY_FORM,{date:viewDate}));setEditId(null);setError("");setSwapAffected(null);setShowForm(true);}
  function openEdit(b){setForm({name:b.name,phone:b.phone||"+",date:b.date,time:b.time,size:b.size,preference:b.preference,notes:b.notes||"",status:b.status,customDur:(b.originalDuration||b.duration)!==getDur(b.size)?(b.originalDuration||b.duration):null,manualTables:[],preferredTables:Array.isArray(b.preferredTables)?b.preferredTables.slice():[],returnOf:null});setEditId(b.id);setError("");setSwapAffected(null);setShowHistory(false);setShowForm(true);}
  // v14: Book Again — opens a fresh new-booking form pre-filled from an existing
  // booking. Date starts blank so staff must pick it; time carries over. The
  // `returnOf` field links back to the source booking so we can write history
  // on BOTH the new booking (when created) and the original (on successful save).
  // v14 p1 (Issue 3): reads sourceBooking.scheduledTime — NOT sourceBooking.time —
  // so the pre-filled time reflects the confirmed plan (e.g. 20:30), not the
  // seated-shifted time (e.g. 20:15). Fallback to .time for legacy bookings
  // without scheduledTime (sanitize also backfills it on load).
  function bookAgain(sourceBooking){
    if(!sourceBooking) return;
    var schedTime=sourceBooking.scheduledTime||sourceBooking.time||"13:00";
    setForm(Object.assign({},EMPTY_FORM,{
      name:sourceBooking.name||"",
      phone:sourceBooking.phone||"+",
      date:"",
      time:schedTime,
      size:sourceBooking.size||2,
      preference:sourceBooking.preference||"auto",
      preferredTables:Array.isArray(sourceBooking.preferredTables)?sourceBooking.preferredTables.slice():[],
      notes:"",
      customDur:null,
      manualTables:[],
      status:"confirmed",
      returnOf:sourceBooking.id
    }));
    setEditId(null);
    setError("");
    setSwapAffected(null);
    setShowHistory(false);
    setShowForm(true);
  }

  // Walk-in
  var wis=useState(false);var showWalkin=wis[0],setShowWalkin=wis[1];
  var wfs=useState({size:2,notes:"",tables:[],time:""});var walkinForm=wfs[0],setWalkinForm=wfs[1];
  var wes=useState("");var walkinError=wes[0],setWalkinError=wes[1];
  function getNextWalkinNum(){
    var today=new Date().toISOString().slice(0,10);
    var max=0;bookings.forEach(function(b){if(b.date===today&&b.name&&b.name.indexOf("Walk-in ")===0){var n=parseInt(b.name.slice(8));if(n>max) max=n;}});
    return max+1;
  }
  function nowTime(){var d=new Date();return toTime(d.getHours()*60+d.getMinutes());}
  function openWalkin(){setWalkinForm({size:2,notes:"",tables:[],time:nowTime(),customDur:null});setWalkinError("");setShowWalkin(true);}
  function doSaveWalkin(){
    var wf=walkinForm;
    if(!wf.tables||!wf.tables.length){setWalkinError("Please assign tables first.");return;}
    var t=wf.time||nowTime();var size=Number(wf.size)||2;var dur=wf.customDur||getDur(size);
    var nb={id:genId(),name:"Walk-in "+getNextWalkinNum(),phone:"",date:new Date().toISOString().slice(0,10),time:t,scheduledTime:t,size:size,duration:dur,originalDuration:dur,preference:"auto",notes:wf.notes||"",status:"seated",tables:wf.tables,customDur:wf.customDur||null,_manual:true,_locked:true,history:[histEntry("walk-in created",getUser())]};
    saveBookings(function(prev){return prev.concat([nb]);});
    setShowWalkin(false);setViewDate(new Date().toISOString().slice(0,10));
  }
  function saveWalkin(){
    var wf=walkinForm;
    var t=wf.time||nowTime();var size=Number(wf.size)||2;var dur=wf.customDur||getDur(size);
    var wDate=new Date().toISOString().slice(0,10);
    var load=getKitchenLoad(bookings,wDate,t,dur,null);
    if(load.starts+1>=KITCHEN_TABLE_LIMIT&&!confirmKitchen){
      setConfirmKitchen("walkin");return;
    }
    setConfirmKitchen(null);doSaveWalkin();
  }

  function doSave(){
    var f=formRef.current;
    try{
      if(!f.name||!f.name.trim()){setError("Customer name is required.");return;}
      // v14 p1 (Issue 3): date is required. Applies to both new bookings (including
      // Book Again) and edits. Walk-ins use today automatically so they are unaffected.
      if(!f.date){setError("Please set a date.");return;}
      if(!f.time){setError("Please set a time.");return;}
      var sm=toMins(f.time);
      if(sm<OPEN*60||sm>CLOSE*60){setError("Bookings accepted between "+OPEN+":00 and "+CLOSE+":00.");return;}
      var size=Number(f.size)||2;
      var dur=f.customDur||getDur(size);
      var cleanPhone=f.phone&&f.phone.trim()!=="+"?f.phone.trim():"";
      var mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:[];
      if(mt.length&&!swapAffected){var ex=liveBookings.filter(function(b){return b.date===f.date&&b.status!=="cancelled"&&b.id!==editId;}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+b.duration};});ex=ex.concat(getBlockSlots(tableBlocks,f.date));if(!canAssign(mt,ex,sm,sm+dur)){setError("Selected tables are not available at this time.");return;}}
      if(editId){
        var orig=bookings.find(function(b){return b.id===editId;});
        var origPt=(orig&&Array.isArray(orig.preferredTables))?orig.preferredTables.slice().sort().join(","):"";
        var newPt=Array.isArray(f.preferredTables)?f.preferredTables.slice().sort().join(","):"";
        var prefTablesChanged=origPt!==newPt;
        // v14: detect confirmed→seated transition here. Only auto-shift time if
        // staff did NOT manually edit time/date in the form (otherwise their
        // explicit edit wins). Compute BEFORE needsR so we can suppress reshuffle.
        var seatingNow=orig&&orig.status!=="seated"&&f.status==="seated";
        var timeUntouched=orig&&f.time===orig.time&&f.date===orig.date;
        var seatedShift=null;
        if(seatingNow&&timeUntouched){
          // Use live-synced bookings so overstaying seated guests' tables are
          // correctly treated as occupied when the overlap guard runs.
          seatedShift=applySeatedShift(orig,nowMins,liveBookings);
        }
        var needsR=!orig||size!==orig.size||f.time!==orig.time||f.date!==orig.date||f.preference!==orig.preference||f._clearManual||prefTablesChanged;
        var prefOnly=orig&&size===orig.size&&f.time===orig.time&&f.date===orig.date&&!f._clearManual;
        var formPlan=f.customDur||getDur(size);
        var origPlan=orig?(orig.originalDuration||orig.duration||90):formPlan;
        var planChanged=formPlan!==origPlan;
        var saveDur=planChanged?formPlan:(orig?(orig.duration||90):formPlan);
        var saveOrigDur=planChanged?formPlan:origPlan;
        var saveCustDur=planChanged?(f.customDur||null):(orig?(orig.customDur||null):(f.customDur||null));
        if(f.status==="completed"&&orig&&orig.status!=="completed"&&!f.customDur){var now=new Date();var nowMinsLocal=now.getHours()*60+now.getMinutes();var startMins=toMins(f.time);var actualDur=Math.max(15,nowMinsLocal-startMins);saveDur=actualDur;saveCustDur=actualDur;}
        // Apply seated shift (if any) to the values we'll write. Overrides plan
        // numbers above — the shift always wins over default-duration logic.
        var saveTime=f.time;
        if(seatedShift){
          saveTime=seatedShift.newTime;
          saveDur=seatedShift.newDuration;
          saveCustDur=seatedShift.newDuration;
        }
        var clearM=!!f._clearManual;
        var wasSeatedLocked=orig&&isLocked(orig)&&!mt.length;
        var editHist=orig?histEntry("edited: "+diffBooking(orig,f,size),getUser()):histEntry("edited",getUser());
        // v14 p1: scheduledTime resolution.
        // - If user manually changed time in the form (f.time !== orig.time), that
        //   is an explicit reschedule → scheduledTime follows the new time.
        // - If the ONLY time change is the seated-shift (auto), scheduledTime stays
        //   pinned to the original — this is what "Book Again" reads from later.
        // - For pre-v14 bookings without scheduledTime, sanitize already backfilled it.
        var userChangedTime=orig&&f.time!==orig.time;
        var saveScheduledTime=userChangedTime?f.time:(orig&&orig.scheduledTime?orig.scheduledTime:f.time);
        // v14 p1 (Issue 2 fix #2): when a seated-shift happens, originalDuration
        // must also move to the new duration so the ghost bar anchors at the true
        // scheduled end (e.g. 20:15 + 105 = 22:00), not at the stale 21:45.
        var saveOrigDurFinal=seatedShift?seatedShift.newDuration:saveOrigDur;
        var upd=bookings.map(function(b){
          if(b.id===editId){
            var h=(b.history||[]).concat([editHist]);
            if(seatedShift) h=h.concat([histEntry("seated "+seatedShift.direction+": time adjusted "+seatedShift.oldTime+" → "+seatedShift.newTime,getUser())]);
            var unlockForOpt=needsR&&wasSeatedLocked&&!mt.length&&!clearM;
            return Object.assign({},b,{name:f.name,phone:cleanPhone,date:f.date,time:saveTime,scheduledTime:saveScheduledTime,size:size,duration:saveDur,originalDuration:saveOrigDurFinal,preference:f.preference,notes:f.notes,status:unlockForOpt?"confirmed":f.status,tables:mt.length?mt:(clearM?[]:(!needsR?b.tables:[])),customDur:saveCustDur,_manual:mt.length>0?true:(clearM?false:b._manual),_locked:mt.length>0?true:(clearM?false:(unlockForOpt?false:b._locked)),preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],history:h});
          }
          if(swapAffected){var match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){var remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}}
          return b;
        });
        // v14: when seating, force no-reshuffle of other bookings (same rule as
        // updateStatus). The seated-shift must not trigger cascading table moves.
        var optStateForSave=seatingNow?false:autoOptimizer;
        var fin=bookingsAfterAction(upd,f.date,tableBlocks,editId,needsR&&!mt.length,optStateForSave);
        if(wasSeatedLocked&&needsR&&!mt.length&&!clearM){fin=fin.map(function(b){if(b.id===editId) return Object.assign({},b,{status:f.status,_locked:b.tables&&b.tables.length>0,_manual:b.tables&&b.tables.length>0});return b;});}
        if(!mt.length&&needsR&&!prefOnly){
          var prevAssigned=bookings.filter(function(b){return b.date===f.date&&isActive(b)&&b.tables&&b.tables.length>0&&b.id!==editId;});
          var displaced=fin.filter(function(b){return b.id!==editId&&b.date===f.date&&isActive(b)&&(!b.tables||!b.tables.length||b._conflict);});
          var kicked=displaced.filter(function(d){return prevAssigned.some(function(p){return p.id===d.id;});});
          if(kicked.length>0){setError("Not enough capacity — this change would displace "+kicked.length+" existing booking"+(kicked.length>1?"s":"")+": "+kicked.map(function(k){return k.name;}).join(", ")+".");return;}
        }
        if(!mt.length&&needsR){
          var editedInFin=fin.find(function(b){return b.id===editId;});
          if(editedInFin&&(!editedInFin.tables||!editedInFin.tables.length)){setError("No tables available at this time — see suggestions below.");return;}
        }
        saveBookings(fin);if(needsR||swapAffected||f.status==="completed"||seatingNow) flash();setShowForm(false);setViewDate(f.date);
      } else {
        var newId=genId();
        // v14: Book Again flow. When f.returnOf is set, the new booking links
        // back to its source, gets a distinctive "created via Book Again" entry
        // in its own history, and the ORIGINAL booking gets a matching entry
        // indicating the customer re-booked.
        // v14 p1: history references source.scheduledTime (the confirmed time)
        // rather than source.time, so "created via Book Again (from X on YYYY-MM-DD
        // at 20:30)" stays accurate even if the source was seated-shifted to 20:15.
        var returnOfId=f.returnOf||null;
        var source=returnOfId?bookings.find(function(b){return b.id===returnOfId;}):null;
        var sourceSchedTime=source?(source.scheduledTime||source.time):"";
        var createHist=source?histEntry("created via Book Again (from "+source.name+" on "+source.date+" at "+sourceSchedTime+")",getUser()):histEntry("created",getUser());
        // v14 p1: scheduledTime=f.time on creation (new bookings always start confirmed).
        var nb={id:newId,name:f.name,phone:cleanPhone,date:f.date,time:f.time,scheduledTime:f.time,size:size,duration:dur,originalDuration:dur,preference:f.preference,notes:f.notes,status:"confirmed",tables:mt.length?mt:[],customDur:f.customDur||null,_manual:mt.length>0,_locked:mt.length>0,preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],returnOf:returnOfId,history:[createHist]};
        var base=bookings;
        if(swapAffected){base=bookings.map(function(b){var match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){var remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}return b;});}
        // If this is a Book Again creation, append a back-reference entry to the
        // source booking's history (purely informational — no status/table change).
        if(source){
          base=base.map(function(b){
            if(b.id!==returnOfId) return b;
            return Object.assign({},b,{history:(b.history||[]).concat([histEntry("Book Again → new booking on "+f.date+" at "+f.time,getUser())])});
          });
        }
        var fin=bookingsAfterAction(base.concat([nb]),f.date,tableBlocks,newId,!mt.length,autoOptimizer);
        if(!mt.length){
          var ne=fin.find(function(b){return b.id===newId;});
          if(!ne||(ne.tables||[]).length===0){setError("Could not assign a table — try manual assignment.");return;}
          var displaced=fin.filter(function(b){return b.id!==newId&&b.date===f.date&&isActive(b)&&(!b.tables||!b.tables.length||b._conflict);});
          var prevAssigned=base.filter(function(b){return b.date===f.date&&isActive(b)&&b.tables&&b.tables.length>0;});
          var kicked=displaced.filter(function(d){return prevAssigned.some(function(p){return p.id===d.id;});});
          if(kicked.length>0){setError("Not enough capacity — adding this booking would displace "+kicked.length+" existing booking"+(kicked.length>1?"s":"")+": "+kicked.map(function(k){return k.name;}).join(", ")+".");return;}
        }
        saveBookings(fin);flash();setShowForm(false);setViewDate(f.date);
      }
    }catch(err){setError("Error: "+err.message);}
  }
  function save(){
    var f=formRef.current;
    if(!f.time) return doSave();
    var size=Number(f.size)||2;var d=f.customDur||getDur(size);
    var load=getKitchenLoad(bookings,f.date,f.time,d,editId);
    if(load.starts+1>=KITCHEN_TABLE_LIMIT&&!confirmKitchen){
      setConfirmKitchen("form");return;
    }
    setConfirmKitchen(null);doSave();
  }

  function forceReshuffle(){saveBookings(function(b){return applyOpt(b,viewDate,tableBlocks);});flash();}
  // Reassign a single booking to a different set of tables without touching any
  // other booking. Used by the overlap warning's Reassign button when Optimizer
  // is OFF and staff need a quick escape hatch for a booking about to be crowded
  // out by an overstaying guest. Skips locked bookings (manual intent preserved).
  // v14: feeds liveBookings into findFreeSlot so already-overstaying seated
  // guests' tables are correctly treated as occupied.
  // v14 p1 (Issue 1 fix): ALSO transiently extends the duration of any seated
  // booking that is about to overstay onto the target's window (identified via
  // overlapWarnings). Without this, a seated booking ending in e.g. 9 min is
  // not yet "overstaying" per syncLiveDurations — its tables would falsely read
  // as free at target.time, and findFreeSlot would return the same tables the
  // target already has. We only extend for this one lookup; state is unchanged.
  function reassignBooking(id){
    var target=bookings.find(function(b){return b.id===id;});
    if(!target){setError("Booking not found.");return;}
    if(isLocked(target)){setError("Booking is manually locked. Edit manually to change tables.");return;}
    var targetStart=toMins(target.time);
    var targetEnd=targetStart+(target.duration||90);
    // Build a search-view where any seated booking currently flagged as blocking
    // THIS target (or any seated booking sharing tables whose scheduled end is
    // before target.time) is stretched to at least targetStart+1 minute. That
    // guarantees findFreeSlot treats their tables as busy at target's start.
    var searchView=liveBookings.map(function(b){
      if(b.id===target.id) return b;
      if(b.status!=="seated") return b;
      if(b.date!==target.date) return b;
      var tables=b.tables||[];
      var sharesTable=tables.some(function(t){return (target.tables||[]).includes(t);});
      if(!sharesTable) return b;
      var bs=toMins(b.time);
      var be=bs+(b.duration||90);
      // Only extend if the seated booking ends before target's END (i.e., it could
      // plausibly overlap or free up within target's window). If it already runs
      // past target end, syncLiveDurations handled it.
      if(be>=targetEnd) return b;
      // Extend to cover target fully so findFreeSlot never considers these tables.
      var extendedDur=targetEnd-bs;
      return Object.assign({},b,{duration:extendedDur});
    });
    var tables=findFreeSlot(searchView,target.date,target.time,target.size||2,target.preference||"auto",target.duration||90,tableBlocks,id,target.preferredTables);
    if(!tables||!tables.length){setError("No alternative tables available for "+target.name+" at "+target.time+".");return;}
    // Sanity: if findFreeSlot returned the same tables (possible if the algorithm
    // found a valid-but-unchanged assignment), surface it as a no-op rather than
    // silently "succeeding" with nothing changed.
    var curKey=(target.tables||[]).slice().sort().join("|");
    var newKey=tables.slice().sort().join("|");
    if(curKey===newKey){setError("No alternative tables available for "+target.name+" at "+target.time+".");return;}
    var prevTables=(target.tables||[]).join("+")||"none";
    var user=getUser();
    saveBookings(function(prev){return prev.map(function(b){
      if(b.id!==id) return b;
      return Object.assign({},b,{tables:tables,_manual:false,_conflict:false,history:(b.history||[]).concat([histEntry("reassigned "+prevTables+" → "+tables.join("+"),user)])});
    });});
    setError("");
    flash();
  }
  function delBooking(id){saveBookings(function(b){var target=b.find(function(x){return x.id===id;});var d=target?target.date:viewDate;return bookingsAfterAction(b.filter(function(x){return x.id!==id;}),d,tableBlocks,null,false,autoOptimizer);});setConfirmDel(null);flash();}

  // v14 preview 3: Global keyboard shortcuts. Uses a ref to capture the latest
  // state and action callbacks on every render so the window-level keydown
  // listener (mounted once) always sees fresh values without re-subscribing.
  //
  // Precedence rules:
  //   1. Modifier keys (Ctrl / Meta / Alt) — always pass through so browser/OS
  //      shortcuts (Cmd+F, Ctrl+R, etc.) keep working.
  //   2. Escape — closes the topmost open modal (matches visual z-order).
  //   3. Enter — triggers the primary action of the topmost modal. In a
  //      <textarea> Enter still inserts a newline. The Manual Table Assignment
  //      modal handles its own Enter internally; globally we skip it.
  //   4. Letter / symbol / arrow shortcuts — suppressed when focus is on an
  //      input / textarea / select / contenteditable so typing is never hijacked.
  //      Suppressed as well while any modal is open, except for A/P/B/H which
  //      fire only when the Edit Booking modal is the top layer.
  var kbRef=useRef({});
  kbRef.current={
    view:view,setView:setView,viewDate:viewDate,setViewDate:setViewDate,
    timelineZoom:timelineZoom,setTimelineZoom:setTimelineZoom,
    followNow:followNow,setFollowNow:setFollowNow,
    autoOptimizer:autoOptimizer,setAutoOptimizer:setAutoOptimizer,
    showForm:showForm,setShowForm:setShowForm,editId:editId,form:form,setForm:setForm,setSwapAffected:setSwapAffected,
    showWalkin:showWalkin,setShowWalkin:setShowWalkin,
    showHistory:showHistory,setShowHistory:setShowHistory,
    showSettings:showSettings,setShowSettings:setShowSettings,
    // v14 p7: settingsTab for ←/→ tab-cycle shortcut inside Settings modal.
    settingsTab:settingsTab,setSettingsTab:setSettingsTab,
    // v14 p7: reminder editor state for Esc/Enter handling.
    reminderEditor:reminderEditor,setReminderEditor:setReminderEditor,
    saveReminderFromEditor:saveReminderFromEditor,
    // v14 p7 fix: reminder-delete confirm state.
    confirmReminderDel:confirmReminderDel,setConfirmReminderDel:setConfirmReminderDel,
    doDeleteReminder:doDeleteReminder,
    manualTarget:manualTarget,setManualTarget:setManualTarget,
    showPrefPicker:showPrefPicker,setShowPrefPicker:setShowPrefPicker,
    confirmDel:confirmDel,setConfirmDel:setConfirmDel,
    confirmReshuffle:confirmReshuffle,setConfirmReshuffle:setConfirmReshuffle,
    confirmCancel:confirmCancel,setConfirmCancel:setConfirmCancel,
    confirmKitchen:confirmKitchen,setConfirmKitchen:setConfirmKitchen,
    blockTarget:blockTarget,setBlockTarget:setBlockTarget,
    bookings:bookings,
    openNew:openNew,openWalkin:openWalkin,
    save:save,doSave:doSave,saveWalkin:saveWalkin,doSaveWalkin:doSaveWalkin,
    forceReshuffle:forceReshuffle,delBooking:delBooking,bookAgain:bookAgain
  };
  useEffect(function(){
    function isTyping(el){if(!el) return false;var t=el.tagName;return t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||el.isContentEditable;}
    function handler(e){
      if(e.ctrlKey||e.metaKey||e.altKey) return;
      var K=kbRef.current;var k=e.key;var typing=isTyping(e.target);
      // ── Escape: close topmost modal (checked in visual z-order) ──
      if(k==="Escape"){
        // v14 p7: reminderEditor sits above Settings (z=250). Close it first.
        if(K.reminderEditor){e.preventDefault();K.setReminderEditor(null);return;}
        // v14 p7 fix: delete-confirm renders above Settings in DOM order.
        if(K.confirmReminderDel){e.preventDefault();K.setConfirmReminderDel(null);return;}
        // v14 p7 fix: reset tab to 'general' on Esc close — matches the
        // Close button and backdrop-click onClose behavior.
        if(K.showSettings){e.preventDefault();K.setShowSettings(false);K.setSettingsTab("general");return;}
        if(K.showHistory){e.preventDefault();K.setShowHistory(false);return;}
        if(K.confirmKitchen){e.preventDefault();K.setConfirmKitchen(null);return;}
        if(K.confirmReshuffle){e.preventDefault();K.setConfirmReshuffle(false);return;}
        if(K.confirmCancel){e.preventDefault();K.setConfirmCancel(null);return;}
        if(K.confirmDel){e.preventDefault();K.setConfirmDel(null);return;}
        if(K.showPrefPicker){e.preventDefault();K.setShowPrefPicker(false);return;}
        if(K.blockTarget){e.preventDefault();K.setBlockTarget(null);return;}
        if(K.manualTarget){e.preventDefault();K.setManualTarget(null);return;}
        if(K.showWalkin){e.preventDefault();K.setShowWalkin(false);return;}
        if(K.showForm){e.preventDefault();K.setShowForm(false);return;}
        return;
      }
      // ── Enter: primary action of topmost modal ──
      if(k==="Enter"){
        // In a textarea Enter always inserts a newline — never save.
        if(typing&&e.target.tagName==="TEXTAREA") return;
        // v14 p7: reminderEditor is topmost when open — save if draft is valid.
        if(K.reminderEditor){
          if(!validateReminderDraft(K.reminderEditor.draft)){
            e.preventDefault();K.saveReminderFromEditor();
          }
          return;
        }
        // v14 p7 fix: delete-confirm Enter → confirm deletion.
        if(K.confirmReminderDel){e.preventDefault();K.doDeleteReminder(K.confirmReminderDel);return;}
        // Manual Modal handles its own Enter. Quick-status popup is ambiguous.
        if(K.manualTarget) return;
        if(K.confirmKitchen){
          var isW=K.confirmKitchen==="walkin";
          e.preventDefault();
          K.setConfirmKitchen(null);
          if(isW) K.doSaveWalkin(); else K.doSave();
          return;
        }
        if(K.confirmReshuffle){e.preventDefault();K.setConfirmReshuffle(false);K.forceReshuffle();return;}
        if(K.confirmDel){e.preventDefault();K.delBooking(K.confirmDel);return;}
        if(K.showPrefPicker){e.preventDefault();K.setShowPrefPicker(false);return;}
        if(K.showWalkin){e.preventDefault();K.saveWalkin();return;}
        if(K.showForm){
          // Save button is disabled when date is empty → mirror that here.
          if(K.form&&K.form.date){e.preventDefault();K.save();}
          return;
        }
        return;
      }
      // ── Letter / symbol / arrow shortcuts: never hijack typing ──
      if(typing) return;
      // ── v14 p7: Settings tab-cycle with ←/→ ──
      // Active only when Settings is the top layer (reminderEditor and
      // confirmReminderDel are sub-modals on top of Settings — when they're
      // open, arrows should flow to their default behavior or be no-ops).
      // Takes priority over the global ←/→ day-nav shortcut below.
      if(K.showSettings&&!K.reminderEditor&&!K.confirmReminderDel){
        if(k==="ArrowLeft"||k==="ArrowRight"){
          e.preventDefault();
          var TABS=["general","reminders","shortcuts"];
          var curIdx=TABS.indexOf(K.settingsTab);if(curIdx<0) curIdx=0;
          var newIdx=k==="ArrowLeft"?(curIdx-1+TABS.length)%TABS.length:(curIdx+1)%TABS.length;
          K.setSettingsTab(TABS[newIdx]);
          return;
        }
      }
      // ── Edit Booking modal shortcuts ──
      // Only fire when Edit is the TOP layer (no popup on top of it).
      // ── Preferred-table picker: captures C (= Clear). Sits ABOVE the
      //    form-modal block so A/P/B/H don't fire while the picker is open
      //    (which matches the user-intuitive "only the top modal responds"
      //    precedence).
      if(K.showPrefPicker){
        if(k==="c"||k==="C"){
          var prefs=Array.isArray(K.form&&K.form.preferredTables)?K.form.preferredTables:[];
          if(prefs.length>0){
            e.preventDefault();
            K.setForm(function(f){return Object.assign({},f,{preferredTables:[]});});
          }
        }
        return; // no other letter shortcuts propagate while picker is up
      }
      // ── Edit & New Booking form shortcuts ──
      //   A / P work in BOTH new and edit (request 1). In new mode, A opens
      //   Manual with target "__new__" to match the "= Assign" button.
      //   B / H remain edit-only (new bookings have no history or source).
      //   C clears the tables assignment — logic mirrors the form's 3 Clear
      //   buttons: if the user has set manualTables, clear those; else in
      //   edit mode, if the stored booking has a manual assignment not yet
      //   marked cleared, set _clearManual:true; else no-op.
      var topLayer=K.showSettings||K.showHistory||K.confirmKitchen||K.confirmReshuffle||K.confirmCancel||K.confirmDel||K.blockTarget||K.manualTarget||K.reminderEditor||K.confirmReminderDel;
      if(K.showForm&&!topLayer){
        if(k==="a"||k==="A"){e.preventDefault();K.setManualTarget(K.editId||"__new__");return;}
        if(k==="p"||k==="P"){e.preventDefault();K.setShowPrefPicker(true);return;}
        if(k==="c"||k==="C"){
          var mtLen=Array.isArray(K.form&&K.form.manualTables)?K.form.manualTables.length:0;
          if(mtLen>0){
            e.preventDefault();
            K.setForm(function(f){return Object.assign({},f,{manualTables:[]});});
            K.setSwapAffected(null);
          } else if(K.editId){
            var cur3=K.bookings.find(function(b){return b.id===K.editId;});
            var isManual3=cur3&&(cur3._manual||cur3._locked)&&cur3.tables&&cur3.tables.length>0;
            var alreadyCleared=!!(K.form&&K.form._clearManual);
            if(isManual3&&!alreadyCleared){
              e.preventDefault();
              K.setForm(function(f){return Object.assign({},f,{manualTables:[],_clearManual:true});});
              K.setSwapAffected(null);
            }
          }
          return;
        }
        if(K.editId){
          if(k==="b"||k==="B"){
            var cur=K.bookings.find(function(b){return b.id===K.editId;});
            if(cur&&(cur.status==="seated"||cur.status==="completed")){e.preventDefault();K.bookAgain(cur);}
            return;
          }
          if(k==="h"||k==="H"){
            var c2=K.bookings.find(function(b){return b.id===K.editId;});
            if(c2&&c2.history&&c2.history.length>0){e.preventDefault();K.setShowHistory(true);}
            return;
          }
        }
      }
      // ── Global shortcuts: suppressed while any modal is open ──
      var anyModal=K.showForm||K.showWalkin||K.showHistory||K.confirmDel||K.confirmReshuffle||K.confirmCancel||K.confirmKitchen||K.manualTarget||K.blockTarget||K.showPrefPicker||K.showSettings||K.reminderEditor||K.confirmReminderDel;
      if(anyModal) return;
      if(k==="?"){e.preventDefault();K.setShowSettings(true);return;}
      if(k==="t"||k==="T"){e.preventDefault();K.setView("timeline");return;}
      if(k==="l"||k==="L"){e.preventDefault();K.setView("list");return;}
      if(k==="d"||k==="D"){e.preventDefault();K.setViewDate(new Date().toISOString().slice(0,10));return;}
      if(k==="n"||k==="N"){e.preventDefault();K.openNew();return;}
      if(k==="w"||k==="W"){e.preventDefault();K.openWalkin();return;}
      if(k==="ArrowLeft"){e.preventDefault();var d1=new Date(K.viewDate);d1.setDate(d1.getDate()-1);K.setViewDate(d1.toISOString().slice(0,10));return;}
      if(k==="ArrowRight"){e.preventDefault();var d2=new Date(K.viewDate);d2.setDate(d2.getDate()+1);K.setViewDate(d2.toISOString().slice(0,10));return;}
      // ── Timeline-only shortcuts ──
      if(K.view==="timeline"){
        var today=new Date().toISOString().slice(0,10);
        var isToday=K.viewDate===today;
        if(k==="f"||k==="F"){
          if(isToday){
            e.preventDefault();
            if(!K.followNow){K.setFollowNow(true);if(K.timelineZoom<4) K.setTimelineZoom(4);}
            else{K.setFollowNow(false);}
          }
          return;
        }
        if(k==="+"||k==="="){e.preventDefault();K.setTimelineZoom(function(z){return Math.min(5,z+0.5);});return;}
        if(k==="-"){e.preventDefault();K.setTimelineZoom(function(z){return Math.max(1,z-0.5);});return;}
        if(k==="0"){e.preventDefault();K.setTimelineZoom(1);K.setFollowNow(false);return;}
        if(k==="o"||k==="O"){
          if(isToday){e.preventDefault();K.setAutoOptimizer(function(p){return !p;});}
          return;
        }
        if(k==="r"||k==="R"){
          if(isToday&&!K.autoOptimizer){e.preventDefault();K.setConfirmReshuffle(true);}
          return;
        }
      }
    }
    window.addEventListener("keydown",handler);
    return function(){window.removeEventListener("keydown",handler);};
  },[]);

  function updateStatus(id,status){
    if(status==="cancelled"){setConfirmCancel(id);return;}
    var user=getUser();
    var nowM=nowMins;
    saveBookings(function(b){
      var target=b.find(function(x){return x.id===id;});
      var d=target?target.date:viewDate;
      // v14: detect confirmed → seated transition (for any prior non-seated status).
      // If the transition triggers a seated-shift, force no-reshuffle by passing
      // autoOptimizerState=false to bookingsAfterAction, so other bookings never
      // move as a side-effect of someone sitting down early/late.
      var seatedShiftHappened=false;
      var updated=b.map(function(x){
        if(x.id!==id) return x;
        var histEntries=[histEntry("status → "+status,user)];
        var extra={status:status};
        if(status==="completed"){
          var startMins=toMins(x.time);
          var actualDur=Math.max(15,nowM-startMins);
          extra.duration=actualDur;
          extra.customDur=actualDur;
        }
        if(status==="seated"&&x.status!=="seated"){
          var shift=applySeatedShift(x,nowM,b);
          if(shift){
            extra.time=shift.newTime;
            extra.duration=shift.newDuration;
            extra.originalDuration=shift.newDuration;
            extra.customDur=shift.newDuration;
            // scheduledTime is intentionally NOT updated here — it stays pinned to
            // the confirmed time so Book Again and history reads show the true plan.
            histEntries.push(histEntry("seated "+shift.direction+": time adjusted "+shift.oldTime+" → "+shift.newTime,user));
            seatedShiftHappened=true;
          }
        }
        extra.history=(x.history||[]).concat(histEntries);
        return Object.assign({},x,extra);
      });
      // Seated transitions never reshuffle others — even when optimizer is ON.
      var optState=(status==="seated")?false:autoOptimizer;
      return bookingsAfterAction(updated,d,tableBlocks,null,false,optState);
    });
    if(status==="completed"||status==="seated") flash();
  }
  function doCancelBooking(id,noShow){
    var user=getUser();
    saveBookings(function(b){var target=b.find(function(x){return x.id===id;});var d=target?target.date:viewDate;var updated=b.map(function(x){if(x.id!==id) return x;var extra={status:"cancelled",history:(x.history||[]).concat([histEntry(noShow?"no show":"cancelled",user)])};if(noShow) extra.notes=(x.notes?x.notes+"\n":"")+"No show";return Object.assign({},x,extra);});return bookingsAfterAction(updated,d,tableBlocks,null,false,autoOptimizer);});
    setConfirmCancel(null);flash();
  }
  function manualAssign(bookingId,tables,locked,affected){
    var user=getUser();
    saveBookings(function(b){
      var updated=b.map(function(x){
        if(x.id===bookingId) return Object.assign({},x,{tables:tables,_conflict:false,_manual:true,_locked:locked===true,history:(x.history||[]).concat([histEntry("tables manually assigned: "+tables.join(", "),user)])});
        // If swapping, strip taken tables from affected bookings and unlock them for re-optimization
        if(affected&&affected.length>0){
          var match=affected.find(function(ab){return ab.id===x.id;});
          if(match){
            var remaining=(x.tables||[]).filter(function(t){return !match.tables.includes(t);});
            return Object.assign({},x,{tables:remaining,_locked:false,_manual:false});
          }
        }
        return x;
      });
      // Re-optimize to reassign affected bookings to new tables (when optimizer active)
      if(affected&&affected.length>0) return bookingsAfterAction(updated,viewDate,tableBlocks,null,false,autoOptimizer);
      return updated;
    });
    setManualTarget(null);
    if(affected&&affected.length>0) flash();
  }

  function addBlock(block){
    var next=tableBlocks.concat([block]);
    saveBlocks(next);
    saveBookings(function(b){return bookingsAfterAction(b,block.date,next,null,false,autoOptimizer);});
    flash();
    setBlockTarget(null);
  }
  function removeBlock(block){
    var next=tableBlocks.filter(function(bl){return !(bl.tableId===block.tableId&&bl.date===block.date&&bl.allDay===block.allDay&&bl.from===block.from&&bl.to===block.to);});
    saveBlocks(next);
    saveBookings(function(b){return bookingsAfterAction(b,block.date,next,null,false,autoOptimizer);});
    flash();
    if(next.filter(function(bl){return bl.tableId===block.tableId&&bl.date===block.date;}).length===0) setBlockTarget(null);
  }

  var manualBooking=(function(){
    if(!manualTarget) return null;
    if(manualTarget==="__new__"){return {id:"__new__",name:form.name||"New booking",size:Number(form.size)||2,time:form.time||"13:00",duration:form.customDur||getDur(Number(form.size)||2),tables:Array.isArray(form.manualTables)?form.manualTables:[],date:form.date,status:"confirmed",_locked:true};}
    var found=bookings.find(function(b){return b.id===manualTarget;})||null;
    if(found&&manualTarget===editId){found=Object.assign({},found,{size:Number(form.size)||2,time:form.time||found.time,duration:form.customDur||getDur(Number(form.size)||2),date:form.date||found.date,preference:form.preference||found.preference});}
    return found;
  })();

  // Build form
  var inp=mkInp;
  var formCols=isMobile?"1fr":"1fr 1fr";
  var auto=getDur(Number(form.size));
  var dur=form.customDur||auto;

  // ── Real-time availability check (trial optimization) ──
  var formAvail=(function(){
    if(!showForm||!form.time) return null;
    var sm=toMins(form.time);
    if(sm<OPEN*60||sm>CLOSE*60) return null;
    var size=Number(form.size)||2;
    var d=form.customDur||getDur(size);
    var mt=Array.isArray(form.manualTables)&&form.manualTables.length>0?form.manualTables:null;
    if(mt) return {ok:true,tables:mt,sugg:null};
    var noResh=!optimizerActiveFor(form.date,autoOptimizer);
    var tables=trialFits(liveBookings,form.date,form.time,size,form.preference||"auto",d,tableBlocks,editId,form.preferredTables,noResh);
    if(tables) return {ok:true,tables:tables,sugg:null};
    var sugg=findTimes(form.date,size,form.preference,liveBookings,d,sm,tableBlocks,editId,noResh);
    return {ok:false,tables:null,sugg:formatSugg(sugg,sm)};
  })();

  var tablesBtn=(function(){
    var mt=Array.isArray(form.manualTables)&&form.manualTables.length>0?form.manualTables:null;
    var previewTbls=mt?null:(formAvail&&formAvail.ok?formAvail.tables:null);
    var prefs=form.preferredTables||[];
    var hasPref=prefs.length>0;
    var prefBtn=RC("button",{style:mkBtn({background:hasPref?"#0d9488":"#64748b",fontSize:12,padding:"6px 10px"}),onClick:function(){setShowPrefPicker(true);}},hasPref?"★ "+prefs.join("+"):"★ Preferred");
    if(editId){
      var cur=bookings.find(function(b){return b.id===editId;});
      var curPrefStr=cur&&Array.isArray(cur.preferredTables)?cur.preferredTables.slice().sort().join(","):"";
      var formPrefStr=Array.isArray(form.preferredTables)?form.preferredTables.slice().sort().join(","):"";
      var prefTblChanged=curPrefStr!==formPrefStr;
      var changed=cur&&(form.time!==cur.time||Number(form.size)!==cur.size||form.date!==cur.date||form.preference!==cur.preference||(form.customDur&&form.customDur!==cur.duration)||prefTblChanged);
      var hardChanged=cur&&(form.time!==cur.time||Number(form.size)!==cur.size||form.date!==cur.date||form.preference!==cur.preference||prefTblChanged);
      var cleared=!!form._clearManual;
      var curTbl=cur&&cur.tables&&cur.tables.length>0?cur.tables:null;
      var isManual=cur&&(cur._manual||cur._locked)&&curTbl;
      var showTbl=mt||(isManual&&!hardChanged&&!cleared?curTbl:((changed||cleared)?null:curTbl));
      var showClearManual=isManual&&!mt&&!cleared;
      var leftEls=[
        RC("span",{key:"lbl",style:{fontSize:13,color:"#4a5568",fontWeight:600}},"Tables")];
      if(showTbl) showTbl.forEach(function(id){leftEls.push(RC(TBadge,{key:id,id:id}));});
      else if(previewTbls){previewTbls.forEach(function(id){leftEls.push(RC(TBadge,{key:id,id:id}));});leftEls.push(RC("span",{key:"auto",style:{fontSize:11,color:S.muted,fontStyle:"italic"}},"(auto)"));}
      if((changed||cleared)&&!mt&&curTbl) leftEls.push(RC("span",{key:"prev",style:{fontSize:11,color:S.muted,fontStyle:"italic"}},"was: "+curTbl.join(", ")));
      if(mt) leftEls.push(RC("button",{key:"clrmt",style:mkBtn({fontSize:12,background:BTN.clear}),onClick:function(){setForm(function(f){return Object.assign({},f,{manualTables:[]});});setSwapAffected(null);}},"Clear"));
      if(showClearManual) leftEls.push(RC("button",{key:"clrman",style:mkBtn({fontSize:12,background:BTN.clear}),onClick:function(){setForm(function(f){return Object.assign({},f,{manualTables:[],_clearManual:true});});setSwapAffected(null);}},"Clear"));
      return RC(Section,null,RC("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}},
        RC("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flex:1,minWidth:0}},leftEls),
        RC("div",{style:{display:"flex",gap:6,flexShrink:0}},
          RC("button",{style:mkBtn({background:BTN.tables}),onClick:function(){setManualTarget(editId);}},"= Assign"),
          prefBtn)));
    }
    var leftEls=[RC("span",{key:"lbl",style:{fontSize:13,color:"#4a5568",fontWeight:600}},"Tables")];
    if(mt) mt.forEach(function(id){leftEls.push(RC(TBadge,{key:id,id:id}));});
    else if(previewTbls){previewTbls.forEach(function(id){leftEls.push(RC(TBadge,{key:id,id:id}));});leftEls.push(RC("span",{key:"auto",style:{fontSize:11,color:S.muted,fontStyle:"italic"}},"(auto)"));}
    if(mt) leftEls.push(RC("button",{key:"clrmt",style:mkBtn({fontSize:12,background:BTN.clear}),onClick:function(){setForm(function(f){return Object.assign({},f,{manualTables:[]});});setSwapAffected(null);}},"Clear"));
    return RC(Section,null,RC("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}},
      RC("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flex:1,minWidth:0}},leftEls),
      RC("div",{style:{display:"flex",gap:6,flexShrink:0}},
        RC("button",{style:mkBtn({background:BTN.tables}),onClick:function(){setManualTarget("__new__");}},"= Assign"),
        prefBtn)));
  })();

  var prefPickerModal=(function(){
    if(!showPrefPicker) return null;
    var prefs=form.preferredTables||[];
    var needed=Number(form.size)||2;
    function getCapOf(ids){if(ids.length===0) return 0;var k=ids.slice().sort().join("|");var c=VALID_COMBOS.find(function(x){return x.ids.slice().sort().join("|")===k;});if(c) return c.cap;return ids.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);}
    function togglePref(id){
      setForm(function(f){
        var cur=f.preferredTables||[];
        if(cur.includes(id)) return Object.assign({},f,{preferredTables:cur.filter(function(x){return x!==id;})});
        if(cur.length>0&&getCapOf(cur)>=needed) return f;
        return Object.assign({},f,{preferredTables:cur.concat([id])});
      });
    }
    var cap=getCapOf(prefs);
    var capOk=prefs.length===0||cap>=needed;
    var capText=prefs.length===0?"No preference (auto)":"Capacity: "+cap+" / "+needed+" pax"+(cap>=needed?" ✓":" — need more");
    var capColor=prefs.length===0?S.muted:cap>=needed?"#166534":"#9a3412";
    var groupEls=TABLE_GROUPS.map(function(grp){
      var tableEls=grp.tables.map(function(t){
        var isPref=prefs.includes(t.id);var indoor=isIn(t.id);var tc=indoor?TBL.ind:TBL.out;
        return RC("button",{key:t.id,onClick:function(){togglePref(t.id);},style:{
          width:64,height:48,padding:0,borderRadius:12,
          border:"2px solid "+(isPref?"#0d9488":tc.bg),
          background:isPref?"rgba(13,148,136,0.8)":"rgba(255,255,255,0.4)",
          color:isPref?"#fff":S.text,fontWeight:600,fontSize:14,
          cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,boxSizing:"border-box",
          boxShadow:"0 1px 4px rgba(0,0,0,0.08), inset 0 1px 1px rgba(255,255,255,0.3)"
        }},RC("span",null,t.id),RC("span",{style:{fontSize:10,fontWeight:500,color:isPref?"rgba(255,255,255,0.8)":S.muted}},"cap "+t.cap));
      });
      return RC("div",{key:grp.name,style:{marginBottom:14}},
        RC("div",{style:{fontSize:13,fontWeight:700,color:grp.color,marginBottom:4}},grp.name),
        RC("div",{style:{display:"flex",gap:8,flexWrap:"wrap"}},tableEls));
    });
    return RC(Overlay,{onClose:function(){setShowPrefPicker(false);}},
      RC("div",{style:{textAlign:"center",marginBottom:4}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"#0d9488",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Preferred table")),
      RC("div",{style:{fontSize:13,color:S.text,marginBottom:14}},"Soft hint — optimizer tries this first, falls back if unavailable."),
      RC("div",{style:{marginBottom:14,padding:"10px 14px",borderRadius:14,background:"rgba(255,255,255,0.35)",border:"2px solid "+(capOk?"rgba(134,239,172,0.6)":"rgba(255,255,255,0.5)"),boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
        RC("div",{style:{fontSize:14,fontWeight:700,color:S.text}},"Selected: "+(prefs.length?prefs.join(" + "):"none")),
        RC("div",{style:{fontSize:13,color:capColor,fontWeight:500,marginTop:2}},capText)),
      groupEls,
      RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}},
        prefs.length>0?RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.clear}),onClick:function(){setForm(function(f){return Object.assign({},f,{preferredTables:[]});});}},"Clear"):null,
        RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setShowPrefPicker(false);}},"Done")));
  })();

  var availBanner=showForm&&formAvail&&!formAvail.ok?RC(AvailBanner,{msg:"No tables available"+(form.preference!=="auto"?" ("+form.preference+" preference)":"")+".",sugg:formAvail.sugg,onTapTime:function(t){setForm(function(f){return Object.assign({},f,{time:t});});}}):null;

  var kitchenLoad=(showForm&&form.time)?getKitchenLoad(bookings,form.date,form.time,form.customDur||getDur(Number(form.size)||2),editId):null;
  var kitchenStarts=kitchenLoad?kitchenLoad.starts+1:1;
  var kitchenGuests=kitchenLoad?kitchenLoad.guests+(Number(form.size)||2):Number(form.size)||2;
  var kitchenBusy=kitchenLoad&&kitchenStarts>=KITCHEN_TABLE_LIMIT;
  var kitchenSugg=kitchenBusy?findKitchenFriendlyTimes(bookings,form.date,Number(form.size)||2,form.preference||"auto",form.customDur||getDur(Number(form.size)||2),form.time,editId,tableBlocks):null;
  function renderKitchenTimes(arr){
    if(!arr||!arr.length) return null;
    return arr.map(function(r){return RC("span",{key:r.timeStr,onClick:function(){setForm(function(f){return Object.assign({},f,{time:r.timeStr});});},style:{cursor:"pointer",padding:"3px 8px",borderRadius:6,fontWeight:600,fontSize:12,background:r.hasTables?"rgba(220,252,231,0.8)":"rgba(254,249,195,0.8)",color:r.hasTables?"#166534":"#854d0e",border:"1px solid "+(r.hasTables?"rgba(134,239,172,0.5)":"rgba(253,230,138,0.5)"),boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}},r.timeStr);});
  }
  var kitchenSection=kitchenLoad?RC("div",{style:{padding:"10px 14px",borderRadius:14,border:"2px solid "+(kitchenBusy?"rgba(253,186,116,0.55)":"rgba(255,255,255,0.45)"),background:kitchenBusy?"rgba(255,237,213,0.6)":"rgba(255,255,255,0.35)",marginBottom:14,fontSize:13,color:kitchenBusy?"#9a3412":S.muted}},
    RC("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center"}},
      RC("span",null,RC("span",{style:{fontWeight:700}},"Starting at this time: "),kitchenStarts+" booking"+(kitchenStarts!==1?"s":"")+" · "+kitchenGuests+" guest"+(kitchenGuests!==1?"s":"")),
      kitchenBusy?RC("span",{style:{fontWeight:700,color:"#dc2626",fontSize:13,padding:"4px 12px",borderRadius:8,border:"1.5px solid rgba(220,38,38,0.4)",flexShrink:0}},"Kitchen busy"):null),
    kitchenSugg&&(kitchenSugg.before.length||kitchenSugg.after.length)?RC("div",{style:{marginTop:8}},
      RC("div",{style:{fontSize:11,color:S.muted,marginBottom:6}},RC("span",{style:{background:"rgba(220,252,231,0.8)",color:"#166534",padding:"2px 6px",borderRadius:6,fontSize:10,fontWeight:600}},"green")," = tables available  ",RC("span",{style:{background:"rgba(254,249,195,0.8)",color:"#854d0e",padding:"2px 6px",borderRadius:6,fontSize:10,fontWeight:600}},"yellow")," = kitchen ok, tables tight"),
      kitchenSugg.before.length?RC("div",{style:{marginBottom:4}},RC("span",{style:{fontWeight:700,fontSize:12}},"Before: "),RC("span",{style:{display:"inline-flex",gap:4,flexWrap:"wrap"}},renderKitchenTimes(kitchenSugg.before))):null,
      kitchenSugg.after.length?RC("div",null,RC("span",{style:{fontWeight:700,fontSize:12}},"After: "),RC("span",{style:{display:"inline-flex",gap:4,flexWrap:"wrap"}},renderKitchenTimes(kitchenSugg.after))):null):
    kitchenBusy?RC("div",{style:{marginTop:6,fontSize:12,color:"#991b1b"}},"No kitchen-friendly alternatives found nearby."):null):null;

  var quickStatusBtns=editId?RC(Section,null,
    RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}},
      RC("span",{style:{fontSize:13,color:"#4a5568",fontWeight:600,marginRight:4}},"Status:"),
      ["confirmed","seated","completed","cancelled"].filter(function(s){return s!==form.status;}).map(function(s){return RC("button",{key:s,style:mkBtn({background:BLOCK_BG[s],textTransform:"capitalize",minHeight:40}),onClick:function(){if(s==="cancelled"){setConfirmCancel(editId);return;}setForm(function(f){return Object.assign({},f,{status:s});});}},"> "+s);}))):null;

  var historyBtn=(function(){
    if(!editId) return null;
    var cur=bookings.find(function(b){return b.id===editId;});
    if(!cur||!cur.history||!cur.history.length) return null;
    return RC("button",{onClick:function(){setShowHistory(true);},style:mkBtn({fontSize:12,background:"#64748b",padding:"8px 16px",minHeight:36})},"History ("+cur.history.length+")");
  })();
  // v14: Book Again button — visible only in Edit Booking modal when status is
  // seated or completed. One tap closes the edit modal and opens a new-booking
  // form pre-filled with this customer's details (name, phone, size, preference,
  // preferred tables, original time). Staff must still pick a date.
  var bookAgainBtn=(function(){
    if(!editId) return null;
    var cur=bookings.find(function(b){return b.id===editId;});
    if(!cur) return null;
    if(cur.status!=="seated"&&cur.status!=="completed") return null;
    return RC("button",{onClick:function(){bookAgain(cur);},style:mkBtn({fontSize:12,background:"rgba(22,101,52,0.8)",padding:"8px 16px",minHeight:36})},"Book Again");
  })();
  // v14: "return guest" banner at top of form when this is a Book Again creation.
  // v14 p1: reads src.scheduledTime so the displayed time matches the confirmed
  // plan, not the seated-shifted time.
  var returnOfBanner=(function(){
    if(editId||!form.returnOf) return null;
    var src=bookings.find(function(b){return b.id===form.returnOf;});
    if(!src) return null;
    var srcTime=src.scheduledTime||src.time;
    return RC("div",{style:{background:"rgba(220,252,231,0.7)",border:"2px solid rgba(134,239,172,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#166534",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
      "Return guest — re-booking from "+src.name+" ("+src.date+" at "+srcTime+"). Please set a date.");
  })();

  var historyPopup=(function(){
    if(!showHistory||!editId) return null;
    var cur=bookings.find(function(b){return b.id===editId;});
    var hist=cur&&cur.history&&cur.history.length>0?cur.history:[];
    var reversed=hist.slice().reverse();
    return RC(Overlay,{onClose:function(){setShowHistory(false);}},
      RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:12,color:S.text}},"Booking history"),
      RC("div",{style:{fontSize:13,color:S.muted,marginBottom:12}},cur.name+" — "+cur.date+" "+cur.time),
      RC("div",{style:{maxHeight:300,overflowY:"auto",borderRadius:14,border:"2px solid rgba(160,170,190,0.4)",background:"rgba(255,255,255,0.35)",padding:"10px 12px",boxShadow:"inset 0 1px 4px rgba(0,0,0,0.06)"}},
        reversed.length?reversed.map(function(h,i){
          var d=new Date(h.at);
          var dateStr=d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
          var timeStr=d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
          return RC("div",{key:i,style:{fontSize:12,color:S.muted,padding:"6px 0",borderBottom:i<reversed.length-1?"1px solid rgba(160,170,190,0.25)":"none"}},
            RC("span",{style:{fontWeight:600,color:S.text}},dateStr+" "+timeStr),
            " — ",
            RC("span",{style:{color:"#0369a1",fontWeight:600}},h.by||"staff"),
            RC("div",{style:{marginTop:2,color:S.text}},h.action));
        }):RC("div",{style:{fontSize:12,color:S.muted}},"No history yet.")),
      RC("div",{style:{display:"flex",justifyContent:"flex-end",marginTop:14}},
        RC("button",{style:mkBtn({minHeight:40,padding:"8px 18px",background:"#64748b"}),onClick:function(){setShowHistory(false);}},"Close")));
  })();

  var errorEl=error?RC("div",{style:{color:"#991b1b",fontSize:13,padding:"10px 14px",background:"rgba(254,226,226,0.7)",borderRadius:14,border:"2px solid rgba(252,165,165,0.55)",marginBottom:14}},error):null;

  // v14 p7: reminder banners. Recomputed each render (cheap). nowMins ticks
  // every minute; reminderTick forces re-render every 30s for snooze-expiry.
  // Uses TODAY (not viewDate) — reminders are operational, not tied to the
  // day being viewed. So a reminder fires at 21:00 regardless of whether
  // staff are looking at tomorrow's timeline.
  var reminderTodayStr=new Date().toISOString().slice(0,10);
  var activeReminderBanners=getActiveReminderBanners(reminders,reminderFires,reminderTodayStr,nowMins);
  // One row per active fire slot, stacked vertically. Amber (distinct from the
  // green success toasts and red error banners), with Done + Snooze actions.
  var reminderBanners=activeReminderBanners.length?RC("div",{style:{marginBottom:10}},
    activeReminderBanners.map(function(ab){
      return RC("div",{key:ab.fireKey,style:{background:"rgba(254,243,199,0.8)",border:"2px solid rgba(251,191,36,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:6,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}},
        RC("div",{style:{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0,flexWrap:"wrap"}},
          RC("span",{style:{fontSize:14,fontWeight:700,color:"#78350f"}},"\u23f0 Reminder"),
          RC("span",{style:{fontSize:11,padding:"2px 8px",borderRadius:6,background:"rgba(146,64,14,0.15)",color:"#78350f",fontWeight:700,letterSpacing:"0.02em",whiteSpace:"nowrap"}},ab.time),
          RC("span",{style:{fontSize:14,color:"#78350f",fontWeight:700,wordBreak:"break-word"}},ab.reminder.text)),
        RC("div",{style:{display:"flex",gap:6,flexShrink:0}},
          RC("button",{onClick:function(){snoozeReminderFire(ab.fireKey);},style:mkBtn({fontSize:12,minHeight:34,padding:"4px 12px",background:BTN.nav})},"Snooze 15m"),
          RC("button",{onClick:function(){markReminderDone(ab.fireKey);},style:{background:"rgba(22,101,52,0.8)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:"#fff",minHeight:34,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Done")));
    })):null;

  var reshuffledBanner=reshuffled?RC("div",{style:{background:"rgba(254,249,195,0.7)",border:"2px solid rgba(253,230,138,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#854d0e",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},optimizerActiveFor(viewDate,autoOptimizer)?"Tables re-optimised.":"Booking saved."):null;
  var ineffBanner=(!reshuffled&&inefficient&&dismissedIneff!==viewDate&&optimizerActiveFor(viewDate,autoOptimizer))?RC("div",{style:{background:"rgba(255,237,213,0.7)",border:"2px solid rgba(253,186,116,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#9a3412",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},RC("span",null,"Tables could be reshuffled for better efficiency."),RC("div",{style:{display:"flex",gap:6}},RC("button",{onClick:function(){setDismissedIneff(viewDate);},style:mkBtn({fontSize:13,minHeight:36,padding:"6px 14px",background:BTN.dismiss})},"Dismiss"),RC("button",{onClick:function(){setConfirmReshuffle(true);},style:{background:BTN.orange,color:"#fff",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"6px 14px",cursor:"pointer",fontSize:13,fontWeight:600,minHeight:36,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Reshuffle"))):null;

  // Overlap warnings banner — shows when one or more seated guests are overstaying
  // into the start time of a booking on the same table. Each row shows a one-tap
  // Reassign button that reroutes the crowded-out booking to a free table without
  // disturbing anyone else. Visible regardless of view (timeline or list).
  var overlapEntries=Object.keys(overlapWarnings).map(function(sbId){
    var w=overlapWarnings[sbId];
    var sb=bookings.find(function(b){return b.id===sbId;});
    if(!sb) return null;
    var rowBg=w.overdue?"rgba(254,226,226,0.6)":"rgba(255,237,213,0.6)";
    var rowBrd=w.overdue?"rgba(252,165,165,0.55)":"rgba(253,186,116,0.55)";
    var rowTxt=w.overdue?"#991b1b":"#9a3412";
    var msg=sb.name+" (overstaying) → "+w.next+" at "+w.nextTime+(w.overdue?" — overdue":" — in "+w.gap+" min");
    return RC("div",{key:sbId,style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",padding:"8px 12px",borderRadius:12,background:rowBg,border:"1px solid "+rowBrd,marginTop:6}},
      RC("span",{style:{fontSize:13,color:rowTxt,fontWeight:600,flex:"1 1 auto",minWidth:0}},msg),
      RC("button",{onClick:function(){reassignBooking(w.nextId);},style:mkBtn({fontSize:12,minHeight:32,padding:"4px 12px",background:BTN.orange})},"Reassign "+w.next));
  }).filter(Boolean);
  var overlapBanner=overlapEntries.length?RC("div",{style:{background:"rgba(255,250,235,0.55)",border:"2px solid rgba(253,186,116,0.45)",borderRadius:14,padding:"10px 14px",marginBottom:10,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
    RC("div",{style:{fontSize:13,fontWeight:700,color:"#9a3412",marginBottom:2}},"Overlap warnings"),
    overlapEntries):null;

  var resetDurBtn=form.customDur?RC("button",{key:"rd",style:mkBtn({fontSize:12,background:BTN.reset}),onPointerDown:function(){setForm(function(f){return Object.assign({},f,{customDur:null});})}},  "Reset"):null;
  var endTime=form.time?toTime(toMins(form.time)+dur):"--";


  var mainView=view==="timeline"
    ?RC(TimelineView,{bookings:bookings,date:viewDate,onEdit:openEdit,onManual:function(id){setManualTarget(id);},onStatus:updateStatus,blocks:tableBlocks,onBlock:function(id){setBlockTarget(id);},nowMins:nowMins,warnings:overlapWarnings,zoom:timelineZoom,setZoom:setTimelineZoom,scrollPosRef:timelineScrollRef,followNow:followNow,setFollowNow:setFollowNow,autoOptimizer:autoOptimizer,setAutoOptimizer:setAutoOptimizer,onReshuffle:function(){setConfirmReshuffle(true);},onOpenSettings:function(){setShowSettings(true);}})
    :RC(ListView,{bookings:bookings,date:viewDate,onEdit:openEdit,onStatus:updateStatus,onDelete:function(id){setConfirmDel(id);},onManual:function(id){setManualTarget(id);},nowMins:nowMins,warnings:overlapWarnings});

  var formModal=showForm?RC(Overlay,{onClose:function(){setShowForm(false);}},
    RC("div",{style:{textAlign:"center",marginBottom:16}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:form.returnOf?"rgba(22,101,52,0.8)":"rgba(0,122,255,0.75)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},editId?"Edit booking":(form.returnOf?"New booking (Book Again)":"New booking"))),
    returnOfBanner,
    RC(Section,null,
      RC("div",{style:{display:"grid",gridTemplateColumns:formCols,gap:12}},
        RC(Fld,{label:"Customer name",req:true},RC("input",{value:form.name,onChange:function(e){setForm(function(f){return Object.assign({},f,{name:e.target.value});});},placeholder:"Full name",style:inp()})),
        RC(Fld,{label:"Phone number"},RC("input",{type:"tel",value:form.phone,onChange:function(e){setForm(function(f){return Object.assign({},f,{phone:e.target.value});});},onFocus:function(e){var el=e.target;if(!el.value) setForm(function(f){return Object.assign({},f,{phone:"+"});});setTimeout(function(){el.selectionStart=el.selectionEnd=el.value.length;},0);},placeholder:"+34 600 000 000",style:inp()})))),
    RC(Section,null,
      RC("div",{style:{display:"grid",gridTemplateColumns:formCols,gap:12}},
        RC(Fld,{label:"Date"},RC("input",{type:"date",value:form.date,onChange:function(e){setForm(function(f){return Object.assign({},f,{date:e.target.value});});},style:inp()})),
        RC(Fld,{label:"Time"},RC("input",{type:"time",value:form.time,onChange:function(e){setForm(function(f){return Object.assign({},f,{time:e.target.value});});},min:"13:00",max:"22:00",style:inp()})),
        RC(Fld,{label:"Seating preference"},RC("select",{value:form.preference,onChange:function(e){setForm(function(f){return Object.assign({},f,{preference:e.target.value});});},style:inp()},RC("option",{value:"auto"},"Auto (recommended)"),RC("option",{value:"indoor"},"Indoor"),RC("option",{value:"outdoor"},"Outdoor"))),
        RC(Fld,{label:"Number of guests"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
          RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.max(1,(Number(form.size)||2)-1);setForm(function(f){return Object.assign({},f,{size:v});});}},"-"),
          RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},String(Number(form.size)||2)),
          RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.min(25,(Number(form.size)||2)+1);setForm(function(f){return Object.assign({},f,{size:v});});}},"+"))),
        RC(Fld,{label:"Duration"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
          RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.max(15,Math.min(480,dur-15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}},"-"),
          RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},dur+" min"),
          RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.max(15,Math.min(480,dur+15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}},"+"),
          RC("span",{style:{fontSize:13,color:S.text,marginLeft:4}},"End: "+endTime),
          resetDurBtn)))),
    kitchenSection,
    tablesBtn,
    availBanner,
    quickStatusBtns,
    RC(Section,null,
      RC(Fld,{label:"Notes"},RC("textarea",{value:form.notes,onChange:function(e){setForm(function(f){return Object.assign({},f,{notes:e.target.value});});},rows:2,placeholder:"Allergies, special requests...",style:Object.assign({},inp(),{resize:"vertical"})}))),
    errorEl,
    RC("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:18,flexWrap:"wrap"}},
      RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap"}},historyBtn,bookAgainBtn),
      RC("div",{style:{display:"flex",gap:8}},
        RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:function(){setShowForm(false);}},"Cancel"),
        (function(){
          // v14 p1 (Issue 3): Save is disabled when date is empty. Prevents the
          // dd.mm.yyyy placeholder state from being submitted (esp. via Book Again
          // where we intentionally clear the date to force staff to pick one).
          var canSave=!!form.date;
          return RC("button",{disabled:!canSave,onClick:save,style:{background:canSave?"rgba(0,122,255,0.8)":"rgba(180,180,190,0.4)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 22px",cursor:canSave?"pointer":"not-allowed",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:canSave?"0 2px 8px rgba(0,122,255,0.25), inset 0 1px 1px rgba(255,255,255,0.2)":"none"}},"Save booking");
        })()))):null;

  var delModal=confirmDel?RC(Overlay,{onClose:function(){setConfirmDel(null);}},
    RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}},"Delete booking?"),
    RC("div",{style:{fontSize:14,color:S.text,marginBottom:18}},"Tables will be re-optimised after deletion."),
    RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8}},
      RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:function(){setConfirmDel(null);}},"Cancel"),
      RC("button",{onClick:function(){delBooking(confirmDel);},style:{background:"#dc2626",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Delete"))):null;

  var manualModal=manualBooking?RC(ManualModal,{booking:manualBooking,bookings:manualTarget==="__new__"?bookings.filter(function(b){return b.date===form.date;}):bookings,blocks:tableBlocks,onSave:function(tables,locked,affected){if(manualTarget==="__new__"){setForm(function(f){return Object.assign({},f,{manualTables:tables});});setSwapAffected(affected||null);setManualTarget(null);}else{manualAssign(manualBooking.id,tables,locked,affected);}},onClose:function(){setManualTarget(null);}}):null;

  var walkinModal=(function(){
    if(!showWalkin) return null;
    var wf=walkinForm;
    var wSize=Number(wf.size)||2;
    var wTime=wf.time||nowTime();
    var wDur=wf.customDur||getDur(wSize);
    var wDate=new Date().toISOString().slice(0,10);
    var wS=toMins(wTime),wE=wS+wDur;
    var wOther=liveBookings.filter(function(b){return b&&b.date===wDate&&b.status!=="cancelled"&&(b.tables||[]).length>0;}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+(b.duration||90)};}).concat(getBlockSlots(tableBlocks,wDate));
    var wBusy=getBusy(wOther,wS,wE);
    var wAutoCheck=(function(){
      var pre=findBest(wSize,"auto",wS,wE,wOther)||(findBestAny(wSize,wS,wE,wOther));
      if(pre) return null;
      var noResh=!optimizerActiveFor(wDate,autoOptimizer);
      var sugg=findTimes(wDate,wSize,"auto",liveBookings,wDur,wS,tableBlocks,null,noResh);
      return formatSugg(sugg,wS);
    })();
    function getCapOf(ids){if(ids.length===0) return 0;var k=ids.slice().sort().join("|");var c=VALID_COMBOS.find(function(x){return x.ids.slice().sort().join("|")===k;});if(c) return c.cap;var bestCap=0,bestIds=[];VALID_COMBOS.forEach(function(combo){if(combo.ids.length<=ids.length&&combo.ids.every(function(id){return ids.includes(id);})&&combo.cap>bestCap){bestCap=combo.cap;bestIds=combo.ids;}});if(bestIds.length>0){var rem=ids.filter(function(id){return !bestIds.includes(id);});return bestCap+rem.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);}return ids.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);}
    function wToggle(id){
      if(wBusy.has(id)) return;
      var sel=wf.tables||[];
      if(sel.includes(id)){setWalkinForm(function(f){return Object.assign({},f,{tables:sel.filter(function(x){return x!==id;})});});return;}
      var next=sel.concat([id]);
      var h1=next.includes("i1"),h4=next.includes("i4"),h2=next.includes("i2"),h3=next.includes("i3");
      if(h1&&h4&&(!h2||!h3)) return;
      if(sel.length>0&&getCapOf(sel)>=wSize){
        var trimmed=sel.slice();
        while(trimmed.length>0&&getCapOf(trimmed)>=wSize){trimmed=trimmed.slice(1);}
        next=trimmed.concat([id]);
        h1=next.includes("i1");h4=next.includes("i4");h2=next.includes("i2");h3=next.includes("i3");
        if(h1&&h4&&(!h2||!h3)) return;
      }
      setWalkinForm(function(f){return Object.assign({},f,{tables:next});});
    }
    var wSel=wf.tables||[];
    var wCap=getCapOf(wSel);
    var wOk=wSel.length>0&&wCap>=wSize;
    var wSummaryColor=wOk?"#166534":"#9a3412";
    var wSummaryText=wSel.length===0?"Select tables below.":"Capacity: "+wCap+(wCap>=wSize?" (fits "+wSize+" pax)":" — need "+wSize+" pax");
    var wClearBtn=wSel.length>0?RC("button",{key:"clr",style:mkBtn({fontSize:12,padding:"6px 12px",background:BTN.clear}),onClick:function(){setWalkinForm(function(f){return Object.assign({},f,{tables:[]});});}},"Clear"):null;
    var wKitchenLoad=getKitchenLoad(bookings,wDate,wTime,wDur,null);
    var wKitchenStarts=wKitchenLoad.starts+1;
    var wKitchenGuests=wKitchenLoad.guests+wSize;
    var wKitchenBusy=wKitchenStarts>=KITCHEN_TABLE_LIMIT;
    var wKitchenSugg=wKitchenBusy?findKitchenFriendlyTimes(bookings,wDate,wSize,"auto",wDur,wTime,null,tableBlocks):null;
    function wRenderKT(arr){
      if(!arr||!arr.length) return null;
      return arr.map(function(r){return RC("span",{key:r.timeStr,onClick:function(){setWalkinForm(function(f){return Object.assign({},f,{tables:[],time:r.timeStr});});},style:{cursor:"pointer",padding:"3px 8px",borderRadius:6,fontWeight:600,fontSize:12,background:r.hasTables?"rgba(220,252,231,0.8)":"rgba(254,249,195,0.8)",color:r.hasTables?"#166534":"#854d0e",border:"1px solid "+(r.hasTables?"rgba(134,239,172,0.5)":"rgba(253,230,138,0.5)"),boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}},r.timeStr);});
    }
    var wKitchenSection=RC("div",{style:{padding:"10px 14px",borderRadius:14,border:"2px solid "+(wKitchenBusy?"rgba(253,186,116,0.55)":"rgba(255,255,255,0.45)"),background:wKitchenBusy?"rgba(255,237,213,0.6)":"rgba(255,255,255,0.35)",marginBottom:14,fontSize:13,color:wKitchenBusy?"#9a3412":S.muted}},
      RC("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center"}},
        RC("span",null,RC("span",{style:{fontWeight:700}},"Starting at this time: "),wKitchenStarts+" booking"+(wKitchenStarts!==1?"s":"")+" · "+wKitchenGuests+" guest"+(wKitchenGuests!==1?"s":"")),
        wKitchenBusy?RC("span",{style:{fontWeight:700,color:"#dc2626",fontSize:13,padding:"4px 12px",borderRadius:8,border:"1.5px solid rgba(220,38,38,0.4)",flexShrink:0}},"Kitchen busy"):null),
      wKitchenSugg&&(wKitchenSugg.before.length||wKitchenSugg.after.length)?RC("div",{style:{marginTop:8}},
        RC("div",{style:{fontSize:11,color:S.muted,marginBottom:6}},RC("span",{style:{background:"rgba(220,252,231,0.8)",color:"#166534",padding:"2px 6px",borderRadius:6,fontSize:10,fontWeight:600}},"green")," = tables available  ",RC("span",{style:{background:"rgba(254,249,195,0.8)",color:"#854d0e",padding:"2px 6px",borderRadius:6,fontSize:10,fontWeight:600}},"yellow")," = kitchen ok, tables tight"),
        wKitchenSugg.before.length?RC("div",{style:{marginBottom:4}},RC("span",{style:{fontWeight:700,fontSize:12}},"Before: "),RC("span",{style:{display:"inline-flex",gap:4,flexWrap:"wrap"}},wRenderKT(wKitchenSugg.before))):null,
        wKitchenSugg.after.length?RC("div",null,RC("span",{style:{fontWeight:700,fontSize:12}},"After: "),RC("span",{style:{display:"inline-flex",gap:4,flexWrap:"wrap"}},wRenderKT(wKitchenSugg.after))):null):
      wKitchenBusy?RC("div",{style:{marginTop:6,fontSize:12,color:"#991b1b"}},"No kitchen-friendly alternatives found nearby."):null);
    return RC(Overlay,{onClose:function(){setShowWalkin(false);}},
      RC("div",{style:{textAlign:"center",marginBottom:4}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"rgba(22,101,52,0.75)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Walk-in")),
      RC("div",{style:{fontSize:13,color:S.text,marginBottom:16,textAlign:"center"}},"Walk-in "+getNextWalkinNum()+" · Seated"),
      RC(Section,null,
        RC("div",{style:{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}},
          RC(Fld,{label:"Time"},RC("input",{type:"time",value:wTime,onChange:function(e){setWalkinForm(function(f){return Object.assign({},f,{tables:[],time:e.target.value});});},min:"13:00",max:"22:00",style:mkInp()})),
          RC(Fld,{label:"Number of guests"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
            RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();setWalkinForm(function(f){return Object.assign({},f,{size:Math.max(1,(Number(f.size)||2)-1),tables:[]});});}},"-"),
            RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},String(wSize)),
            RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();setWalkinForm(function(f){return Object.assign({},f,{size:Math.min(25,(Number(f.size)||2)+1),tables:[]});});}},"+"))),
          RC(Fld,{label:"Duration"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
            RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();setWalkinForm(function(f){var cd=f.customDur||getDur(Number(f.size)||2);return Object.assign({},f,{customDur:Math.max(15,cd-15)});});}},"-"),
            RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},wDur+" min"),
            RC("button",{style:{background:"rgba(235,239,246,0.95)",border:"1px solid rgba(210,218,230,0.8)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();setWalkinForm(function(f){var cd=f.customDur||getDur(Number(f.size)||2);return Object.assign({},f,{customDur:Math.min(480,cd+15)});});}},"+"),
            RC("span",{style:{fontSize:13,color:S.muted,marginLeft:4}},"End: "+toTime(toMins(wTime)+wDur)),
            wf.customDur?RC("button",{style:mkBtn({fontSize:12,background:BTN.reset}),onPointerDown:function(e){e.preventDefault();setWalkinForm(function(f){return Object.assign({},f,{customDur:null});});}},"Reset"):null)),
        RC(Fld,{label:"Notes",style:{marginTop:12}},RC("textarea",{value:wf.notes,onChange:function(e){setWalkinForm(function(f){return Object.assign({},f,{notes:e.target.value});});},rows:2,placeholder:"Special requests...",style:Object.assign({},mkInp(),{resize:"vertical"})})))),
      RC("div",{style:{fontSize:13,color:S.text,marginBottom:14}},"Tap tables to select / deselect."),
      RC("div",{style:{marginBottom:14,padding:"12px 14px",borderRadius:14,background:"rgba(255,255,255,0.35)",border:"2px solid "+(wOk?"rgba(134,239,172,0.6)":"rgba(255,255,255,0.5)"),display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
        RC("div",null,
          RC("div",{style:{fontSize:14,fontWeight:700,color:S.text}},"Selected: "+(wSel.length?wSel.join(" + "):"none")),
          RC("div",{style:{fontSize:13,color:wSummaryColor,fontWeight:500,marginTop:2}},wSummaryText)),
        wClearBtn),
      RC(TableGrid,{selected:wSel,toggle:wToggle,busy:wBusy,seatedBusy:new Set(),swapBusy:false}),
      wAutoCheck&&wSel.length===0?RC(AvailBanner,{msg:"No tables available at "+wTime+".",sugg:wAutoCheck,warn:true,onTapTime:function(t){setWalkinForm(function(f){return Object.assign({},f,{tables:[],time:t});});}}):null,
      walkinError?RC("div",{style:{color:"#991b1b",fontSize:13,padding:"10px 14px",background:"rgba(254,226,226,0.7)",borderRadius:14,border:"2px solid rgba(252,165,165,0.55)",marginBottom:14}},walkinError):null,
      wKitchenSection,
      RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,marginTop:18}},
        RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:function(){setShowWalkin(false);}},"Cancel"),
        RC("button",{onClick:saveWalkin,disabled:!wOk,style:{background:wOk?"rgba(22,101,52,0.8)":"rgba(180,180,190,0.4)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 22px",cursor:wOk?"pointer":"not-allowed",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:wOk?"0 2px 8px rgba(22,101,52,0.2), inset 0 1px 1px rgba(255,255,255,0.15)":"none"}},"Seat")));
  })();

  return RC("div",{style:{background:"linear-gradient(135deg, #e8edf5 0%, #dfe6f0 20%, #e2e0ef 40%, #dce8f0 60%, #e5eaf2 80%, #e0e4ee 100%)",minHeight:"100dvh",padding:isMobile?"12px 12px calc(12px + env(safe-area-inset-bottom))":"16px",fontFamily:"-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",color:S.text,boxSizing:"border-box"}},
    RC("div",{style:{maxWidth:1000,margin:"0 auto"}},
      RC("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}},
        RC("div",null,RC("div",{style:{fontSize:isMobile?18:22,fontWeight:700}},"Me Gustas T\u00fa"),RC("div",{style:{fontSize:12,color:S.text,fontWeight:500}},"4 indoor  9 outdoor  "+OPEN+":00 - "+CLOSE+":00")),
        RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap"}},
          ["timeline","list"].map(function(v){return RC("button",{key:v,onClick:function(){setView(v);},style:mkBtn({background:view===v?S.accent:"rgba(120,130,150,0.55)",textTransform:"capitalize",minHeight:40})},v);}),
          RC("button",{onClick:openWalkin,style:{background:"rgba(22,101,52,0.75)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:600,color:"#fff",minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Walk-in"),
          RC("button",{onClick:openNew,style:{background:"rgba(0,122,255,0.75)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:600,color:"#fff",minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"+ New"),
          RC("button",{onClick:function(){signOut(auth);},style:mkBtn({fontSize:12,minHeight:40,padding:"8px 14px",background:"rgba(120,130,150,0.5)"})},"Log out"))),
      RC("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}},
        RC("div",{style:{display:"flex",gap:4,alignItems:"center"}},
          RC("button",{onClick:function(){var d=new Date(viewDate);d.setDate(d.getDate()-1);setViewDate(d.toISOString().slice(0,10));},style:mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize:18,background:BTN.nav}),dangerouslySetInnerHTML:{__html:"&#8249;"}}),
          RC("button",{onClick:function(){var d=new Date(viewDate);d.setDate(d.getDate()+1);setViewDate(d.toISOString().slice(0,10));},style:mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize:18,background:BTN.nav}),dangerouslySetInnerHTML:{__html:"&#8250;"}}),
          RC("input",{type:"date",value:viewDate,onChange:function(e){setViewDate(e.target.value);},style:{fontSize:14,padding:"8px 10px",borderRadius:12,border:"1px solid rgba(255,255,255,0.4)",background:"rgba(255,255,255,0.45)",color:S.text,fontWeight:600,minWidth:130,minHeight:40,boxSizing:"border-box",boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"}})),
        RC("div",{style:{display:"flex",gap:6,alignItems:"center"}},
          viewDate!==new Date().toISOString().slice(0,10)?RC("button",{onClick:function(){setViewDate(new Date().toISOString().slice(0,10));},style:mkBtn({minHeight:40,padding:"6px 14px",background:BTN.today})},"Today"):null,
          RC("span",{style:{fontSize:13,color:S.text}},dayCount+" booking"+(dayCount!==1?"s":"")))),
      !isOnline?RC("div",{style:{background:"rgba(254,243,199,0.85)",border:"2px solid rgba(252,211,77,0.7)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"#92400e",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},"⚠ Working offline — your changes are saved locally and will sync when the connection returns. Keep this tab open."):null,
      reconnectShown?RC("div",{style:{background:"rgba(219,234,254,0.85)",border:"2px solid rgba(147,197,253,0.7)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#1e40af",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},"✓ Reconnected — changes synced."):null,
      loadBannerShown?RC("div",{style:{background:"rgba(220,252,231,0.8)",border:"2px solid rgba(134,239,172,0.6)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#166534",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},"Firebase connected — "+(firstLoadCount.current||0)+" booking"+(firstLoadCount.current===1?"":"s")+" loaded."):null,
      writeWarning?RC("div",{style:{background:"rgba(254,226,226,0.85)",border:"2px solid rgba(252,165,165,0.7)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"#991b1b",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},RC("span",null,"⚠ "+writeWarning),RC("button",{style:mkBtn({fontSize:12,background:"#78828c",minHeight:32,padding:"4px 12px"}),onClick:function(){setWriteWarning(null);}},"Dismiss")):null,
      reshuffledBanner,
      ineffBanner,
      overlapBanner,
      reminderBanners,
      mainView,
      formModal,delModal,manualModal,walkinModal,prefPickerModal,
      blockTarget?RC(BlockModal,{tableId:blockTarget,date:viewDate,blocks:tableBlocks,onSave:addBlock,onRemove:removeBlock,onClose:function(){setBlockTarget(null);}}):null,
      confirmCancel?RC(Overlay,{onClose:function(){setConfirmCancel(null);}},
        RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}},"Cancel booking?"),
        RC("div",{style:{fontSize:14,color:S.text,marginBottom:18}},"Tables will be re-optimised after cancellation."),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}},
          RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setConfirmCancel(null);}},"Back"),
          RC("button",{onClick:function(){doCancelBooking(confirmCancel,true);setShowForm(false);},style:{background:"#9a3412",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"No show"),
          RC("button",{onClick:function(){doCancelBooking(confirmCancel,false);setShowForm(false);},style:{background:BLOCK_BG.cancelled,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Cancel booking"))):null,
      confirmKitchen?RC(Overlay,{onClose:function(){setConfirmKitchen(null);}},
        RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:"#9a3412"}},"Kitchen may be busy"),
        RC("div",{style:{fontSize:14,color:S.text,marginBottom:12}},"There are already "+(confirmKitchen==="walkin"?(function(){var wf=walkinForm;var t=wf.time||nowTime();var d=wf.customDur||getDur(Number(wf.size)||2);var l=getKitchenLoad(bookings,new Date().toISOString().slice(0,10),t,d,null);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})():(function(){var f=formRef.current;var d=f.customDur||getDur(Number(f.size)||2);var l=getKitchenLoad(bookings,f.date,f.time,d,editId);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})())+" starting at this time. Check the suggested alternatives below, or confirm to proceed anyway."),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}},
          RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setConfirmKitchen(null);}},"Back"),
          RC("button",{onClick:function(){var isW=confirmKitchen==="walkin";setConfirmKitchen(null);if(isW) doSaveWalkin();else doSave();},style:{background:"#9a3412",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Confirm"))):null,
      confirmReshuffle?RC(Overlay,{onClose:function(){setConfirmReshuffle(false);}},
        RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:"#9a3412"}},"Reshuffle all bookings?"),
        RC("div",{style:{fontSize:14,color:S.text,marginBottom:18}},"Confirmed bookings may be moved to different tables to improve efficiency. Seated bookings will not be moved."),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}},
          RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setConfirmReshuffle(false);}},"Back"),
          RC("button",{onClick:function(){setConfirmReshuffle(false);forceReshuffle();},style:{background:BTN.orange,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Reshuffle"))):null,
      // v14 preview 3: Settings modal. Opened by the cog icon in TimelineView's
      // legend row or by pressing `?` anywhere no modal is open.
      // v14 preview 7: now tabbed (General / Reminders / Shortcuts). Tab state
      // resets to 'general' on close so reopens feel fresh.
      showSettings?RC(Overlay,{onClose:function(){setShowSettings(false);setSettingsTab("general");}},
        RC("div",{style:{textAlign:"center",marginBottom:14}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"rgba(120,130,150,0.75)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Settings")),
        RC(SettingsContent,{
          tab:settingsTab,setTab:setSettingsTab,
          reminders:reminders,
          onAddReminder:openNewReminder,
          onEditReminder:openEditReminder,
          onDeleteReminder:deleteReminder,
          onToggleReminder:toggleReminderActive
        }),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",marginTop:18}},
          RC("button",{style:mkBtn({minHeight:40,padding:"8px 18px",background:"#64748b"}),onClick:function(){setShowSettings(false);setSettingsTab("general");}},"Close"))):null,
      // v14 p7 fix: in-app reminder-delete confirmation (replaces broken
      // window.confirm which is blocked in sandboxed preview environments).
      // Renders on top of Settings in DOM order so it visually covers the list.
      confirmReminderDel?RC(Overlay,{onClose:function(){setConfirmReminderDel(null);}},
        RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}},"Delete reminder?"),
        RC("div",{style:{fontSize:14,color:S.text,marginBottom:18}},"This reminder will be permanently removed."),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}},
          RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setConfirmReminderDel(null);}},"Back"),
          RC("button",{onClick:function(){doDeleteReminder(confirmReminderDel);},style:{background:BTN.del,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Delete"))):null,
      // v14 p7: Reminder editor modal — sits on top of Settings (z=250 vs 200).
      reminderEditor?RC(ReminderEditor,{
        draft:reminderEditor.draft,
        setDraft:function(d){setReminderEditor(function(prev){return prev?Object.assign({},prev,{draft:d}):null;});},
        onSave:saveReminderFromEditor,
        onCancel:function(){setReminderEditor(null);},
        isNew:reminderEditor.id==="new"
      }):null,
      historyPopup));
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen(){
  var es=useState("");var email=es[0],setEmail=es[1];
  var ps=useState("");var password=ps[0],setPassword=ps[1];
  var ers=useState("");var error=ers[0],setError=ers[1];
  var ls=useState(false);var loading=ls[0],setLoading=ls[1];
  function handleLogin(){
    if(!email||!password){setError("Please enter email and password.");return;}
    setLoading(true);setError("");
    signInWithEmailAndPassword(auth,email,password).then(function(){setLoading(false);}).catch(function(err){
      setLoading(false);
      if(err.code==="auth/invalid-credential"||err.code==="auth/wrong-password"||err.code==="auth/user-not-found") setError("Invalid email or password.");
      else if(err.code==="auth/too-many-requests") setError("Too many attempts. Please wait a moment.");
      else setError("Login failed. Please try again.");
    });
  }
  function handleKey(e){if(e.key==="Enter") handleLogin();}
  return RC("div",{style:{background:"linear-gradient(135deg, #e8edf5 0%, #dfe6f0 20%, #e2e0ef 40%, #dce8f0 60%, #e5eaf2 80%, #e0e4ee 100%)",minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",color:S.text}},
    RC("div",{style:{background:"rgba(255,255,255,0.55)",backdropFilter:"blur(40px)",WebkitBackdropFilter:"blur(40px)",borderRadius:20,border:"1px solid rgba(255,255,255,0.5)",padding:"32px 28px",width:"100%",maxWidth:360,boxShadow:"0 8px 40px rgba(0,0,0,0.10), inset 0 1px 1px rgba(255,255,255,0.8)"}},
      RC("div",{style:{fontSize:22,fontWeight:700,color:S.text,marginBottom:4}},"Me Gustas T\u00fa"),
      RC("div",{style:{fontSize:14,color:S.muted,marginBottom:24}},"Staff login"),
      RC("div",{style:{display:"flex",flexDirection:"column",gap:12}},
        RC("input",{type:"email",value:email,onChange:function(e){setEmail(e.target.value);},onKeyDown:handleKey,placeholder:"Email",style:mkInp()}),
        RC("input",{type:"password",value:password,onChange:function(e){setPassword(e.target.value);},onKeyDown:handleKey,placeholder:"Password",style:mkInp()}),
        error?RC("div",{style:{color:"#991b1b",fontSize:13,padding:"8px 12px",background:"rgba(254,226,226,0.7)",borderRadius:12,border:"2px solid rgba(252,165,165,0.55)"}},error):null,
        RC("button",{onClick:handleLogin,disabled:loading,style:Object.assign({},mkBtn({fontSize:15,minHeight:44,padding:"12px"}),{background:"rgba(0,122,255,0.75)",opacity:loading?0.7:1,cursor:loading?"wait":"pointer"})},loading?"Logging in...":"Log in"))));
}

// ── Auth Wrapper ──────────────────────────────────────────────────────────────
export default function App(){
  var us=useState(null);var user=us[0],setUser=us[1];
  var cs=useState(true);var checking=cs[0],setChecking=cs[1];
  useEffect(function(){
    var unsub=onAuthStateChanged(auth,function(u){setUser(u);setChecking(false);});
    return unsub;
  },[]);
  if(checking) return RC("div",{style:{background:"linear-gradient(135deg, #e8edf5 0%, #dfe6f0 20%, #e2e0ef 40%, #dce8f0 60%, #e5eaf2 80%, #e0e4ee 100%)",minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",color:S.text,fontSize:15}},"Loading...");
  if(!user) return RC(LoginScreen,null);
  return RC(BookingApp,null);
}
