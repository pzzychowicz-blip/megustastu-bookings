import React from "react";
import { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { db, auth } from "./firebase";

var INDOOR=[{id:"i1",capacity:2},{id:"i2",capacity:2},{id:"i3",capacity:2},{id:"i4",capacity:2}];
var OUTDOOR=[{id:"1A",capacity:2},{id:"1B",capacity:2},{id:"2",capacity:2},{id:"3",capacity:2},{id:"4",capacity:2},{id:"5A",capacity:2},{id:"5B",capacity:2},{id:"6",capacity:2},{id:"7",capacity:4}];
var ALL_TABLES=INDOOR.concat(OUTDOOR);
var TIMELINE_TABLES=OUTDOOR.concat(INDOOR);
var VALID_COMBOS=[
  {ids:["7"],cap:4},
  {ids:["1A","1B"],cap:5},{ids:["1A","1B","7"],cap:8},
  {ids:["2","3"],cap:4},{ids:["3","4"],cap:4},{ids:["2","3","4"],cap:9},
  {ids:["5A","5B"],cap:4},{ids:["5B","6"],cap:4},{ids:["5A","5B","6"],cap:8},
  {ids:["i2","i3"],cap:4},{ids:["i3","i4"],cap:4},{ids:["i2","i3","i4"],cap:8},
  {ids:["i1","i2"],cap:4},{ids:["i1","i3"],cap:4},
  {ids:["i1","i2","i3"],cap:6},{ids:["i1","i2","i4"],cap:6},{ids:["i1","i3","i4"],cap:6},
  {ids:["i1","i2","i3","i4"],cap:10},
  {ids:["1A","1B","7","i1"],cap:11},{ids:["1A","1B","7","i2"],cap:10},{ids:["1A","1B","7","i3"],cap:10},{ids:["1A","1B","7","i4"],cap:10},
  {ids:["1A","1B","7","i1","i2"],cap:12},{ids:["1A","1B","7","i1","i3"],cap:12},{ids:["1A","1B","7","i1","i4"],cap:12},{ids:["1A","1B","7","i2","i3"],cap:12},{ids:["1A","1B","7","i3","i4"],cap:12},
  {ids:["1A","1B","7","i1","i2","i3"],cap:14},{ids:["1A","1B","7","i1","i2","i4"],cap:14},{ids:["1A","1B","7","i1","i3","i4"],cap:14},{ids:["1A","1B","7","i2","i3","i4"],cap:14},
  {ids:["1A","1B","7","i1","i2","i3","i4"],cap:16},
  {ids:["1A","1B","7","2","3","4"],cap:17},{ids:["1A","1B","7","5A","5B","6"],cap:16},
  {ids:["1A","1B","7","2","3"],cap:13},{ids:["1A","1B","7","3","4"],cap:13},
  {ids:["1A","1B","7","5A","5B"],cap:12},{ids:["1A","1B","7","5B","6"],cap:12},
  {ids:["2","3","4","5A","5B","6"],cap:17},{ids:["2","3","4","5A","5B"],cap:13},{ids:["2","3","4","5B","6"],cap:13},
  {ids:["1A","1B","7","2","3","4","5A","5B","6"],cap:25},{ids:["1A","1B","7","2","3","4","5A","5B"],cap:21},{ids:["1A","1B","7","2","3","4","5B","6"],cap:21},
];
var CLUSTERS={"1A":["1A","1B","7"],"1B":["1A","1B","7"],"7":["1A","1B","7"],"2":["2","3","4"],"3":["2","3","4"],"4":["2","3","4"],"5A":["5A","5B","6"],"5B":["5A","5B","6"],"6":["5A","5B","6"],"i1":["i1"],"i2":["i2","i3","i4"],"i3":["i2","i3","i4"],"i4":["i2","i3","i4"]};
var OPEN=13,CLOSE=22,GRID_CLOSE=23;
var QUARTER_HOURS=Array.from({length:(GRID_CLOSE-OPEN)*4},function(_,i){return OPEN*60+i*15;});
var ROW_H=44,LABEL_W=58;
var STATUS_COLORS={confirmed:{bg:"#fef9c3",text:"#854d0e",border:"#fde68a"},seated:{bg:"#dcfce7",text:"#166534",border:"#86efac"},completed:{bg:"#f1f5f9",text:"#64748b",border:"#cbd5e1"},cancelled:{bg:"#fee2e2",text:"#991b1b",border:"#fca5a5"}};
var S={bg:"#fdf6e3",card:"#fff8ec",border:"#e6d9b8",muted:"#a08c6e",text:"#3d2e1a",accent:"#b07d3a"};
var EMPTY_FORM={name:"",phone:"+",date:new Date().toISOString().slice(0,10),time:"13:00",size:2,preference:"auto",notes:"",status:"confirmed",customDur:null,manualTables:[]};

function getDur(s){return s<=1?60:s<5?90:120;}
function toMins(t){var p=t.split(":");return Number(p[0])*60+Number(p[1]);}
function toTime(m){return String(Math.floor(m/60)%24).padStart(2,"0")+":"+String(m%60).padStart(2,"0");}
function overlaps(s1,e1,s2,e2){return s1<e2&&e1>s2;}
function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function sanitize(b){if(!b||typeof b!=="object") return null;return {id:b.id||genId(),name:b.name||"",phone:b.phone||"",date:b.date||"",time:b.time||"13:00",size:Number(b.size)||2,duration:Number(b.duration)||90,preference:b.preference||"auto",notes:b.notes||"",status:b.status||"confirmed",tables:Array.isArray(b.tables)?b.tables:[],customDur:b.customDur||null,_manual:!!b._manual,_locked:!!b._locked,_conflict:!!b._conflict};}
function sanitizeAll(arr){if(!arr) return [];if(!Array.isArray(arr)){var vals=Object.values(arr);return vals.map(sanitize).filter(Boolean);}return arr.map(sanitize).filter(Boolean);}
function isIn(id){return id.startsWith("i");}
function isAllIn(ids){return ids.every(isIn);}
function isAllOut(ids){return ids.every(function(id){return !isIn(id);});}
function isMixedLarge(ids){if(!ids.some(isIn)||!ids.some(function(id){return !isIn(id);})) return false;return ids.includes("1A")&&ids.includes("1B")&&ids.includes("7");}
function comboOk(ids,pref){var mixed=!isAllIn(ids)&&!isAllOut(ids);if(mixed&&pref!=="auto") return false;if(mixed&&!isMixedLarge(ids)) return false;if(pref==="indoor") return isAllIn(ids);if(pref==="outdoor") return isAllOut(ids);return true;}
function comboCap(ids){var k=ids.slice().sort().join("|");var c=VALID_COMBOS.find(function(x){return x.ids.slice().sort().join("|")===k;});return c?c.cap:ids.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);}
function isLocked(b){return b&&(b._locked===true||b.status==="seated"||b.status==="completed");}
function getBusy(slots,s,e){var busy=new Set();slots.forEach(function(sl){if(!overlaps(s,e,sl.s,sl.e)) return;sl.tables.forEach(function(id){busy.add(id);});});return busy;}
function canAssign(ids,slots,s,e){
  var busy=getBusy(slots,s,e);
  if(ids.some(function(id){return busy.has(id);})) return false;
  if(ids.length<2) return true;
  var mc={};ids.forEach(function(id){var cl=CLUSTERS[id];if(!cl||cl.length<2) return;var k=cl.slice().sort().join("|");if(!mc[k]) mc[k]=0;mc[k]++;});
  for(var i=0;i<slots.length;i++){var sl=slots[i];if(!overlaps(s,e,sl.s,sl.e)||sl.tables.length<2) continue;var tc={};sl.tables.forEach(function(id){var cl=CLUSTERS[id];if(!cl||cl.length<2) return;var k=cl.slice().sort().join("|");if(!tc[k]) tc[k]=0;tc[k]++;});var ks=Object.keys(mc);for(var j=0;j<ks.length;j++){if(mc[ks[j]]>=2&&tc[ks[j]]&&tc[ks[j]]>=2) return false;}}
  return true;
}
function _hasI1(c){return c.ids.indexOf("i1")>=0?1:0;}
function findBest(size,pref,s,e,slots){
  var sg=ALL_TABLES.filter(function(t){return t.capacity>=size&&comboOk([t.id],pref)&&canAssign([t.id],slots,s,e);});
  var co=VALID_COMBOS.filter(function(c){return c.cap>=size&&comboOk(c.ids,pref)&&canAssign(c.ids,slots,s,e);}).sort(function(a,b){return _hasI1(a)-_hasI1(b)||a.cap-b.cap||a.ids.length-b.ids.length;});
  if(size<=2){var n7=sg.filter(function(t){return t.id!=="7";});if(pref==="outdoor"||pref==="auto"){var out=n7.filter(function(t){return !isIn(t.id);});if(out.length) return [out[0].id];}if(pref==="indoor"||pref==="auto"){var i234=n7.filter(function(t){return t.id==="i2"||t.id==="i3"||t.id==="i4";});if(i234.length) return [i234[0].id];}if(n7.length) return [n7[0].id];if(sg.length) return [sg[0].id];if(co.length) return co[0].ids;return null;}
  if(size<=4){if(canAssign(["7"],slots,s,e)&&comboOk(["7"],pref)) return ["7"];if(co.length) return co[0].ids;if(sg.length) return [sg[0].id];return null;}
  if(co.length) return co[0].ids;
  return null;
}
function findBestAny(size,s,e,slots){
  var r=findBest(size,"outdoor",s,e,slots)||findBest(size,"indoor",s,e,slots);
  if(r) return r;
  var busy=getBusy(slots,s,e);
  var mx=VALID_COMBOS.filter(function(c){return c.cap>=size&&c.ids.every(function(id){return !busy.has(id);})&&isMixedLarge(c.ids)&&canAssign(c.ids,slots,s,e);}).sort(function(a,b){return _hasI1(a)-_hasI1(b)||a.cap-b.cap||a.ids.length-b.ids.length;});
  return mx.length?mx[0].ids:null;
}
function findTimes(date,size,pref,existing,dur,around){
  var slots=existing.filter(function(b){return b.date===date&&b.status!=="cancelled";}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+b.duration};});
  var times=Array.from({length:(CLOSE-OPEN)*4},function(_,i){return OPEN*60+i*15;});
  var valid=times.filter(function(s){var e=s+dur;if(e>CLOSE*60) return false;var t=findBest(size,pref,s,e,slots);if(!t&&pref==="auto") t=findBestAny(size,s,e,slots);return !!t;});
  if(!around) return valid;
  return valid.filter(function(s){return s<around;}).concat(valid.filter(function(s){return s>around;}));
}
function optimise(bookings,date){
  var day=bookings.filter(function(b){return b&&b.date===date&&b.status!=="cancelled";}).sort(function(a,b){var la=isLocked(a)?0:1,lb=isLocked(b)?0:1;if(la!==lb) return la-lb;var pa=a.preference!=="auto"?0:1,pb=b.preference!=="auto"?0:1;if(pa!==pb) return pa-pb;if(b.size!==a.size) return b.size-a.size;return toMins(a.time)-toMins(b.time);});
  var slots=[],assigned={};
  day.forEach(function(b){if(!b||!b.time) return;var s=toMins(b.time),e=s+(b.duration||90);var tables;if(isLocked(b)){tables=b.tables;}else{tables=findBest(b.size||2,b.preference||"auto",s,e,slots);if(!tables) tables=findBestAny(b.size||2,s,e,slots);}assigned[b.id]=tables||null;if(tables) slots.push({tables:tables,s:s,e:e});});
  return assigned;
}
function applyOpt(bookings,date){
  var map=optimise(bookings,date);
  return bookings.map(function(b){if(b.date!==date||b.status==="cancelled") return Object.assign({},b);var tables=isLocked(b)?b.tables:(map[b.id]||[]);return Object.assign({},b,{tables:tables,_conflict:!tables||!tables.length});});
}
function verifyClean(bookings,date){
  var day=bookings.filter(function(b){return b.date===date&&b.status!=="cancelled"&&(b.tables||[]).length>0;});
  for(var i=0;i<day.length;i++){for(var j=i+1;j<day.length;j++){var a=day[i],b=day[j];var as=toMins(a.time),ae=as+a.duration,bs=toMins(b.time),be=bs+b.duration;if(!overlaps(as,ae,bs,be)) continue;if(!canAssign(b.tables,[{tables:a.tables,s:as,e:ae}],bs,be)) return false;}}
  return true;
}
function checkInefficent(bookings,date){
  var day=bookings.filter(function(b){return b.date===date&&b.status!=="cancelled"&&!isLocked(b);});
  return day.some(function(b){var oth=day.filter(function(x){return x.id!==b.id;}).map(function(x){return {tables:x.tables,s:toMins(x.time),e:toMins(x.time)+x.duration};});var best=findBest(b.size,b.preference,toMins(b.time),toMins(b.time)+b.duration,oth);return best&&best.length<(b.tables||[]).length;});
}
function useWinW(){var ws=useState(typeof window!=="undefined"?window.innerWidth:1024);var w=ws[0],setW=ws[1];useEffect(function(){function h(){setW(window.innerWidth);}window.addEventListener("resize",h);return function(){window.removeEventListener("resize",h);};});return w;}

// ── Style helpers ─────────────────────────────────────────────────────────────
function mkInp(){return {width:"100%",boxSizing:"border-box",background:S.bg,border:"0.5px solid "+S.border,borderRadius:8,padding:"10px 12px",fontSize:16,color:S.text,fontWeight:500};}
function mkBtn(extra){return Object.assign({border:"0.5px solid "+S.border,background:"transparent",borderRadius:8,padding:"8px 14px",cursor:"pointer",fontSize:13,color:S.text,minHeight:40},extra||{});}
var RC=React.createElement;

// ── Tiny UI atoms ─────────────────────────────────────────────────────────────
function Overlay(props){
  var mob=typeof window!=="undefined"&&window.innerWidth<600;
  var lockRef=useRef(false);
  useEffect(function(){
    if(!mob) return;
    var orig=document.body.style.overflow;
    document.body.style.overflow="hidden";
    lockRef.current=true;
    return function(){document.body.style.overflow=orig;lockRef.current=false;};
  });
  if(mob){
    return RC("div",{style:{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:200}},
      RC("div",{style:{position:"absolute",top:0,left:0,right:0,bottom:0,background:S.card,overflowY:"scroll",WebkitOverflowScrolling:"touch"}},
        RC("div",{style:{minHeight:"100%",padding:"16px 18px",paddingTop:"max(16px, env(safe-area-inset-top))",paddingBottom:"max(80px, calc(40px + env(safe-area-inset-bottom)))",boxSizing:"border-box"}},props.children)));
  }
  return RC("div",{style:{position:"fixed",inset:0,background:"rgba(61,46,26,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:12},onClick:function(e){if(e.target===e.currentTarget)props.onClose();}},
    RC("div",{style:{background:S.card,borderRadius:12,border:"0.5px solid "+S.border,padding:"20px",width:"100%",maxWidth:580,maxHeight:"90dvh",overflowY:"auto",boxSizing:"border-box"}},props.children));
}
function Fld(props){
  var starEl=props.req?RC("span",{style:{color:"#dc2626"}},"*"):null;
  return RC("div",{style:Object.assign({display:"flex",flexDirection:"column",gap:4},props.style||{})},
    RC("label",{style:{fontSize:13,color:"#6b5740",fontWeight:700}},props.label,starEl),props.children);
}
function Section(props){
  return RC("div",{style:Object.assign({background:S.bg,border:"0.5px solid "+S.border,borderRadius:10,padding:"14px",marginBottom:14},props.style||{})},props.children);
}
function SBadge(props){var c=STATUS_COLORS[props.status]||STATUS_COLORS.confirmed;return RC("span",{style:{fontSize:12,padding:"4px 10px",borderRadius:8,background:c.bg,color:c.text,border:"0.5px solid "+c.border,fontWeight:700,textTransform:"capitalize",display:"inline-block"}},props.status);}
function TBadge(props){var id=props.id,indoor=isIn(id);return RC("span",{style:{fontSize:12,padding:"4px 10px",borderRadius:8,background:indoor?"#ede9fe":"#fef3c7",color:indoor?"#5b21b6":"#92400e",border:"0.5px solid "+(indoor?"#c4b5fd":"#fcd34d"),fontWeight:700,display:"inline-block"}},id);}
function SmallTag(props){return RC("span",{style:Object.assign({fontSize:11,padding:"3px 8px",borderRadius:8,fontWeight:700,display:"inline-block"},props.style||{})},props.label);}
function Toggle(props){return RC("button",{onClick:props.onClick,style:{width:48,height:26,borderRadius:13,border:"none",cursor:"pointer",background:props.on?S.accent:"#d1d5db",position:"relative",flexShrink:0}},RC("div",{style:{position:"absolute",top:3,left:props.on?24:3,width:20,height:20,borderRadius:10,background:"#fff"}}));}


// ── Manual Modal ──────────────────────────────────────────────────────────
function ManualModal(props){
  var booking=props.booking,bookings=props.bookings,onSave=props.onSave,onClose=props.onClose,titleText=props.titleText;
  var ss=useState(booking&&booking.tables?booking.tables.slice():[]);var selected=ss[0],setSelected=ss[1];
  var sbs=useState(false);var swapBusy=sbs[0],setSwapBusy=sbs[1];
  if(!booking) return null;
  var needed=booking.size||2;
  var s=toMins(booking.time||"13:00"),e=s+(booking.duration||90);
  var otherBookings=bookings.filter(function(b){return b&&b.id!==booking.id&&b.date===booking.date&&b.status!=="cancelled"&&(b.tables||[]).length>0;});
  var otherSlots=otherBookings.map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+(b.duration||90),status:b.status,id:b.id,name:b.name};});
  var busy=getBusy(otherSlots,s,e);
  var seatedBusy=new Set();otherSlots.forEach(function(sl){if(!overlaps(s,e,sl.s,sl.e)) return;if(sl.status==="seated") sl.tables.forEach(function(id){seatedBusy.add(id);});});
  function isBlocked(id){if(!busy.has(id)) return false;if(swapBusy&&!seatedBusy.has(id)) return false;return true;}
  function getCapOf(ids){if(ids.length===0) return 0;var k=ids.slice().sort().join("|");var c=VALID_COMBOS.find(function(x){return x.ids.slice().sort().join("|")===k;});return c?c.cap:ids.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);}
  function toggle(id){
    if(isBlocked(id)) return;
    // Deselecting
    if(selected.includes(id)){setSelected(selected.filter(function(x){return x!==id;}));return;}
    // Adding
    var next=selected.concat([id]);
    // i1/i4 constraint
    var h1=next.includes("i1"),h4=next.includes("i4"),h2=next.includes("i2"),h3=next.includes("i3");
    if(h1&&h4&&(!h2||!h3)) return;
    // If current selection already has enough capacity, drop the oldest table to make room
    if(selected.length>0&&getCapOf(selected)>=needed){
      // Drop from the front (oldest selected) until adding the new one makes sense
      var trimmed=selected.slice();
      while(trimmed.length>0&&getCapOf(trimmed)>=needed){trimmed=trimmed.slice(1);}
      next=trimmed.concat([id]);
      // Re-check i1/i4 constraint after trim
      h1=next.includes("i1");h4=next.includes("i4");h2=next.includes("i2");h3=next.includes("i3");
      if(h1&&h4&&(!h2||!h3)) return;
    }
    setSelected(next);
  }
  // Find which bookings will be affected by the swap
  var affectedBookings=[];
  if(swapBusy&&selected.length>0){
    otherSlots.forEach(function(sl){
      if(!overlaps(s,e,sl.s,sl.e)||sl.status==="seated") return;
      var taken=sl.tables.filter(function(id){return selected.includes(id);});
      if(taken.length>0) affectedBookings.push({name:sl.name,id:sl.id,tables:taken});
    });
  }
  var groups=[
    {name:"Tables: 1A / 1B / 7",color:"#92400e",bg:"#fef3c7",border:"#fcd34d",note:"1A=3, 1B=2, 7=3 joined (standalone 4)",tables:[{id:"1A",cap:2},{id:"1B",cap:2},{id:"7",cap:4}]},
    {name:"Tables: 2 / 3 / 4",color:"#065f46",bg:"#d1fae5",border:"#6ee7b7",note:"Full cluster seats 9",tables:[{id:"2",cap:2},{id:"3",cap:2},{id:"4",cap:2}]},
    {name:"Tables: 5A / 5B / 6",color:"#1e40af",bg:"#dbeafe",border:"#93c5fd",note:"Each seats 2 individually",tables:[{id:"5A",cap:2},{id:"5B",cap:2},{id:"6",cap:2}]},
    {name:"Tables: i2 / i3 / i4",color:"#5b21b6",bg:"#ede9fe",border:"#c4b5fd",note:"Join these first",tables:[{id:"i2",cap:2},{id:"i3",cap:2},{id:"i4",cap:2}]},
    {name:"Table: i1",color:"#5b21b6",bg:"#ede9fe",border:"#c4b5fd",note:"Add only when extra capacity needed",tables:[{id:"i1",cap:2}]},
  ];
  var cap=getCapOf(selected);
  var slotsForConflict=otherSlots.filter(function(sl){return !swapBusy||sl.status==="seated";});
  var conflict=selected.length>=2&&!canAssign(selected,slotsForConflict,s,e);
  var ok=selected.length>0&&cap>=needed&&!conflict;
  var summaryColor=conflict?"#991b1b":ok?"#166534":"#9a3412";
  var summaryText=selected.length===0?"Select tables below.":conflict?"Conflict: cannot use these tables together.":"Capacity: "+cap+(cap>=needed?" (fits "+needed+" pax)":" — need "+needed+" pax");
  var clearBtn=selected.length>0?RC("button",{key:"clr",style:mkBtn({fontSize:12,padding:"6px 12px"}),onClick:function(){setSelected([]);}},"Clear"):null;
  var isSwapping=affectedBookings.length>0;
  var assignLabel=isSwapping?"Swap & Assign":"Assign";
  var affectedEl=isSwapping?RC("div",{style:{marginTop:8,padding:"10px 14px",borderRadius:8,background:"#fff7ed",border:"0.5px solid #fed7aa"}},
    RC("div",{style:{fontSize:13,fontWeight:700,color:"#9a3412",marginBottom:4}},"Will reassign:"),
    affectedBookings.map(function(ab){return RC("div",{key:ab.id,style:{fontSize:12,color:"#9a3412"}},ab.name+" — losing table "+(ab.tables.join(", ")));})):null;
  var groupEls=groups.map(function(grp){
    var noteEl=grp.note?RC("div",{key:"note",style:{fontSize:12,color:"#6b5740",marginBottom:6,fontStyle:"italic"}},grp.note):null;
    var tableEls=grp.tables.map(function(t){
      var blocked=isBlocked(t.id),isSel=selected.includes(t.id),isBusyT=busy.has(t.id);
      var bg=isSel?grp.bg:blocked?"#fee2e2":isBusyT?"#fff7ed":S.bg;
      var clr=isSel?grp.color:blocked?"#991b1b":isBusyT?"#9a3412":S.text;
      var brd="2px solid "+(isSel?grp.color:blocked?"#fca5a5":isBusyT?"#fed7aa":grp.border);
      var subClr=isSel?grp.color:S.muted;
      var label=blocked?"busy":isBusyT?"swap":"cap "+t.cap;
      return RC("button",{key:t.id,onClick:function(){toggle(t.id);},style:{minWidth:60,minHeight:48,padding:"8px 16px",borderRadius:8,border:brd,background:bg,color:clr,fontWeight:700,fontSize:14,cursor:blocked?"not-allowed":"pointer",opacity:blocked?0.55:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}},
        RC("span",null,t.id),RC("span",{style:{fontSize:10,fontWeight:500,color:subClr}},label));
    });
    return RC("div",{key:grp.name,style:{marginBottom:16}},
      RC("div",{style:{fontSize:13,fontWeight:700,color:grp.color,marginBottom:2}},grp.name),
      noteEl,
      RC("div",{style:{display:"flex",gap:8,flexWrap:"wrap"}},tableEls));
  });
  var swapBg=swapBusy?"#fff7ed":S.bg;
  var swapBrd="0.5px solid "+(swapBusy?"#fed7aa":S.border);
  var swapTitleClr=swapBusy?"#9a3412":S.text;
  var swapSubClr=swapBusy?"#c2410c":S.muted;
  return RC(Overlay,{onClose:onClose},
    RC("div",{style:{fontSize:17,fontWeight:700,color:S.text,marginBottom:4}},titleText||"Manual table assignment"),
    RC("div",{style:{fontSize:13,color:"#6b5740",marginBottom:4}},booking.name+" · "+booking.size+" pax · "+booking.time+"–"+toTime(e)),
    RC("div",{style:{fontSize:13,color:"#6b5740",marginBottom:14}},"Tap tables to select / deselect."),
    RC("div",{style:{marginBottom:14,padding:"12px 14px",borderRadius:8,background:S.bg,border:"0.5px solid "+(conflict?"#fca5a5":ok?"#86efac":S.border),display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}},
      RC("div",null,
        RC("div",{style:{fontSize:14,fontWeight:700,color:S.text}},"Selected: "+(selected.length?selected.join(" + "):"none")),
        RC("div",{style:{fontSize:13,color:summaryColor,fontWeight:500,marginTop:2}},summaryText)),
      clearBtn),
    affectedEl,
    RC("div",null,groupEls),
    RC("div",{style:{marginTop:14,marginBottom:4,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:8,background:swapBg,border:swapBrd}},
      RC("div",null,RC("div",{style:{fontSize:13,fontWeight:700,color:swapTitleClr}},"Swap busy"),RC("div",{style:{fontSize:11,color:swapSubClr,marginTop:2}},"Reassign confirmed bookings to other tables (not seated)")),
      RC(Toggle,{on:swapBusy,onClick:function(){setSwapBusy(function(v){return !v;});}})),
    RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}},
      RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px"}),onClick:onClose},"Cancel"),
      RC("button",{disabled:!ok,onClick:function(){if(ok)onSave(selected,true,isSwapping?affectedBookings:null);},style:{background:ok?(isSwapping?"#9a3412":S.accent):"#ccc",border:"none",borderRadius:8,padding:"10px 20px",cursor:ok?"pointer":"not-allowed",fontSize:14,fontWeight:700,color:"#fff",minHeight:44}},assignLabel)));
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function TimelineView(props){
  var bookings=props.bookings,date=props.date,onEdit=props.onEdit,onManual=props.onManual;
  var day=bookings.filter(function(b){return b.date===date&&b.status!=="cancelled";});
  var totalMins=(GRID_CLOSE-OPEN)*60;
  var unassigned=day.filter(function(b){return !(b.tables||[]).length||b._conflict;});
  function pct(mins){return ((mins-OPEN*60)/totalMins)*100+"%";}
  function GridLines(){
    var lines=QUARTER_HOURS.map(function(m){var isH=m%60===0;return RC("div",{key:m,style:{position:"absolute",top:0,bottom:0,left:pct(m),borderLeft:isH?"1px solid #c8b99a":"0.5px solid #ddd0b8",opacity:isH?0.7:0.4}});});
    lines.push(RC("div",{key:"end",style:{position:"absolute",top:0,bottom:0,right:0,borderLeft:"1px solid #c8b99a",opacity:0.7}}));
    return RC("div",{style:{position:"absolute",inset:0}},lines);
  }
  function Block(bp){
    var b=bp.b;var sm=toMins(b.time)-OPEN*60;var left=pct(OPEN*60+sm);var w=Math.max((b.duration/totalMins)*100,0.5)+"%";
    var c=STATUS_COLORS[b.status]||STATUS_COLORS.confirmed;
    var lbl=b.name+" ("+b.size+")"+(isLocked(b)?" [L]":"");
    return RC("div",{onClick:function(){onEdit(b);},style:{position:"absolute",top:3,height:ROW_H-8+"px",left:left,width:w,background:c.bg,border:"0.5px solid "+c.border,borderRadius:6,overflow:"hidden",display:"flex",alignItems:"center",boxSizing:"border-box",cursor:"pointer"}},
      RC("span",{style:{flex:1,padding:"0 8px",fontSize:11,fontWeight:700,color:c.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}},lbl),
      RC("span",{onClick:function(e){e.stopPropagation();onManual(b.id);},style:{padding:"0 6px",fontSize:13,cursor:"pointer",color:c.text,opacity:0.7,borderLeft:"0.5px solid "+c.border,height:"100%",display:"flex",alignItems:"center",minWidth:28}},"="));
  }
  var headerLines=QUARTER_HOURS.concat([GRID_CLOSE*60]).map(function(m){var isH=m%60===0;return RC("div",{key:"l"+m,style:{position:"absolute",top:0,left:pct(m),bottom:0,borderLeft:isH?"1px solid #c8b99a":"0.5px solid #ddd0b8"}});});
  var headerLabels=QUARTER_HOURS.filter(function(m){return m%60===0&&m<GRID_CLOSE*60;}).map(function(m){var center=((m+30-OPEN*60)/totalMins)*100;return RC("span",{key:"h"+m,style:{position:"absolute",top:4,left:center+"%",transform:"translateX(-50%)",fontSize:10,fontWeight:700,color:"#7a6a52",whiteSpace:"nowrap",pointerEvents:"none",background:"#f0e8d0",padding:"0 3px",zIndex:1}},String(Math.floor(m/60)).padStart(2,"0")+":00");});
  var tableRows=TIMELINE_TABLES.map(function(tbl){var id=tbl.id,indoor=isIn(id);var rows=day.filter(function(b){return (b.tables||[]).includes(id);});return RC("div",{key:id,style:{display:"flex",alignItems:"center",height:ROW_H+"px",borderBottom:"1px solid #c8b99a"}},
    RC("div",{style:{width:LABEL_W+"px",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:6}},RC("span",{style:{fontSize:11,fontWeight:700,padding:"3px 0",borderRadius:8,background:indoor?"#ede9fe":"#fef3c7",color:indoor?"#5b21b6":"#92400e",border:"0.5px solid "+(indoor?"#c4b5fd":"#fcd34d"),width:32,textAlign:"center",display:"inline-block",boxSizing:"border-box"}},id)),
    RC("div",{style:{flex:1,position:"relative",height:"100%"}},RC(GridLines,null),rows.map(function(b){return RC(Block,{key:b.id,b:b});})));});
  var unassignedRow=unassigned.length>0?RC("div",{style:{display:"flex",alignItems:"center",height:ROW_H+"px",borderTop:"1px dashed #fca5a5",marginTop:4}},
    RC("div",{style:{width:LABEL_W+"px",flexShrink:0,fontSize:10,fontWeight:700,color:"#991b1b",textAlign:"right",paddingRight:6}},"unassigned"),
    RC("div",{style:{flex:1,position:"relative",height:"100%"}},RC(GridLines,null),unassigned.map(function(b){return RC(Block,{key:b.id,b:b});}))):null;
  var legendEls=Object.keys(STATUS_COLORS).map(function(s){var c=STATUS_COLORS[s];return RC("span",{key:s,style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:c.bg,color:c.text,border:"0.5px solid "+c.border,fontWeight:700,textTransform:"capitalize"}},s);});
  legendEls.push(RC("span",{key:"in",style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:"#ede9fe",color:"#5b21b6",border:"0.5px solid #c4b5fd",fontWeight:700}},"indoor"));
  legendEls.push(RC("span",{key:"out",style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:"#fef3c7",color:"#92400e",border:"0.5px solid #fcd34d",fontWeight:700}},"outdoor"));
  legendEls.push(RC("span",{key:"hint",style:{fontSize:11,color:S.muted}},"tap to edit  |  = to assign  |  [L] locked"));
  return RC("div",{style:{background:S.card,borderRadius:12,border:"0.5px solid "+S.border,padding:"10px 12px",overflowX:"auto"}},
    RC("div",{style:{minWidth:320,width:"100%",boxSizing:"border-box"}},
      RC("div",{style:{display:"flex",alignItems:"stretch",marginBottom:2}},
        RC("div",{style:{width:LABEL_W+"px",flexShrink:0,background:"#f0e8d0",borderRadius:"6px 0 0 0"}}),
        RC("div",{style:{flex:1,position:"relative",borderBottom:"1px solid #c8b99a",background:"#f0e8d0",borderRadius:"0 6px 0 0",height:24,overflow:"hidden"}},headerLines,headerLabels)),
      RC("div",null,tableRows),
      unassignedRow,
      RC("div",{style:{marginTop:10,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}},legendEls)));
}

// ── List View ─────────────────────────────────────────────────────────────────
function ListView(props){
  var bookings=props.bookings,date=props.date,onEdit=props.onEdit,onStatus=props.onStatus,onDelete=props.onDelete,onManual=props.onManual;
  var day=bookings.filter(function(b){return b.date===date;}).sort(function(a,b){return a.time.localeCompare(b.time);});
  if(!day.length) return RC("div",{style:{textAlign:"center",padding:"48px 0",color:S.muted,fontSize:15}},"No bookings for this date.");
  return RC("div",{style:{display:"flex",flexDirection:"column",gap:10}},day.map(function(b){
    var end=toTime(toMins(b.time)+b.duration);
    var conflictEl=b._conflict?RC("div",{style:{fontSize:13,color:"#991b1b",fontWeight:700,marginBottom:8,background:"#fee2e2",borderRadius:8,padding:"6px 10px"}},"No table assigned — use manual assignment."):null;
    var manualTag=b._manual&&!isLocked(b)?RC(SmallTag,{label:"manual",style:{background:"#e0f2fe",color:"#0369a1",border:"0.5px solid #7dd3fc"}}):null;
    var lockedTag=b._locked?RC(SmallTag,{label:"locked",style:{background:"#fef9c3",color:"#854d0e",border:"0.5px solid #fde68a"}}):null;
    var notesEl=b.notes?RC("div",{style:{fontSize:13,color:S.muted,borderTop:"0.5px solid "+S.border,paddingTop:8,marginTop:8}},b.notes):null;
    var phonEl=b.phone?RC("span",{style:{fontSize:13,color:S.muted,marginLeft:4}},b.phone):null;
    var statusBtns=["confirmed","seated","completed","cancelled"].filter(function(s){return s!==b.status;}).map(function(s){var c=STATUS_COLORS[s];return RC("button",{key:s,style:mkBtn({border:"0.5px solid "+c.border,background:c.bg,color:c.text,fontWeight:700,textTransform:"capitalize"}),onClick:function(){onStatus(b.id,s);}},"> "+s);});
    return RC("div",{key:b.id,style:{background:S.card,border:"0.5px solid "+(b._conflict?"#fca5a5":S.border),borderRadius:12,padding:"14px 16px"}},
      conflictEl,
      RC("div",{style:{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8}},
        RC("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}},
          RC("span",{style:{fontWeight:700,fontSize:16,color:S.text}},b.name),
          RC(SBadge,{status:b.status}),
          RC("span",{style:{fontSize:13,color:S.muted,fontWeight:700}},b.size+" pax"),
          manualTag,lockedTag),
        RC("span",{style:{fontSize:14,fontWeight:700,color:S.muted}},b.time+"–"+end)),
      RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginTop:8}},(b.tables||[]).map(function(t){return RC(TBadge,{key:t,id:t});}),phonEl),
      notesEl,
      RC("div",{style:{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}},
        RC("button",{style:mkBtn({border:"0.5px solid #7dd3fc",color:"#0369a1",fontWeight:700}),onClick:function(){onManual(b.id);}},"= Tables"),
        RC("button",{style:mkBtn(),onClick:function(){onEdit(b);}},"Edit"),
        RC("button",{style:mkBtn({border:"0.5px solid #fca5a5",color:"#dc2626"}),onClick:function(){onDelete(b.id);}},"Delete"),
        statusBtns));
  }));
}

// ── App ───────────────────────────────────────────────────────────────────────
function BookingApp(props){
  var bs=useState([]);var bookings=bs[0],setBookings=bs[1];
  var loaded=useRef(false);
  // Ensure optimal viewport scaling on all devices
  useEffect(function(){
    var meta=document.querySelector('meta[name="viewport"]');
    if(!meta){meta=document.createElement("meta");meta.name="viewport";document.head.appendChild(meta);}
    meta.content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
    document.documentElement.style.cssText="height:100%;overflow:hidden;";
    document.body.style.cssText="height:100%;overflow:auto;margin:0;-webkit-overflow-scrolling:touch;overscroll-behavior:none;";
    return function(){document.documentElement.style.cssText="";document.body.style.cssText="";};
  },[]);
  var remoteUpdate=useRef(false);
  var cleanedUp=useRef(false);
  useEffect(function(){
    var dbRef=ref(db,"bookings");
    var unsub=onValue(dbRef,function(snapshot){
      var data=snapshot.val();
      var all=sanitizeAll(data);
      if(!cleanedUp.current&&all.length>0){
        var cutoff=new Date();cutoff.setDate(cutoff.getDate()-30);
        var cutoffStr=cutoff.toISOString().slice(0,10);
        var fresh=all.filter(function(b){return b&&b.date>=cutoffStr;});
        if(fresh.length<all.length){
          cleanedUp.current=true;
          set(ref(db,"bookings"),fresh);
          return;
        }
      }
      cleanedUp.current=true;
      remoteUpdate.current=true;
      setBookings(all);
      loaded.current=true;
    });
    return unsub;
  },[]);
  useEffect(function(){
    if(!loaded.current) return;
    if(remoteUpdate.current){remoteUpdate.current=false;return;}
    set(ref(db,"bookings"),bookings);
  });

  var vs=useState("timeline");var view=vs[0],setView=vs[1];
  var vds=useState(new Date().toISOString().slice(0,10));var viewDate=vds[0],setViewDate=vds[1];
  var sfs=useState(false);var showForm=sfs[0],setShowForm=sfs[1];
  var fms=useState(EMPTY_FORM);var form=fms[0],setForm=fms[1];
  var eis=useState(null);var editId=eis[0],setEditId=eis[1];
  var ers=useState("");var error=ers[0],setError=ers[1];
  var cds=useState(null);var confirmDel=cds[0],setConfirmDel=cds[1];
  var rss=useState(false);var reshuffled=rss[0],setReshuffled=rss[1];
  var mts=useState(null);var manualTarget=mts[0],setManualTarget=mts[1];
  var dis=useState(null);var dismissedIneff=dis[0],setDismissedIneff=dis[1];
  var formRef=useRef(EMPTY_FORM);
  useEffect(function(){formRef.current=form;},[form]);
  var winW=useWinW();
  var isMobile=winW<600;

  var dayCount=bookings.filter(function(b){return b.date===viewDate&&b.status!=="cancelled";}).length;
  var inefficient=bookings.length>0&&checkInefficent(bookings,viewDate);

  function flash(){setReshuffled(true);setTimeout(function(){setReshuffled(false);},3000);}
  function openNew(){setForm(Object.assign({},EMPTY_FORM,{date:viewDate}));setEditId(null);setError("");setShowForm(true);}
  function openEdit(b){setForm({name:b.name,phone:b.phone||"+",date:b.date,time:b.time,size:b.size,preference:b.preference,notes:b.notes||"",status:b.status,customDur:b.duration!==getDur(b.size)?b.duration:null,manualTables:[]});setEditId(b.id);setError("");setShowForm(true);}

  function save(){
    var f=formRef.current;
    try{
      if(!f.name||!f.name.trim()){setError("Customer name is required.");return;}
      if(!f.time){setError("Please set a time.");return;}
      var sm=toMins(f.time);
      if(sm<OPEN*60||sm>CLOSE*60){setError("Bookings accepted between "+OPEN+":00 and "+CLOSE+":00.");return;}
      var size=Number(f.size)||2;
      var dur=f.customDur||getDur(size);
      var cleanPhone=f.phone&&f.phone.trim()!=="+"?f.phone.trim():"";
      var mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:[];
      if(mt.length){var ex=bookings.filter(function(b){return b.date===f.date&&b.status!=="cancelled"&&b.id!==editId;}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+b.duration};});if(!canAssign(mt,ex,sm,sm+dur)){setError("Selected tables are not available at this time.");return;}}
      if(editId){
        var orig=bookings.find(function(b){return b.id===editId;});
        var needsR=!orig||size!==orig.size||f.time!==orig.time||f.date!==orig.date||f.preference!==orig.preference;
        var upd=bookings.map(function(b){if(b.id!==editId) return b;return Object.assign({},b,{name:f.name,phone:cleanPhone,date:f.date,time:f.time,size:size,duration:dur,preference:f.preference,notes:f.notes,status:f.status,tables:mt.length?mt:(!needsR?b.tables:[]),customDur:f.customDur||null,_manual:mt.length>0,_locked:mt.length>0?true:b._locked});});
        setBookings(applyOpt(upd,f.date));if(needsR) flash();setShowForm(false);setViewDate(f.date);
      } else {
        var newId=genId();
        var nb={id:newId,name:f.name,phone:cleanPhone,date:f.date,time:f.time,size:size,duration:dur,preference:f.preference,notes:f.notes,status:"confirmed",tables:mt.length?mt:[],customDur:f.customDur||null,_manual:mt.length>0,_locked:mt.length>0};
        if(!mt.length){var exSl=bookings.filter(function(b){return b.date===f.date&&b.status!=="cancelled";}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+b.duration};});var pre=findBest(size,f.preference,sm,sm+dur,exSl)||(f.preference==="auto"?findBestAny(size,sm,sm+dur,exSl):null);if(!pre){var sugg=findTimes(f.date,size,f.preference,bookings,dur,sm);setError("No tables available"+(f.preference!=="auto"?" ("+f.preference+" preference)":"")+". "+(sugg.length?"Available slots nearby: "+sugg.map(toTime).join(", "):"No availability found."));return;}}
        var fin=applyOpt(bookings.concat([nb]),f.date);
        if(!mt.length){var ne=fin.find(function(b){return b.id===newId;});if(!ne||(ne.tables||[]).length===0){setError("Could not assign a table — try manual assignment.");return;}}
        setBookings(fin);flash();setShowForm(false);setViewDate(f.date);
      }
    }catch(err){setError("Error: "+err.message);}
  }

  function forceReshuffle(){setBookings(function(b){return applyOpt(b,viewDate);});flash();}
  function delBooking(id){setBookings(function(b){return applyOpt(b.filter(function(x){return x.id!==id;}),viewDate);});setConfirmDel(null);flash();}
  function updateStatus(id,status){setBookings(function(b){var updated=b.map(function(x){if(x.id!==id) return x;var extra={status:status};if(status==="completed"&&x.status==="seated"){extra._locked=true;}return Object.assign({},x,extra);});return applyOpt(updated,viewDate);});}
  function manualAssign(bookingId,tables,locked,affected){
    setBookings(function(b){
      var updated=b.map(function(x){
        if(x.id===bookingId) return Object.assign({},x,{tables:tables,_conflict:false,_manual:true,_locked:locked===true});
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
      // Re-optimize to reassign affected bookings to new tables
      if(affected&&affected.length>0) return applyOpt(updated,viewDate);
      return updated;
    });
    setManualTarget(null);
    if(affected&&affected.length>0) flash();
  }

  var manualBooking=(function(){
    if(!manualTarget) return null;
    if(manualTarget==="__new__"){return {id:"__new__",name:form.name||"New booking",size:Number(form.size)||2,time:form.time||"13:00",duration:form.customDur||getDur(Number(form.size)||2),tables:Array.isArray(form.manualTables)?form.manualTables:[],date:form.date,status:"confirmed",_locked:true};}
    return bookings.find(function(b){return b.id===manualTarget;})||null;
  })();

  // Build form
  var inp=mkInp;
  var formCols=isMobile?"1fr":"1fr 1fr";
  var auto=getDur(Number(form.size));
  var dur=form.customDur||auto;

  var tablesBtn=(function(){
    var mt=Array.isArray(form.manualTables)&&form.manualTables.length>0?form.manualTables:null;
    if(editId){
      var cur=bookings.find(function(b){return b.id===editId;});
      var tbl=mt||(cur&&cur.tables&&cur.tables.length>0?cur.tables:null);
      return RC(Section,null,RC("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}},
        RC("span",{style:{fontSize:13,color:"#6b5740",fontWeight:700}},"Tables"),
        RC("button",{style:mkBtn({border:"0.5px solid #7dd3fc",color:"#0369a1",fontWeight:700}),onClick:function(){setManualTarget(editId);}},"= Assign"),
        tbl?tbl.map(function(id){return RC(TBadge,{key:id,id:id});}):null,
        mt?RC("button",{style:mkBtn({fontSize:12}),onClick:function(){setForm(function(f){return Object.assign({},f,{manualTables:[]});});}},"Clear"):null));
    }
    return RC(Section,null,RC("div",{style:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}},
      RC("span",{style:{fontSize:13,color:"#6b5740",fontWeight:700}},"Tables"),
      RC("button",{style:mkBtn({border:"0.5px solid #7dd3fc",color:"#0369a1",fontWeight:700}),onClick:function(){setManualTarget("__new__");}},"= Assign"),
      mt?mt.map(function(id){return RC(TBadge,{key:id,id:id});}):null,
      mt?RC("button",{style:mkBtn({fontSize:12}),onClick:function(){setForm(function(f){return Object.assign({},f,{manualTables:[]});});}},"Clear"):null));
  })();

  var quickStatusBtns=editId?RC(Section,null,
    RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}},
      RC("span",{style:{fontSize:13,color:"#6b5740",fontWeight:700,marginRight:4}},"Status:"),
      ["confirmed","seated","completed","cancelled"].filter(function(s){return s!==form.status;}).map(function(s){var c=STATUS_COLORS[s];return RC("button",{key:s,style:mkBtn({border:"0.5px solid "+c.border,background:c.bg,color:c.text,fontWeight:700,textTransform:"capitalize",minHeight:40}),onClick:function(){setForm(function(f){return Object.assign({},f,{status:s});});}},"> "+s);}))):null;

  var errorEl=error?RC("div",{style:{color:"#991b1b",fontSize:13,padding:"10px 14px",background:"#fee2e2",borderRadius:10,border:"0.5px solid #fca5a5",marginBottom:14}},error):null;

  var reshuffledBanner=reshuffled?RC("div",{style:{background:"#fef9c3",border:"0.5px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"#854d0e"}},"Tables re-optimised."):null;
  var ineffBanner=(!reshuffled&&inefficient&&dismissedIneff!==viewDate)?RC("div",{style:{background:"#fff7ed",border:"0.5px solid #fed7aa",borderRadius:8,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"#9a3412",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}},RC("span",null,"Tables could be reshuffled for better efficiency."),RC("div",{style:{display:"flex",gap:6}},RC("button",{onClick:function(){setDismissedIneff(viewDate);},style:mkBtn({fontSize:13,fontWeight:700,minHeight:36,padding:"6px 14px",color:"#9a3412",border:"0.5px solid #fed7aa"})},"Dismiss"),RC("button",{onClick:forceReshuffle,style:{background:"#9a3412",color:"#fff",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:13,fontWeight:700,minHeight:36}},"Reshuffle"))):null;

  var resetDurBtn=form.customDur?RC("button",{key:"rd",style:mkBtn({fontSize:12}),onPointerDown:function(){setForm(function(f){return Object.assign({},f,{customDur:null});})}},  "Reset"):null;
  var endTime=form.time?toTime(toMins(form.time)+dur):"--";


  var mainView=view==="timeline"
    ?RC(TimelineView,{bookings:bookings,date:viewDate,onEdit:openEdit,onManual:function(id){setManualTarget(id);}})
    :RC(ListView,{bookings:bookings,date:viewDate,onEdit:openEdit,onStatus:updateStatus,onDelete:function(id){setConfirmDel(id);},onManual:function(id){setManualTarget(id);}});

  var formModal=showForm?RC(Overlay,{onClose:function(){setShowForm(false);}},
    RC("div",{style:{fontSize:18,fontWeight:700,marginBottom:16,color:S.text}},editId?"Edit booking":"New booking"),
    RC(Section,null,
      RC("div",{style:{display:"grid",gridTemplateColumns:formCols,gap:12}},
        RC(Fld,{label:"Customer name",req:true},RC("input",{value:form.name,onChange:function(e){setForm(function(f){return Object.assign({},f,{name:e.target.value});});},placeholder:"Full name",style:inp()})),
        RC(Fld,{label:"Phone number"},RC("input",{type:"tel",value:form.phone,onChange:function(e){setForm(function(f){return Object.assign({},f,{phone:e.target.value});});},placeholder:"+34 600 000 000",style:inp()})))),
    RC(Section,null,
      RC("div",{style:{display:"grid",gridTemplateColumns:formCols,gap:12}},
        RC(Fld,{label:"Date"},RC("input",{type:"date",value:form.date,onChange:function(e){setForm(function(f){return Object.assign({},f,{date:e.target.value});});},style:inp()})),
        RC(Fld,{label:"Time"},RC("input",{type:"time",value:form.time,onChange:function(e){setForm(function(f){return Object.assign({},f,{time:e.target.value});});},min:"13:00",max:"22:00",style:inp()})),
        RC(Fld,{label:"Seating preference"},RC("select",{value:form.preference,onChange:function(e){setForm(function(f){return Object.assign({},f,{preference:e.target.value});});},style:inp()},RC("option",{value:"auto"},"Auto (recommended)"),RC("option",{value:"indoor"},"Indoor"),RC("option",{value:"outdoor"},"Outdoor"))),
        RC(Fld,{label:"Number of guests"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
          RC("button",{style:{background:S.card,border:"0.5px solid "+S.border,borderRadius:8,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},onPointerDown:function(e){e.preventDefault();var v=Math.max(1,(Number(form.size)||2)-1);setForm(function(f){return Object.assign({},f,{size:v});});}},"-"),
          RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},String(Number(form.size)||2)),
          RC("button",{style:{background:S.card,border:"0.5px solid "+S.border,borderRadius:8,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},onPointerDown:function(e){e.preventDefault();var v=Math.min(25,(Number(form.size)||2)+1);setForm(function(f){return Object.assign({},f,{size:v});});}},"+"))),
        RC(Fld,{label:"Duration"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
          RC("button",{style:{background:S.card,border:"0.5px solid "+S.border,borderRadius:8,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},onPointerDown:function(e){e.preventDefault();var v=Math.max(15,Math.min(480,dur-15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}},"-"),
          RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},dur+" min"),
          RC("button",{style:{background:S.card,border:"0.5px solid "+S.border,borderRadius:8,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},onPointerDown:function(e){e.preventDefault();var v=Math.max(15,Math.min(480,dur+15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}},"+"),
          RC("span",{style:{fontSize:13,color:S.muted,marginLeft:4}},"End: "+endTime),
          resetDurBtn)))),
    RC(Section,null,
      RC(Fld,{label:"Notes"},RC("textarea",{value:form.notes,onChange:function(e){setForm(function(f){return Object.assign({},f,{notes:e.target.value});});},rows:2,placeholder:"Allergies, special requests...",style:Object.assign({},inp(),{resize:"vertical"})}))),
    tablesBtn,
    quickStatusBtns,
    errorEl,
    RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,marginTop:18}},
      RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px"}),onClick:function(){setShowForm(false);}},"Cancel"),
      RC("button",{onClick:save,style:{background:S.accent,border:"none",borderRadius:8,padding:"10px 22px",cursor:"pointer",fontSize:14,fontWeight:700,color:"#fff",minHeight:44}},"Save booking"))):null;

  var delModal=confirmDel?RC(Overlay,{onClose:function(){setConfirmDel(null);}},
    RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}},"Delete booking?"),
    RC("div",{style:{fontSize:14,color:S.muted,marginBottom:18}},"Tables will be re-optimised after deletion."),
    RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8}},
      RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px"}),onClick:function(){setConfirmDel(null);}},"Cancel"),
      RC("button",{onClick:function(){delBooking(confirmDel);},style:{background:"#dc2626",border:"none",borderRadius:8,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:700,color:"#fff",minHeight:44}},"Delete"))):null;

  var manualModal=manualBooking?RC(ManualModal,{booking:manualBooking,bookings:manualTarget==="__new__"?bookings.filter(function(b){return b.date===form.date;}):bookings,onSave:function(tables,locked,affected){if(manualTarget==="__new__"){setForm(function(f){return Object.assign({},f,{manualTables:tables});});setManualTarget(null);}else{manualAssign(manualBooking.id,tables,locked,affected);}},onClose:function(){setManualTarget(null);}}):null;

  return RC("div",{style:{background:S.bg,minHeight:"100dvh",padding:isMobile?"12px 12px calc(12px + env(safe-area-inset-bottom))":"16px",fontFamily:"var(--font-sans)",color:S.text,boxSizing:"border-box"}},
    RC("div",{style:{maxWidth:1000,margin:"0 auto"}},
      RC("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}},
        RC("div",null,RC("div",{style:{fontSize:isMobile?18:22,fontWeight:700}},"Me Gustas Tu bookings"),RC("div",{style:{fontSize:12,color:S.muted,fontWeight:500}},"4 indoor  9 outdoor  "+OPEN+":00 - "+CLOSE+":00")),
        RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap"}},
          ["timeline","list"].map(function(v){return RC("button",{key:v,onClick:function(){setView(v);},style:mkBtn({background:view===v?S.border:"transparent",fontWeight:view===v?700:400,textTransform:"capitalize",minHeight:40})},v);}),
          RC("button",{onClick:openNew,style:{background:S.accent,border:"none",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:700,color:"#fff",minHeight:40}},"+ New"),
          RC("button",{onClick:function(){signOut(auth);},style:mkBtn({fontSize:12,color:S.muted})},"Log out"))),
      RC("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:12}},
        RC("button",{onClick:function(){var d=new Date(viewDate);d.setDate(d.getDate()-1);setViewDate(d.toISOString().slice(0,10));},style:mkBtn({minHeight:40,minWidth:40,padding:"6px 14px",fontSize:18,fontWeight:700}),dangerouslySetInnerHTML:{__html:"&#8249;"}}),
        RC("button",{onClick:function(){var d=new Date(viewDate);d.setDate(d.getDate()+1);setViewDate(d.toISOString().slice(0,10));},style:mkBtn({minHeight:40,minWidth:40,padding:"6px 14px",fontSize:18,fontWeight:700}),dangerouslySetInnerHTML:{__html:"&#8250;"}}),
        RC("input",{type:"date",value:viewDate,onChange:function(e){setViewDate(e.target.value);},style:{fontSize:14,padding:"8px 10px",borderRadius:8,border:"0.5px solid "+S.border,background:S.card,color:S.text,fontWeight:700,flex:1,maxWidth:180,minHeight:40}}),
        viewDate!==new Date().toISOString().slice(0,10)?RC("button",{onClick:function(){setViewDate(new Date().toISOString().slice(0,10));},style:mkBtn({fontWeight:700,minHeight:40,padding:"6px 14px"})},"Today"):null,
        RC("span",{style:{fontSize:13,color:S.muted}},dayCount+" booking"+(dayCount!==1?"s":""))),
      reshuffledBanner,
      ineffBanner,
      mainView,
      formModal,delModal,manualModal));
}

// ── Login Screen ─────────────────────────────────────────────────────────────
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
  var RC=React.createElement;
  return RC("div",{style:{background:S.bg,minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"var(--font-sans)"}},
    RC("div",{style:{background:S.card,borderRadius:12,border:"0.5px solid "+S.border,padding:"32px 28px",width:"100%",maxWidth:360}},
      RC("div",{style:{fontSize:22,fontWeight:700,color:S.text,marginBottom:4}},"Me Gustas Tu"),
      RC("div",{style:{fontSize:14,color:S.muted,marginBottom:24}},"Staff login"),
      RC("div",{style:{display:"flex",flexDirection:"column",gap:12}},
        RC("input",{type:"email",value:email,onChange:function(e){setEmail(e.target.value);},onKeyDown:handleKey,placeholder:"Email",style:{width:"100%",boxSizing:"border-box",background:S.bg,border:"0.5px solid "+S.border,borderRadius:8,padding:"12px 14px",fontSize:16,color:S.text}}),
        RC("input",{type:"password",value:password,onChange:function(e){setPassword(e.target.value);},onKeyDown:handleKey,placeholder:"Password",style:{width:"100%",boxSizing:"border-box",background:S.bg,border:"0.5px solid "+S.border,borderRadius:8,padding:"12px 14px",fontSize:16,color:S.text}}),
        error?RC("div",{style:{color:"#991b1b",fontSize:13,padding:"8px 12px",background:"#fee2e2",borderRadius:8}},error):null,
        RC("button",{onClick:handleLogin,disabled:loading,style:{background:S.accent,border:"none",borderRadius:8,padding:"12px",fontSize:15,fontWeight:700,color:"#fff",cursor:loading?"wait":"pointer",opacity:loading?0.7:1,minHeight:44}},loading?"Logging in...":"Log in"))));
}

// ── Auth Wrapper ─────────────────────────────────────────────────────────────
export default function App(){
  var us=useState(null);var user=us[0],setUser=us[1];
  var cs=useState(true);var checking=cs[0],setChecking=cs[1];
  useEffect(function(){
    var unsub=onAuthStateChanged(auth,function(u){setUser(u);setChecking(false);});
    return unsub;
  },[]);
  if(checking) return React.createElement("div",{style:{background:S.bg,minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-sans)",color:S.muted,fontSize:15}},"Loading...");
  if(!user) return React.createElement(LoginScreen,null);
  return React.createElement(BookingApp,null);
}
