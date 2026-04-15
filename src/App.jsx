import React, { useState, useRef, useEffect } from "react";
import { ref, onValue, set } from "firebase/database";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { db, auth } from "./firebase";

var INDOOR=[{id:"i1",capacity:2},{id:"i2",capacity:2},{id:"i3",capacity:2},{id:"i4",capacity:2}];
var OUTDOOR=[{id:"1A",capacity:2},{id:"1B",capacity:2},{id:"2",capacity:2},{id:"3",capacity:2},{id:"4",capacity:2},{id:"5A",capacity:2},{id:"5B",capacity:2},{id:"6",capacity:2},{id:"7",capacity:4}];
var ALL_TABLES=OUTDOOR.concat(INDOOR);
var TIMELINE_TABLES=OUTDOOR.concat(INDOOR);
var VALID_COMBOS=[
  {ids:["1A","1B"],cap:6},
  {ids:["2","3"],cap:5},{ids:["3","4"],cap:4},{ids:["2","3","4"],cap:8},
  {ids:["5A","5B"],cap:5},{ids:["5B","6"],cap:5},{ids:["5A","5B","6"],cap:8},
  {ids:["i2","i3"],cap:6},{ids:["i3","i4"],cap:6},{ids:["i2","i3","i4"],cap:8},
  {ids:["i1","i2","i3","i4"],cap:10},
  {ids:["1A","1B","7","i1"],cap:10},{ids:["1A","1B","7","i2"],cap:10},{ids:["1A","1B","7","i3"],cap:10},{ids:["1A","1B","7","i4"],cap:10},
  {ids:["1A","1B","7","i1","i2"],cap:12},{ids:["1A","1B","7","i1","i3"],cap:12},{ids:["1A","1B","7","i1","i4"],cap:12},{ids:["1A","1B","7","i2","i3"],cap:12},{ids:["1A","1B","7","i3","i4"],cap:12},
  {ids:["1A","1B","7","i1","i2","i3"],cap:14},{ids:["1A","1B","7","i1","i2","i4"],cap:14},{ids:["1A","1B","7","i1","i3","i4"],cap:14},{ids:["1A","1B","7","i2","i3","i4"],cap:14},
  {ids:["1A","1B","7","i1","i2","i3","i4"],cap:16},
  {ids:["1A","1B","7","2","3"],cap:15},{ids:["1A","1B","7","3","4"],cap:14},{ids:["1A","1B","7","2","3","4"],cap:18},
  {ids:["1A","1B","7","5A","5B"],cap:15},{ids:["1A","1B","7","5B","6"],cap:15},{ids:["1A","1B","7","5A","5B","6"],cap:18},
  {ids:["2","3","4","5A","5B","6"],cap:16},{ids:["2","3","4","5A","5B"],cap:13},{ids:["2","3","4","5B","6"],cap:13},{ids:["2","3","4","5A","5B","6","7"],cap:20},
  {ids:["1A","1B","7","2","3","4","5A","5B","6"],cap:26},{ids:["1A","1B","7","2","3","4","5A","5B"],cap:23},{ids:["1A","1B","7","2","3","4","5B","6"],cap:23},
];
var CLUSTERS={"1A":["1A","1B"],"1B":["1A","1B"],"7":["7"],"2":["2","3","4"],"3":["2","3","4"],"4":["2","3","4"],"5A":["5A","5B","6"],"5B":["5A","5B","6"],"6":["5A","5B","6"],"i1":["i1"],"i2":["i2","i3","i4"],"i3":["i2","i3","i4"],"i4":["i2","i3","i4"]};
var OPEN=13,CLOSE=22,GRID_CLOSE=23;
var KITCHEN_TABLE_LIMIT=3;
var QUARTER_HOURS=Array.from({length:(GRID_CLOSE-OPEN)*4},function(_,i){return OPEN*60+i*15;});
var ROW_H=44,LABEL_W=58;
var STATUS_COLORS={confirmed:{bg:"rgba(250,204,21,0.15)",text:"#92400e",border:"rgba(250,204,21,0.35)"},seated:{bg:"rgba(34,197,94,0.15)",text:"#166534",border:"rgba(34,197,94,0.35)"},completed:{bg:"rgba(148,163,184,0.12)",text:"#64748b",border:"rgba(148,163,184,0.3)"},cancelled:{bg:"rgba(239,68,68,0.12)",text:"#991b1b",border:"rgba(239,68,68,0.3)"}};
var BLOCK_BG={confirmed:"rgba(180,130,40,0.85)",seated:"rgba(34,160,80,0.85)",completed:"rgba(140,140,150,0.7)",cancelled:"rgba(200,80,80,0.8)"};
var S={bg:"transparent",card:"rgba(255,255,255,0.45)",border:"rgba(255,255,255,0.35)",muted:"#5a6474",text:"#1a1d24",accent:"#007AFF"};
var TBL={out:{bg:"rgba(0,122,255,0.8)",text:"#fff",border:"rgba(0,122,255,0.5)"},ind:{bg:"rgba(175,82,222,0.8)",text:"#fff",border:"rgba(175,82,222,0.5)"}};
var EMPTY_FORM={name:"",phone:"+",date:new Date().toISOString().slice(0,10),time:"13:00",size:2,preference:"auto",notes:"",status:"confirmed",customDur:null,manualTables:[],preferredTables:[]};

function getDur(s){return s<5?90:120;}
function toMins(t){var p=t.split(":");return Number(p[0])*60+Number(p[1]);}
function toTime(m){return String(Math.floor(m/60)%24).padStart(2,"0")+":"+String(m%60).padStart(2,"0");}
function overlaps(s1,e1,s2,e2){return s1<e2&&e1>s2;}
function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function sanitize(b){if(!b||typeof b!=="object") return null;return {id:b.id||genId(),name:b.name||"",phone:b.phone||"",date:b.date||"",time:b.time||"13:00",size:Number(b.size)||2,duration:Number(b.duration)||90,preference:b.preference||"auto",notes:b.notes||"",status:b.status||"confirmed",tables:Array.isArray(b.tables)?b.tables:[],customDur:b.customDur||null,_manual:!!b._manual,_locked:!!b._locked,_conflict:!!b._conflict,preferredTables:Array.isArray(b.preferredTables)?b.preferredTables:[],history:Array.isArray(b.history)?b.history:[]};}
function histEntry(action,user){return {at:new Date().toISOString(),by:user||"staff",action:action};}
function diffBooking(orig,f,size){var ch=[];if(orig.name!==f.name) ch.push("name "+orig.name+"→"+f.name);if(size!==orig.size) ch.push("size "+orig.size+"→"+size);if(f.time!==orig.time) ch.push("time "+orig.time+"→"+f.time);if(f.date!==orig.date) ch.push("date "+orig.date+"→"+f.date);if(f.preference!==orig.preference) ch.push("pref "+orig.preference+"→"+f.preference);var origPhone=orig.phone||"";var formPhone=f.phone&&f.phone.trim()!=="+"?f.phone.trim():"";if(origPhone!==formPhone) ch.push("phone "+(origPhone||"none")+"→"+(formPhone||"none"));var origDur=orig.duration||90;var formDur=f.customDur||getDur(size);if(origDur!==formDur) ch.push("duration "+origDur+"→"+formDur+"min");if(f.status!==orig.status) ch.push("status "+orig.status+"→"+f.status);if(f.notes!==(orig.notes||"")) ch.push("notes updated");var mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:null;if(mt) ch.push("tables manually set: "+mt.join(", "));if(f._clearManual) ch.push("manual assignment cleared");var pt=Array.isArray(f.preferredTables)?f.preferredTables:[];var origPt=Array.isArray(orig.preferredTables)?orig.preferredTables:[];if(pt.slice().sort().join(",")!==origPt.slice().sort().join(",")) ch.push("preferred tables: "+(pt.length?pt.join(", "):"cleared"));return ch.length?ch.join(", "):"saved (no field changes)";}
function sanitizeAll(arr){if(!arr) return [];if(!Array.isArray(arr)){var vals=Object.values(arr);return vals.map(sanitize).filter(Boolean);}return arr.map(sanitize).filter(Boolean);}
function isIn(id){return id.startsWith("i");}
function isAllIn(ids){return ids.every(isIn);}
function isAllOut(ids){return ids.every(function(id){return !isIn(id);});}
function isMixedLarge(ids){if(!ids.some(isIn)||!ids.some(function(id){return !isIn(id);})) return false;return ids.includes("1A")&&ids.includes("1B")&&ids.includes("7");}
function comboOk(ids,pref){var mixed=!isAllIn(ids)&&!isAllOut(ids);if(mixed&&pref!=="auto") return false;if(mixed&&!isMixedLarge(ids)) return false;if(pref==="indoor") return isAllIn(ids);if(pref==="outdoor") return isAllOut(ids);return true;}
function comboCap(ids){var k=ids.slice().sort().join("|");var c=VALID_COMBOS.find(function(x){return x.ids.slice().sort().join("|")===k;});return c?c.cap:ids.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);}
function isLocked(b){return b&&(b._locked===true||b.status==="seated");}
function isActive(b){return b.status!=="cancelled"&&b.status!=="completed";}
function getBlockSlots(blocks,date){
  return blocks.filter(function(bl){return bl.date===date;}).map(function(bl){
    var s=bl.allDay?OPEN*60:toMins(bl.from);
    var e=bl.allDay?GRID_CLOSE*60:toMins(bl.to);
    return {tables:[bl.tableId],s:s,e:e};
  });
}
function getBusy(slots,s,e){var busy=new Set();slots.forEach(function(sl){if(!overlaps(s,e,sl.s,sl.e)) return;sl.tables.forEach(function(id){busy.add(id);});});return busy;}
function canAssign(ids,slots,s,e){
  var busy=getBusy(slots,s,e);
  if(ids.some(function(id){return busy.has(id);})) return false;
  if(ids.length<2) return true;
  var mc={};ids.forEach(function(id){var cl=CLUSTERS[id];if(!cl||cl.length<2) return;var k=cl.slice().sort().join("|");if(!mc[k]) mc[k]=0;mc[k]++;});
  for(var i=0;i<slots.length;i++){var sl=slots[i];if(!overlaps(s,e,sl.s,sl.e)||sl.tables.length<2) continue;var tc={};sl.tables.forEach(function(id){var cl=CLUSTERS[id];if(!cl||cl.length<2) return;var k=cl.slice().sort().join("|");if(!tc[k]) tc[k]=0;tc[k]++;});var ks=Object.keys(mc);for(var j=0;j<ks.length;j++){if(mc[ks[j]]>=2&&tc[ks[j]]&&tc[ks[j]]>=2) return false;}}
  return true;
}
function _indoorPri(c){if(c.ids.indexOf("i4")>=0) return 2;if(c.ids.indexOf("i1")>=0) return 1;return 0;}
function _comboLoc(c){if(isAllOut(c.ids)) return 0;if(isAllIn(c.ids)) return 1;return 2;}
function _comboPri(c,size){var k=c.ids.slice().sort().join("|");if(k==="1A|1B"&&size>=4&&size<=6) return -10;if(k==="2|3"&&size===4) return -5;if(size>=7&&size<=8){if(k==="2|3|4") return -10;if(k==="5A|5B|6") return -9;}if(size>=9&&size<=12){if(k==="1A|1B|7|i4") return -10;if(k==="1A|1B|7|i1") return -9;if(k==="1A|1B|7|i2"||k==="1A|1B|7|i3") return -7;}if(size>=13&&size<=16){if(c.ids.every(function(id){return ["2","3","4","5A","5B","6"].indexOf(id)>=0;})) return -10;}if(size>=17&&size<=20){if(k==="2|3|4|5A|5B|6|7") return -10;}if(k==="i1|i2|i3|i4") return 100;return 0;}
function findBest(size,pref,s,e,slots){
  var sg=ALL_TABLES.filter(function(t){return t.capacity>=size&&comboOk([t.id],pref)&&canAssign([t.id],slots,s,e);});
  var co=VALID_COMBOS.filter(function(c){return c.cap>=size&&comboOk(c.ids,pref)&&canAssign(c.ids,slots,s,e);}).sort(function(a,b){var pa=_comboPri(a,size),pb=_comboPri(b,size);if(pa!==pb) return pa-pb;var la=_comboLoc(a),lb=_comboLoc(b);if(la!==lb) return la-lb;if(la===2){var ia=_indoorPri(a),ib=_indoorPri(b);if(ia!==ib) return ib-ia;}return a.cap-b.cap||a.ids.length-b.ids.length;});
  if(size<=2){var n7=sg.filter(function(t){return t.id!=="7";});var ind,out;if(size===1){if(pref==="indoor"||pref==="auto"){ind=n7.filter(function(t){return isIn(t.id);});if(ind.length) return [ind[0].id];}if(pref==="outdoor"||pref==="auto"){out=n7.filter(function(t){return !isIn(t.id);});if(out.length) return [out[0].id];}}else{if(pref==="outdoor"||pref==="auto"){out=n7.filter(function(t){return !isIn(t.id);});if(out.length) return [out[0].id];}if(pref==="indoor"||pref==="auto"){ind=n7.filter(function(t){return isIn(t.id);});if(ind.length) return [ind[0].id];}}if(n7.length) return [n7[0].id];if(sg.length) return [sg[0].id];if(co.length) return co[0].ids;return null;}
  if(size<=4){if(canAssign(["7"],slots,s,e)&&comboOk(["7"],pref)) return ["7"];if(co.length) return co[0].ids;if(sg.length) return [sg[0].id];return null;}
  if(co.length) return co[0].ids;
  return null;
}
function findBestAny(size,s,e,slots){
  var r=findBest(size,"outdoor",s,e,slots)||findBest(size,"indoor",s,e,slots);
  if(r) return r;
  var busy=getBusy(slots,s,e);
  var mx=VALID_COMBOS.filter(function(c){return c.cap>=size&&c.ids.every(function(id){return !busy.has(id);})&&isMixedLarge(c.ids)&&canAssign(c.ids,slots,s,e);}).sort(function(a,b){return _indoorPri(b)-_indoorPri(a)||a.cap-b.cap||a.ids.length-b.ids.length;});
  return mx.length?mx[0].ids:null;
}
function trialFits(bookings,date,time,size,pref,dur,blocks,editId,prefTables){
  var trialId=editId||"__trial__";
  var trial={id:trialId,name:"",phone:"",date:date,time:time,size:size,duration:dur,preference:pref||"auto",notes:"",status:"confirmed",tables:[],customDur:null,_manual:false,_locked:false,_conflict:false,preferredTables:Array.isArray(prefTables)?prefTables:[],history:[]};
  var base=editId?bookings.map(function(b){return b.id===editId?trial:b;}):bookings.concat([trial]);
  var result=applyOpt(base,date,blocks);
  var assigned=result.find(function(b){return b.id===trialId;});
  if(!assigned||!assigned.tables||!assigned.tables.length) return null;
  // Displacement check only for new bookings (not edits)
  if(!editId){
    var prevAssigned=bookings.filter(function(b){return b.date===date&&isActive(b)&&b.tables&&b.tables.length>0;});
    var displaced=result.filter(function(b){return b.id!==trialId&&b.date===date&&isActive(b)&&(!b.tables||!b.tables.length||b._conflict);});
    var kicked=displaced.filter(function(d){return prevAssigned.some(function(p){return p.id===d.id;});});
    if(kicked.length>0) return null;
  }
  return assigned.tables;
}
function findTimes(date,size,pref,existing,dur,around,blocks,editId){
  var times=Array.from({length:(CLOSE-OPEN)*4},function(_,i){return OPEN*60+i*15;});
  var aroundM=around||0;
  var valid=times.filter(function(m){
    if(m+dur>CLOSE*60) return false;
    if(m===aroundM) return false;
    return !!trialFits(existing,date,toTime(m),size,pref,dur,blocks,editId);
  });
  return valid;
}
function formatSugg(sugg,around){
  if(!sugg||!sugg.length) return {earlier:[],later:[]};
  var before=sugg.filter(function(s){return s<around;}).slice(-10).map(toTime);
  var after=sugg.filter(function(s){return s>around;}).slice(0,10).map(toTime);
  return {earlier:before,later:after};
}
function AvailBanner(props){
  var msg=props.msg||"No tables available.";var sugg=props.sugg;var style=props.style||{};var onTap=props.onTapTime;
  var bgClr=props.warn?"rgba(255,237,213,0.7)":"rgba(254,226,226,0.7)";var brdClr=props.warn?"rgba(253,186,116,0.55)":"rgba(252,165,165,0.55)";var txtClr=props.warn?"#9a3412":"#991b1b";
  var hasEarlier=sugg&&sugg.earlier&&sugg.earlier.length>0;
  var hasLater=sugg&&sugg.later&&sugg.later.length>0;
  var hasSugg=hasEarlier||hasLater;
  function renderChips(arr){
    if(!onTap) return arr.join(", ");
    return RC("span",{style:{display:"inline-flex",gap:4,flexWrap:"wrap"}},arr.map(function(t){
      return RC("span",{key:t,onClick:function(){onTap(t);},style:{cursor:"pointer",padding:"3px 8px",borderRadius:8,fontWeight:600,fontSize:12,background:"rgba(220,252,231,0.8)",color:"#166534",border:"1px solid rgba(134,239,172,0.5)",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}},t);
    }));
  }
  return RC("div",{style:Object.assign({padding:"10px 14px",borderRadius:14,border:"2px solid "+brdClr,background:bgClr,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",marginBottom:14,fontSize:13,color:txtClr,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"},style)},
    RC("div",{style:{fontWeight:700,marginBottom:hasSugg?6:0}},msg),
    hasEarlier?RC("div",{style:{marginBottom:hasLater?4:0}},RC("span",{style:{fontWeight:700}},"Before: "),renderChips(sugg.earlier)):null,
    hasLater?RC("div",null,RC("span",{style:{fontWeight:700}},"After: "),renderChips(sugg.later)):null,
    !hasSugg&&sugg?RC("div",{style:{marginTop:4}},"No availability found."):null);
}
function getKitchenLoad(bookings,date,time,dur,excludeId){
  if(!time) return {tables:0,guests:0,starts:0};
  var s=toMins(time);
  var active=bookings.filter(function(b){return b&&b.date===date&&b.status!=="cancelled"&&b.status!=="completed"&&b.id!==excludeId;});
  var starting=active.filter(function(b){var bs=toMins(b.time);return Math.abs(bs-s)<15;});
  var tblCount=0;var guests=0;
  starting.forEach(function(b){guests+=b.size||2;tblCount+=(b.tables||[]).length||1;});
  return {tables:tblCount,guests:guests,starts:starting.length};
}
function findKitchenFriendlyTimes(bookings,date,size,pref,dur,around,excludeId,blocks){
  var times=Array.from({length:(CLOSE-OPEN)*4},function(_,i){return OPEN*60+i*15;});
  var aroundM=toMins(around);
  var results=[];
  var exSl=bookings.filter(function(b){return b.date===date&&b.status!=="cancelled";}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+b.duration};});
  if(blocks) exSl=exSl.concat(getBlockSlots(blocks,date));
  times.forEach(function(m){
    if(m===aroundM) return;
    if(m+dur>CLOSE*60) return;
    var load=getKitchenLoad(bookings,date,toTime(m),dur,excludeId);
    if(load.starts+1>=KITCHEN_TABLE_LIMIT) return;
    var hasTables=!!findBest(size,pref,m,m+dur,exSl)||(pref==="auto"?!!findBestAny(size,m,m+dur,exSl):false);
    results.push({time:m,timeStr:toTime(m),hasTables:hasTables});
  });
  var before=results.filter(function(r){return r.time<aroundM;}).slice(-5);
  var after=results.filter(function(r){return r.time>aroundM;}).slice(0,5);
  return {before:before,after:after};
}
function findAllOptions(size,pref,s,e,slots){
  var results=[];
  var sg=ALL_TABLES.filter(function(t){return t.capacity>=size&&comboOk([t.id],pref)&&canAssign([t.id],slots,s,e);});
  sg.forEach(function(t){results.push([t.id]);});
  var co=VALID_COMBOS.filter(function(c){return c.cap>=size&&comboOk(c.ids,pref)&&canAssign(c.ids,slots,s,e);});
  co.forEach(function(c){results.push(c.ids);});
  if(pref==="auto"){
    var mx=VALID_COMBOS.filter(function(c){return c.cap>=size&&isMixedLarge(c.ids)&&canAssign(c.ids,slots,s,e);});
    mx.forEach(function(c){var k=c.ids.slice().sort().join("|");if(!results.some(function(r){return r.slice().sort().join("|")===k;})) results.push(c.ids);});
  }
  return results;
}
function _runGreedy(day,baseSlots){
  var slots=baseSlots.slice();var assigned={};
  day.forEach(function(b){if(!b||!b.time) return;var s=toMins(b.time),e=s+(b.duration||90);var tables;if(isLocked(b)){tables=b.tables;}else{
    if(b.preferredTables&&b.preferredTables.length>0){var pt=b.preferredTables;var ptCap=comboCap(pt);if(ptCap>=(b.size||2)&&canAssign(pt,slots,s,e)) tables=pt;}
    if(!tables){tables=findBest(b.size||2,b.preference||"auto",s,e,slots);if(!tables) tables=findBestAny(b.size||2,s,e,slots);}}assigned[b.id]=tables||null;if(tables) slots.push({tables:tables,s:s,e:e});});
  return assigned;
}
function optimise(bookings,date,blocks){
  var completed=bookings.filter(function(b){return b&&b.date===date&&b.status==="completed"&&(b.tables||[]).length>0;});
  var baseSlots=completed.map(function(b){return {tables:b.tables,s:toMins(b.time),e:toMins(b.time)+(b.duration||90)};});
  if(blocks) baseSlots=baseSlots.concat(getBlockSlots(blocks,date));
  var day=bookings.filter(function(b){return b&&b.date===date&&isActive(b);}).sort(function(a,b){var la=isLocked(a)?0:1,lb=isLocked(b)?0:1;if(la!==lb) return la-lb;if(b.size!==a.size) return b.size-a.size;var pa=a.preference!=="auto"?0:1,pb=b.preference!=="auto"?0:1;if(pa!==pb) return pa-pb;return toMins(a.time)-toMins(b.time);});
  // First pass
  var assigned=_runGreedy(day,baseSlots);
  // Table 7 swap: if a size-4 has table 7 and an overlapping size-3 exists, give 7 to the 3 and let greedy re-assign everyone else
  var t7fours=day.filter(function(b){return !isLocked(b)&&assigned[b.id]&&assigned[b.id].length===1&&assigned[b.id][0]==="7"&&b.size===4;});
  if(t7fours.length){t7fours.forEach(function(fb){var fs=toMins(fb.time),fe=fs+(fb.duration||90);var three=day.find(function(b){return !isLocked(b)&&b.size===3&&b.id!==fb.id&&overlaps(fs,fe,toMins(b.time),toMins(b.time)+(b.duration||90))&&(!assigned[b.id]||assigned[b.id][0]!=="7");});if(!three) return;var lockedSlots=baseSlots.slice();day.forEach(function(b){if(isLocked(b)&&b.tables) lockedSlots.push({tables:b.tables,s:toMins(b.time),e:toMins(b.time)+(b.duration||90)});});var ts=toMins(three.time),te=ts+(three.duration||90);if(!canAssign(["7"],lockedSlots,ts,te)) return;var trialSlots=lockedSlots.slice();trialSlots.push({tables:["7"],s:ts,e:te});var trialAssigned={};trialAssigned[three.id]=["7"];var others=day.filter(function(b){return b.id!==three.id&&!isLocked(b);}).sort(function(a,b){return b.size-a.size||toMins(a.time)-toMins(b.time);});others.forEach(function(b){var bs=toMins(b.time),be=bs+(b.duration||90);var tables;if(b.preferredTables&&b.preferredTables.length>0){var pt=b.preferredTables;if(comboCap(pt)>=(b.size||2)&&canAssign(pt,trialSlots,bs,be)) tables=pt;}if(!tables){tables=findBest(b.size||2,b.preference||"auto",bs,be,trialSlots);if(!tables) tables=findBestAny(b.size||2,bs,be,trialSlots);}trialAssigned[b.id]=tables||null;if(tables) trialSlots.push({tables:tables,s:bs,e:be});});day.forEach(function(b){if(isLocked(b)) trialAssigned[b.id]=b.tables;});var curUn=day.filter(function(b){return !isLocked(b)&&!assigned[b.id];}).length;var tryUn=day.filter(function(b){return !isLocked(b)&&!trialAssigned[b.id];}).length;if(tryUn<=curUn) assigned=trialAssigned;});}
  // Preference retry: if any non-auto booking got wrong area, force-fix it
  var prefMismatch=day.filter(function(b){if(isLocked(b)||!assigned[b.id]||b.preference==="auto") return false;var tbl=assigned[b.id];if(b.preference==="indoor") return !isAllIn(tbl);if(b.preference==="outdoor") return !isAllOut(tbl);return false;});
  if(prefMismatch.length){
    var lockedSlots=baseSlots.slice();day.forEach(function(b){if(isLocked(b)&&b.tables) lockedSlots.push({tables:b.tables,s:toMins(b.time),e:toMins(b.time)+(b.duration||90)});});
    prefMismatch.forEach(function(pb){
      var s=toMins(pb.time),e=s+(pb.duration||90);
      var prefTables=findBest(pb.size||2,pb.preference,s,e,lockedSlots);
      if(!prefTables) return;
      var trialSlots=baseSlots.slice();trialSlots.push({tables:prefTables,s:s,e:e});
      var trialAssigned={};trialAssigned[pb.id]=prefTables;
      day.forEach(function(b){if(!b||!b.time||b.id===pb.id) return;var bs=toMins(b.time),be=bs+(b.duration||90);var tables;if(isLocked(b)){tables=b.tables;}else{tables=findBest(b.size||2,b.preference||"auto",bs,be,trialSlots);if(!tables) tables=findBestAny(b.size||2,bs,be,trialSlots);}trialAssigned[b.id]=tables||null;if(tables) trialSlots.push({tables:tables,s:bs,e:be});});
      var curUn=day.filter(function(b){return !isLocked(b)&&!assigned[b.id];}).length;
      var tryUn=day.filter(function(b){return !isLocked(b)&&!trialAssigned[b.id];}).length;
      if(tryUn<=curUn){assigned=trialAssigned;}
    });
  }
  // Retry: find combo bookings that could use alternatives
  var unassigned=day.filter(function(b){return !isLocked(b)&&!assigned[b.id];});
  if(!unassigned.length) return assigned;
  // Retry: try reshuffling any assigned booking that overlaps with unassigned ones
  var unTimes=unassigned.map(function(b){return {s:toMins(b.time),e:toMins(b.time)+(b.duration||90)};});
  var comboBookings=day.filter(function(b){if(isLocked(b)||!assigned[b.id]) return false;var bs=toMins(b.time),be=bs+(b.duration||90);return unTimes.some(function(u){return overlaps(bs,be,u.s,u.e);});}).sort(function(a,b){return b.size-a.size;}).slice(0,8);
  if(!comboBookings.length) return assigned;
  var bestAssigned=assigned;
  var bestUnassignedCount=unassigned.length;
  comboBookings.forEach(function(cb){
    var s=toMins(cb.time),e=s+(cb.duration||90);
    var lockedSlots=baseSlots.slice();
    day.forEach(function(b){if(isLocked(b)&&b.tables) lockedSlots.push({tables:b.tables,s:toMins(b.time),e:toMins(b.time)+(b.duration||90)});});
    var options=findAllOptions(cb.size||2,cb.preference||"auto",s,e,lockedSlots);
    var currentKey=assigned[cb.id].slice().sort().join("|");
    options.forEach(function(opt){
      var optKey=opt.slice().sort().join("|");
      if(optKey===currentKey) return;
      // Reserve forced booking's tables first
      var trialSlots=baseSlots.slice();
      var cbs=toMins(cb.time),cbe=cbs+(cb.duration||90);
      trialSlots.push({tables:opt,s:cbs,e:cbe});
      var trialAssigned={};
      trialAssigned[cb.id]=opt;
      day.forEach(function(b){
        if(!b||!b.time||b.id===cb.id) return;
        var bs=toMins(b.time),be=bs+(b.duration||90);
        var tables;
        if(isLocked(b)){tables=b.tables;}
        else{tables=findBest(b.size||2,b.preference||"auto",bs,be,trialSlots);if(!tables) tables=findBestAny(b.size||2,bs,be,trialSlots);}
        trialAssigned[b.id]=tables||null;
        if(tables) trialSlots.push({tables:tables,s:bs,e:be});
      });
      var trialUnassigned=day.filter(function(b){return !isLocked(b)&&!trialAssigned[b.id];}).length;
      var prefBroken=false;day.forEach(function(b){if(prefBroken||b.preference==="auto"||isLocked(b)) return;var orig=assigned[b.id];var trial=trialAssigned[b.id];if(!orig||!trial) return;var oOk=b.preference==="indoor"?isAllIn(orig):isAllOut(orig);var tOk=b.preference==="indoor"?isAllIn(trial):isAllOut(trial);if(oOk&&!tOk) prefBroken=true;});
      if(trialUnassigned<bestUnassignedCount&&!prefBroken){bestUnassignedCount=trialUnassigned;bestAssigned=trialAssigned;}
    });
  });
  return bestAssigned;
}
function applyOpt(bookings,date,blocks){
  var map=optimise(bookings,date,blocks);
  return bookings.map(function(b){if(b.date!==date||b.status==="cancelled") return Object.assign({},b);if(b.status==="completed") return Object.assign({},b,{_conflict:false});var tables=isLocked(b)?b.tables:(map[b.id]||[]);return Object.assign({},b,{tables:tables,_conflict:!tables||!tables.length});});
}
function verifyClean(bookings,date){
  var day=bookings.filter(function(b){return b.date===date&&isActive(b)&&(b.tables||[]).length>0;});
  for(var i=0;i<day.length;i++){for(var j=i+1;j<day.length;j++){var a=day[i],b=day[j];var as=toMins(a.time),ae=as+a.duration,bs=toMins(b.time),be=bs+b.duration;if(!overlaps(as,ae,bs,be)) continue;if(!canAssign(b.tables,[{tables:a.tables,s:as,e:ae}],bs,be)) return false;}}
  return true;
}
function checkInefficent(bookings,date){
  var day=bookings.filter(function(b){return b.date===date&&isActive(b)&&!isLocked(b);});
  return day.some(function(b){var oth=day.filter(function(x){return x.id!==b.id;}).map(function(x){return {tables:x.tables,s:toMins(x.time),e:toMins(x.time)+x.duration};});var best=findBest(b.size,b.preference,toMins(b.time),toMins(b.time)+b.duration,oth);return best&&best.length<(b.tables||[]).length;});
}
function useWinW(){var ws=useState(typeof window!=="undefined"?window.innerWidth:1024);var w=ws[0],setW=ws[1];useEffect(function(){function h(){setW(window.innerWidth);}window.addEventListener("resize",h);return function(){window.removeEventListener("resize",h);};},[]);return w;}

// ── Style helpers ─────────────────────────────────────────────────────────────
function mkInp(){return {width:"100%",boxSizing:"border-box",background:"rgba(255,255,255,0.5)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,padding:"10px 12px",fontSize:16,color:S.text,fontWeight:500,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"};}
function mkBtn(extra){return Object.assign({border:"1px solid rgba(255,255,255,0.3)",background:"rgba(120,130,150,0.55)",backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",borderRadius:12,padding:"8px 14px",cursor:"pointer",fontSize:13,color:"#fff",fontWeight:600,minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.25)",letterSpacing:"0.01em"},extra||{});}
var BTN={tables:"rgba(0,122,255,0.75)",edit:"rgba(0,122,255,0.7)",del:"rgba(220,60,60,0.75)",cancel:"rgba(220,60,60,0.75)",clear:"rgba(220,60,60,0.7)",reset:"rgba(220,60,60,0.7)",today:"rgba(0,122,255,0.7)",nav:"rgba(120,130,150,0.5)",dismiss:"rgba(220,60,60,0.7)",orange:"rgba(230,100,30,0.8)"};
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
  },[mob]);
  if(mob){
    return RC("div",{style:{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:200}},
      RC("div",{style:{position:"absolute",top:0,left:0,right:0,bottom:0,background:"rgba(245,247,250,0.92)",backdropFilter:"blur(40px)",WebkitBackdropFilter:"blur(40px)",overflowY:"scroll",WebkitOverflowScrolling:"touch"}},
        RC("div",{style:{minHeight:"100%",padding:"16px 18px",paddingTop:"max(16px, env(safe-area-inset-top))",paddingBottom:"max(80px, calc(40px + env(safe-area-inset-bottom)))",boxSizing:"border-box"}},props.children)));
  }
  return RC("div",{style:{position:"fixed",inset:0,background:"rgba(0,0,0,0.25)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:12},onClick:function(e){if(e.target===e.currentTarget)props.onClose();}},
    RC("div",{style:{background:"rgba(255,255,255,0.72)",backdropFilter:"blur(40px)",WebkitBackdropFilter:"blur(40px)",borderRadius:20,border:"1px solid rgba(255,255,255,0.5)",padding:"24px",width:"100%",maxWidth:580,maxHeight:"90dvh",overflowY:"auto",boxSizing:"border-box",boxShadow:"0 8px 40px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.8)"}},props.children));
}
function Fld(props){
  var starEl=props.req?RC("span",{style:{color:"#dc2626"}},"*"):null;
  return RC("div",{style:Object.assign({display:"flex",flexDirection:"column",gap:4},props.style||{})},
    RC("label",{style:{fontSize:13,color:"#4a5568",fontWeight:600,letterSpacing:"0.01em"}},props.label,starEl),props.children);
}
function Section(props){
  return RC("div",{style:Object.assign({background:"rgba(255,255,255,0.4)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:"1px solid rgba(255,255,255,0.45)",borderRadius:16,padding:"14px",marginBottom:14,boxShadow:"0 2px 12px rgba(0,0,0,0.06), inset 0 1px 1px rgba(255,255,255,0.6)"},props.style||{})},props.children);
}
function SBadge(props){return RC("span",{style:{fontSize:12,padding:"4px 10px",borderRadius:10,background:BLOCK_BG[props.status]||BLOCK_BG.confirmed,color:"#fff",border:"1px solid rgba(255,255,255,0.2)",fontWeight:600,textTransform:"capitalize",display:"inline-block",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",boxShadow:"0 1px 3px rgba(0,0,0,0.1)"}},props.status);}
function TBadge(props){var id=props.id,indoor=isIn(id);var t=indoor?TBL.ind:TBL.out;return RC("span",{style:{fontSize:12,padding:"4px 10px",borderRadius:10,background:t.bg,color:t.text,border:"1px solid "+t.border,fontWeight:600,display:"inline-block",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",boxShadow:"0 1px 3px rgba(0,0,0,0.08)"}},id);}
function SmallTag(props){return RC("span",{style:Object.assign({fontSize:11,padding:"3px 8px",borderRadius:8,fontWeight:600,display:"inline-block"},props.style||{})},props.label);}
function Toggle(props){return RC("button",{onClick:props.onClick,style:{width:48,height:26,borderRadius:13,border:"1px solid rgba(255,255,255,0.3)",cursor:"pointer",background:props.on?"rgba(0,122,255,0.7)":"rgba(180,180,190,0.4)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",position:"relative",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(0,0,0,0.08)"}},RC("div",{style:{position:"absolute",top:3,left:props.on?24:3,width:20,height:20,borderRadius:10,background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}}));}


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
      return RC("button",{key:t.id,onClick:function(){toggle(t.id);},style:{width:64,height:52,padding:0,borderRadius:12,border:brd,background:bg,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",color:clr,fontWeight:600,fontSize:14,cursor:blocked?"not-allowed":"pointer",opacity:blocked?0.5:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,boxSizing:"border-box",boxShadow:"0 1px 4px rgba(0,0,0,0.08), inset 0 1px 1px rgba(255,255,255,0.3)"}},
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
  var affectedEl=isSwapping?RC("div",{style:{marginTop:8,padding:"10px 14px",borderRadius:14,background:"rgba(255,237,213,0.65)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"2px solid rgba(253,186,116,0.55)"}},
    RC("div",{style:{fontSize:13,fontWeight:700,color:"#9a3412",marginBottom:4}},"Will reassign:"),
    affectedBookings.map(function(ab){return RC("div",{key:ab.id,style:{fontSize:12,color:"#9a3412"}},ab.name+" — losing table "+(ab.tables.join(", ")));})):null;
  var swapBg=swapBusy?"rgba(255,237,213,0.6)":S.bg;
  var swapBrd="2px solid "+(swapBusy?"rgba(253,186,116,0.6)":"rgba(255,255,255,0.5)");
  var swapTitleClr=swapBusy?"#9a3412":S.text;
  var swapSubClr=swapBusy?"#c2410c":S.text;
  return RC(Overlay,{onClose:onClose},
    RC("div",{style:{textAlign:"center",marginBottom:4}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"rgba(0,122,255,0.75)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},titleText||"Manual table assignment")),
    RC("div",{style:{fontSize:13,color:S.text,marginBottom:4,marginTop:6,textAlign:"center"}},booking.name+" · "+booking.size+" pax · "+booking.time+"–"+toTime(e)),
    RC("div",{style:{marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:14,background:swapBg,border:swapBrd,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
      RC("div",null,RC("div",{style:{fontSize:13,fontWeight:700,color:swapTitleClr}},"Swap busy"),RC("div",{style:{fontSize:11,color:swapSubClr,marginTop:2}},"Reassign confirmed bookings to other tables (not seated)")),
      RC(Toggle,{on:swapBusy,onClick:function(){setSwapBusy(function(v){if(!v) setSelected([]);return !v;});}})),
    RC("div",{style:{fontSize:13,color:S.text,marginBottom:14}},"Tap tables to select / deselect."),
    RC("div",{style:{marginBottom:14,padding:"12px 14px",borderRadius:14,background:"rgba(255,255,255,0.35)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"2px solid "+(conflict?"rgba(252,165,165,0.6)":ok?"rgba(134,239,172,0.6)":"rgba(255,255,255,0.5)"),display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
      RC("div",null,
        RC("div",{style:{fontSize:14,fontWeight:700,color:S.text}},"Selected: "+(selected.length?selected.join(" + "):"none")),
        RC("div",{style:{fontSize:13,color:summaryColor,fontWeight:500,marginTop:2}},summaryText)),
      clearBtn),
    affectedEl,
    RC(TableGrid,{selected:selected,toggle:toggle,busy:busy,seatedBusy:seatedBusy,swapBusy:swapBusy}),
    RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}},
      RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:onClose},"Cancel"),
      RC("button",{disabled:!ok,onClick:function(){if(ok)onSave(selected,true,isSwapping?affectedBookings:null);},style:{background:ok?(isSwapping?BTN.orange:S.accent):"rgba(180,180,190,0.4)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 20px",cursor:ok?"pointer":"not-allowed",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:ok?"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)":"none"}},assignLabel)));
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
      RC("button",{onClick:handleSave,style:{background:"rgba(153,27,27,0.85)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 22px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Block")));
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function TimelineView(props){
  var bookings=props.bookings,date=props.date,onEdit=props.onEdit,onManual=props.onManual,onStatus=props.onStatus,blocks=props.blocks||[],onBlock=props.onBlock,nowMins=props.nowMins||0,warnings=props.warnings||{};
  var zoom=props.zoom||1,setZoom=props.setZoom;
  var followNow=props.followNow,setFollowNow=props.setFollowNow;
  var scrollPosRef=props.scrollPosRef;
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
  },[followNow,nowMins,gridW]);
  function onGridScroll(){
    if(scrollRef.current&&scrollPosRef){scrollPosRef.current=scrollRef.current.scrollLeft;}
    if(quickStatus) setQuickStatus(null);
  }
  var day=bookings.filter(function(b){return b.date===date&&b.status!=="cancelled";});
  var dayBlocks=blocks.filter(function(bl){return bl.date===date;});
  var unassigned=day.filter(function(b){return b.status!=="completed"&&(!(b.tables||[]).length||b._conflict);});
  function pct(mins){return ((mins-OPEN*60)/totalMins)*100+"%";}
  function GridLines(){
    var lines=QUARTER_HOURS.map(function(m){var isH=m%60===0;return RC("div",{key:m,style:{position:"absolute",top:0,bottom:0,left:pct(m),borderLeft:isH?"1px solid rgba(120,130,155,0.45)":"0.5px solid rgba(140,150,175,0.3)",opacity:1}});});
    lines.push(RC("div",{key:"end",style:{position:"absolute",top:0,bottom:0,right:0,borderLeft:"1px solid rgba(120,130,155,0.45)"}}));
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
  var headerLines=QUARTER_HOURS.concat([GRID_CLOSE*60]).map(function(m){var isH=m%60===0;return RC("div",{key:"l"+m,style:{position:"absolute",top:0,left:pct(m),bottom:0,borderLeft:isH?"1px solid rgba(120,130,155,0.45)":"0.5px solid rgba(140,150,175,0.3)"}});});
  var headerLabels=QUARTER_HOURS.filter(function(m){return m%60===0&&m<GRID_CLOSE*60;}).map(function(m){var center=((m+30-OPEN*60)/totalMins)*100;return RC("span",{key:"h"+m,style:{position:"absolute",top:3,left:center+"%",transform:"translateX(-50%)",fontSize:10,fontWeight:600,color:"#fff",whiteSpace:"nowrap",pointerEvents:"none",background:"rgba(90,100,120,0.9)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",padding:"2px 5px",borderRadius:6,zIndex:1,boxShadow:"0 1px 3px rgba(0,0,0,0.1)"}},String(Math.floor(m/60)).padStart(2,"0")+":00");});
  // Labels column
  var labelCol=RC("div",{style:{width:LABEL_W+"px",flexShrink:0}},
    RC("div",{style:{height:24,background:"rgba(220,225,235,0.45)",borderRadius:"6px 0 0 0",borderBottom:"1px solid rgba(180,190,210,0.3)",boxSizing:"border-box"}}),
    TIMELINE_TABLES.map(function(tbl){var id=tbl.id,indoor=isIn(id);var hasBlock=dayBlocks.some(function(bl){return bl.tableId===id;});
      return RC("div",{key:id,onClick:function(){if(onBlock) onBlock(id);},style:{height:ROW_H+"px",display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:6,borderBottom:"1px solid rgba(180,190,210,0.2)",cursor:"pointer",boxSizing:"border-box"}},
        RC("span",{style:{fontSize:11,fontWeight:600,padding:"3px 0",borderRadius:8,background:hasBlock?"rgba(153,27,27,0.85)":indoor?TBL.ind.bg:TBL.out.bg,color:hasBlock?"#fff":indoor?TBL.ind.text:TBL.out.text,border:"1px solid "+(hasBlock?"rgba(153,27,27,0.5)":indoor?TBL.ind.border:TBL.out.border),width:32,textAlign:"center",display:"inline-block",boxSizing:"border-box",boxShadow:"0 1px 3px rgba(0,0,0,0.1)"}},id));}),
    unassigned.length>0?RC("div",{style:{height:ROW_H+"px",display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:6,borderTop:"1px dashed rgba(220,60,60,0.4)",marginTop:4,boxSizing:"border-box"}},RC("span",{style:{fontSize:10,fontWeight:600,color:"#991b1b"}},"unassigned")):null);
  // Grid column (scrollable)
  var gridRows=TIMELINE_TABLES.map(function(tbl){var id=tbl.id;var rows=day.filter(function(b){return (b.tables||[]).includes(id);});var tblBlocks=dayBlocks.filter(function(bl){return bl.tableId===id;});
    return RC("div",{key:id,style:{height:ROW_H+"px",position:"relative",borderBottom:"1px solid rgba(180,190,210,0.2)",boxSizing:"border-box"}},RC(GridLines,null),tblBlocks.map(function(bl,i){return RC(BlockBar,{key:"blk"+i,bl:bl});}),rows.filter(function(b){return b.status==="seated";}).map(function(b){var origD=b.duration;var sm=toMins(b.time)-OPEN*60;var gLeft=pct(OPEN*60+sm);var gW=Math.max((origD/totalMins)*100,0.5)+"%";return RC("div",{key:"ghost_"+b.id,style:{position:"absolute",top:3,height:(ROW_H-8)+"px",left:gLeft,width:gW,background:"transparent",borderRadius:10,border:"2px dashed "+BLOCK_BG.seated,boxSizing:"border-box",pointerEvents:"none"}});}),rows.map(function(b){return RC(Block,{key:b.id,b:b});}));});
  var unassignedGrid=unassigned.length>0?RC("div",{style:{height:ROW_H+"px",position:"relative",borderTop:"1px dashed rgba(220,60,60,0.4)",marginTop:4,boxSizing:"border-box"}},RC(GridLines,null),unassigned.map(function(b){return RC(Block,{key:b.id,b:b});})):null;
  // Now line (today only)
  var nowInRange=isToday&&nowMins>=OPEN*60&&nowMins<=GRID_CLOSE*60;
  var nowLine=nowInRange?RC("div",{key:"now",style:{position:"absolute",top:0,bottom:0,left:pct(nowMins),zIndex:10,pointerEvents:"none"}},
    RC("div",{style:{position:"absolute",top:3,left:"50%",transform:"translateX(-50%)",fontSize:10,fontWeight:600,color:"#fff",background:"rgba(0,0,0,0.9)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",padding:"2px 5px",borderRadius:6,whiteSpace:"nowrap",zIndex:11,boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}},toTime(nowMins)),
    RC("div",{style:{position:"absolute",top:11,bottom:0,left:"50%",transform:"translateX(-50%)",width:2,background:"rgba(0,0,0,0.6)"}})):null;
  var gridCol=RC("div",{ref:scrollRef,onScroll:onGridScroll,style:{flex:1,overflowX:"auto",overflowY:"hidden"}},
    RC("div",{style:{width:gridW+"px",minWidth:"100%",position:"relative"}},
      RC("div",{style:{position:"relative",borderBottom:"1px solid rgba(180,190,210,0.3)",background:"rgba(220,225,235,0.45)",borderRadius:"0 6px 0 0",height:24,overflow:"visible",boxSizing:"border-box"}},headerLines,headerLabels),
      gridRows,
      unassignedGrid,
      nowLine));
  var followBtn=isToday?RC("button",{onClick:function(){if(!followNow){setFollowNow(true);if(zoom<4) setZoom(4);}else{setFollowNow(false);}},style:mkBtn({minHeight:32,padding:"4px 10px",fontSize:11,background:followNow?"rgba(0,0,0,0.6)":"rgba(120,130,150,0.5)"})},followNow?"Follow":"Follow"):null;
  var zoomBtns=RC("div",{style:{display:"flex",gap:4,alignItems:"center"}},
    followBtn,
    RC("button",{onClick:function(){setZoom(function(z){return Math.max(1,z-0.5);});},style:mkBtn({minHeight:32,minWidth:32,padding:"4px 10px",fontSize:16,background:BTN.nav})},"-"),
    RC("button",{onClick:function(){setZoom(1);setFollowNow(false);},style:mkBtn({minHeight:32,padding:"4px 10px",fontSize:11,background:zoom===1?"#64748b":BTN.nav})},zoom===1?"1x":zoom+"x → 1x"),
    RC("button",{onClick:function(){setZoom(function(z){return Math.min(5,z+0.5);});},style:mkBtn({minHeight:32,minWidth:32,padding:"4px 10px",fontSize:16,background:BTN.nav})},"+"));
  var legendEls=Object.keys(STATUS_COLORS).map(function(s){return RC("span",{key:s,style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:BLOCK_BG[s]||"#999",color:"#fff",border:"1px solid rgba(255,255,255,0.2)",fontWeight:600,textTransform:"capitalize",boxShadow:"0 1px 3px rgba(0,0,0,0.08)"}},s);});
  legendEls.push(RC("span",{key:"in",style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:TBL.ind.bg,color:"#fff",border:"1px solid rgba(255,255,255,0.2)",fontWeight:600}},"indoor"));
  legendEls.push(RC("span",{key:"out",style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:TBL.out.bg,color:"#fff",border:"1px solid rgba(255,255,255,0.2)",fontWeight:600}},"outdoor"));
  legendEls.push(RC("span",{key:"blocked",style:{fontSize:11,padding:"3px 8px",borderRadius:8,background:"rgba(153,27,27,0.85)",color:"#fff",border:"1px solid rgba(255,255,255,0.2)",fontWeight:600}},"blocked"));
  var quickPopup=quickStatus?RC("div",{onClick:function(){setQuickStatus(null);},style:{position:"fixed",inset:0,zIndex:300}},
    RC("div",{onClick:function(e){e.stopPropagation();},style:{position:"fixed",left:Math.min(quickStatus.x,window.innerWidth-200),top:Math.max(0,quickStatus.y-52),background:"rgba(255,255,255,0.75)",backdropFilter:"blur(30px)",WebkitBackdropFilter:"blur(30px)",borderRadius:14,border:"1px solid rgba(255,255,255,0.5)",boxShadow:"0 8px 32px rgba(0,0,0,0.15), inset 0 1px 1px rgba(255,255,255,0.6)",padding:"8px 10px",display:"flex",gap:6,alignItems:"center",zIndex:301,flexWrap:"wrap",maxWidth:220}},
      RC("span",{style:{fontSize:11,fontWeight:700,color:S.text,maxWidth:60,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},quickStatus.booking.name),
      ["confirmed","seated","completed","cancelled"].filter(function(st){return st!==quickStatus.booking.status;}).map(function(st){return RC("button",{key:st,style:{background:BLOCK_BG[st],border:"1px solid rgba(255,255,255,0.25)",borderRadius:10,padding:"4px 10px",fontSize:11,fontWeight:600,color:"#fff",cursor:"pointer",textTransform:"capitalize",minHeight:28,backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"},onClick:function(){onStatus(quickStatus.booking.id,st);setQuickStatus(null);}},st);}))):null;
  return RC("div",{style:{background:"rgba(255,255,255,0.4)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderRadius:20,border:"1px solid rgba(255,255,255,0.45)",padding:"10px 12px",boxShadow:"0 2px 16px rgba(0,0,0,0.06), inset 0 1px 1px rgba(255,255,255,0.6)"}},
    RC("div",{style:{display:"flex",alignItems:"center",justifyContent:"flex-end",marginBottom:8}},
      zoomBtns),
    RC("div",{style:{display:"flex"}},labelCol,gridCol),
    RC("div",{style:{marginTop:10,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}},legendEls),
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
    var liveDur=b.status==="seated"?Math.max(15,nowMins-toMins(b.time)):b.duration;
    var end=toTime(toMins(b.time)+liveDur);
    var durationTag=b.status==="seated"?RC(SmallTag,{label:liveDur+" min",style:{background:"#166534",color:"#fff",border:"none"}}):null;
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
    return RC("div",{key:b.id,style:{background:cardBg,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:cardBrdW+" solid "+cardBrd,borderRadius:16,padding:"14px 16px",opacity:b.status==="completed"||b.status==="cancelled"?0.75:1,boxShadow:"0 2px 12px rgba(0,0,0,0.06), inset 0 1px 1px rgba(255,255,255,0.5)"}},
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

// ── App ───────────────────────────────────────────────────────────────────────
function BookingApp(){
  var bs=useState([]);var bookings=bs[0],setBookings=bs[1];
  var tbs2=useState([]);var tableBlocks=tbs2[0],setTableBlocks=tbs2[1];
  // Firebase save helpers — write-on-action only (prevents multi-device data corruption)
  function saveBookings(next){setBookings(next);set(ref(db,"bookings"),next).catch(function(){});}
  function saveBlocks(next){setTableBlocks(next);set(ref(db,"tableBlocks"),next).catch(function(){});}
  // Ensure optimal viewport scaling on all devices
  useEffect(function(){
    var meta=document.querySelector('meta[name="viewport"]');
    if(!meta){meta=document.createElement("meta");meta.name="viewport";document.head.appendChild(meta);}
    meta.content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
    document.documentElement.style.cssText="height:100%;overflow:hidden;";
    document.body.style.cssText="height:100%;overflow:auto;margin:0;-webkit-overflow-scrolling:touch;overscroll-behavior:none;";
    return function(){document.documentElement.style.cssText="";document.body.style.cssText="";};
  },[]);
  // Firebase real-time listeners — read only, never write back
  useEffect(function(){
    var unsub=onValue(ref(db,"bookings"),function(snap){
      var val=snap.val();
      if(val) setBookings(sanitizeAll(val));
    });
    return unsub;
  },[]);
  useEffect(function(){
    var unsub=onValue(ref(db,"tableBlocks"),function(snap){
      var val=snap.val();
      if(val){var arr=Array.isArray(val)?val:Object.values(val);setTableBlocks(arr.filter(Boolean));}
    });
    return unsub;
  },[]);
  var vs=useState("timeline");var view=vs[0],setView=vs[1];
  var zms=useState(1);var timelineZoom=zms[0],setTimelineZoom=zms[1];
  var timelineScrollRef=useRef(0);
  var fns=useState(false);var followNow=fns[0],setFollowNow=fns[1];
  var vds=useState(new Date().toISOString().slice(0,10));var viewDate=vds[0],setViewDate=vds[1];
  var sfs=useState(false);var showForm=sfs[0],setShowForm=sfs[1];
  var fms=useState(EMPTY_FORM);var form=fms[0],setForm=fms[1];
  var eis=useState(null);var editId=eis[0],setEditId=eis[1];
  var ers=useState("");var error=ers[0],setError=ers[1];
  var cds=useState(null);var confirmDel=cds[0],setConfirmDel=cds[1];
  var ccs=useState(null);var confirmCancel=ccs[0],setConfirmCancel=ccs[1];
  var rss=useState(false);var reshuffled=rss[0],setReshuffled=rss[1];
  var mts=useState(null);var manualTarget=mts[0],setManualTarget=mts[1];
  var bts=useState(null);var blockTarget=bts[0],setBlockTarget=bts[1];
  var dis=useState(null);var dismissedIneff=dis[0],setDismissedIneff=dis[1];
  var formRef=useRef(EMPTY_FORM);
  var sas=useState(null);var swapAffected=sas[0],setSwapAffected=sas[1];
  var cks=useState(null);var confirmKitchen=cks[0],setConfirmKitchen=cks[1];
  var shs=useState(false);var showHistory=shs[0],setShowHistory=shs[1];
  var pps=useState(false);var showPrefPicker=pps[0],setShowPrefPicker=pps[1];
  useEffect(function(){formRef.current=form;},[form]);
  useEffect(function(){if(error) setError("");},[form.time,form.size,form.date,form.preference,form.customDur]);
  // Real-time clock for seated duration
  var nms=useState(function(){var d=new Date();return d.getHours()*60+d.getMinutes();});var nowMins=nms[0],setNowMins=nms[1];
  useEffect(function(){var t=setInterval(function(){var d=new Date();setNowMins(d.getHours()*60+d.getMinutes());},15000);return function(){clearInterval(t);};},[]);
  // Auto-extend seated bookings that exceed their stored duration
  var lastExtend=useRef("");
  useEffect(function(){
    var today=new Date().toISOString().slice(0,10);
    var seated=bookings.filter(function(b){return b.date===today&&b.status==="seated";});
    var needsUpdate=false;
    var updated=bookings.map(function(b){
      if(b.date!==today||b.status!=="seated") return b;
      var elapsed=nowMins-toMins(b.time);
      if(elapsed>b.duration){needsUpdate=true;return Object.assign({},b,{duration:elapsed,customDur:elapsed});}
      return b;
    });
    if(!needsUpdate) return;
    var key=seated.map(function(b){return b.id+":"+nowMins;}).join(",");
    if(key===lastExtend.current) return;
    lastExtend.current=key;
    saveBookings(applyOpt(updated,today,tableBlocks));
  },[nowMins]);
  var winW=useWinW();
  var isMobile=winW<600;
  function getUser(){return "staff";}

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
        if(gap<=15) warnings[sb.id]={next:nextOnTable.name,nextTime:nextOnTable.time,gap:gap,overdue:gap<=0};
      }
    });
    return warnings;
  })();

  function flash(){setReshuffled(true);setTimeout(function(){setReshuffled(false);},3000);}
  function openNew(){setForm(Object.assign({},EMPTY_FORM,{date:viewDate}));setEditId(null);setError("");setSwapAffected(null);setConfirmKitchen(null);setShowForm(true);}
  function openEdit(b){setForm({name:b.name,phone:b.phone||"+",date:b.date,time:b.time,size:b.size,preference:b.preference,notes:b.notes||"",status:b.status,customDur:b.duration!==getDur(b.size)?b.duration:null,manualTables:[],preferredTables:Array.isArray(b.preferredTables)?b.preferredTables.slice():[]});setEditId(b.id);setError("");setSwapAffected(null);setShowHistory(false);setShowForm(true);}

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
  function openWalkin(){setWalkinForm({size:2,notes:"",tables:[],time:nowTime(),customDur:null});setWalkinError("");setConfirmKitchen(null);setShowWalkin(true);}
  function doSaveWalkin(){
    var wf=walkinForm;
    if(!wf.tables||!wf.tables.length){setWalkinError("Please assign tables first.");return;}
    var t=wf.time||nowTime();var size=Number(wf.size)||2;var dur=wf.customDur||getDur(size);
    var nb={id:genId(),name:"Walk-in "+getNextWalkinNum(),phone:"",date:new Date().toISOString().slice(0,10),time:t,size:size,duration:dur,preference:"auto",notes:wf.notes||"",status:"seated",tables:wf.tables,customDur:wf.customDur||null,_manual:true,_locked:true,history:[histEntry("walk-in created",getUser())]};
    saveBookings(bookings.concat([nb]));
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
      if(!f.time){setError("Please set a time.");return;}
      var sm=toMins(f.time);
      if(sm<OPEN*60||sm>CLOSE*60){setError("Bookings accepted between "+OPEN+":00 and "+CLOSE+":00.");return;}
      var size=Number(f.size)||2;
      var dur=f.customDur||getDur(size);
      var cleanPhone=f.phone&&f.phone.trim()!=="+"?f.phone.trim():"";
      var mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:[];
      if(mt.length&&!swapAffected){var ex=bookings.filter(function(b){return b.date===f.date&&b.status!=="cancelled"&&b.id!==editId;}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+b.duration};});ex=ex.concat(getBlockSlots(tableBlocks,f.date));if(!canAssign(mt,ex,sm,sm+dur)){setError("Selected tables are not available at this time.");return;}}
      if(editId){
        var orig=bookings.find(function(b){return b.id===editId;});
        var origPt=(orig&&Array.isArray(orig.preferredTables))?orig.preferredTables.slice().sort().join(","):"";
        var newPt=Array.isArray(f.preferredTables)?f.preferredTables.slice().sort().join(","):"";
        var prefTablesChanged=origPt!==newPt;
        var needsR=!orig||size!==orig.size||f.time!==orig.time||f.date!==orig.date||f.preference!==orig.preference||f._clearManual||prefTablesChanged;
        var prefOnly=orig&&size===orig.size&&f.time===orig.time&&f.date===orig.date&&!f._clearManual;
        var saveDur=dur;var saveCustDur=f.customDur||null;
        if(f.status==="completed"&&orig&&orig.status!=="completed"&&!f.customDur){var now=new Date();var nowM=now.getHours()*60+now.getMinutes();var startMins=toMins(f.time);var actualDur=Math.max(15,nowM-startMins);saveDur=actualDur;saveCustDur=actualDur;}
        var clearM=!!f._clearManual;
        var wasSeatedLocked=orig&&isLocked(orig)&&!mt.length;
        var editHist=orig?histEntry("edited: "+diffBooking(orig,f,size),getUser()):histEntry("edited",getUser());
        var upd=bookings.map(function(b){
          if(b.id===editId){var h=(b.history||[]).concat([editHist]);var unlockForOpt=needsR&&wasSeatedLocked&&!mt.length&&!clearM;return Object.assign({},b,{name:f.name,phone:cleanPhone,date:f.date,time:f.time,size:size,duration:saveDur,preference:f.preference,notes:f.notes,status:unlockForOpt?"confirmed":f.status,tables:mt.length?mt:(clearM?[]:(!needsR?b.tables:[])),customDur:saveCustDur,_manual:mt.length>0?true:(clearM?false:b._manual),_locked:mt.length>0?true:(clearM?false:(unlockForOpt?false:b._locked)),preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],history:h});}
          if(swapAffected){var match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){var remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}}
          return b;
        });
        var fin=applyOpt(upd,f.date,tableBlocks);
        if(wasSeatedLocked&&needsR&&!mt.length){fin=fin.map(function(b){if(b.id===editId) return Object.assign({},b,{status:f.status,_locked:b.tables&&b.tables.length>0,_manual:b.tables&&b.tables.length>0});return b;});}
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
        saveBookings(fin);if(needsR||swapAffected||f.status==="completed") flash();setShowForm(false);setViewDate(f.date);
      } else {
        var newId=genId();
        var nb={id:newId,name:f.name,phone:cleanPhone,date:f.date,time:f.time,size:size,duration:dur,preference:f.preference,notes:f.notes,status:"confirmed",tables:mt.length?mt:[],customDur:f.customDur||null,_manual:mt.length>0,_locked:mt.length>0,preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],history:[histEntry("created",getUser())]};
        var base=bookings;
        if(swapAffected){base=bookings.map(function(b){var match=swapAffected.find(function(ab){return ab.id===b.id;});if(match){var remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});}return b;});}
        var fin=applyOpt(base.concat([nb]),f.date,tableBlocks);
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

  function forceReshuffle(){saveBookings(applyOpt(bookings,viewDate,tableBlocks));flash();}
  function delBooking(id){saveBookings(applyOpt(bookings.filter(function(x){return x.id!==id;}),viewDate,tableBlocks));setConfirmDel(null);flash();}
  function updateStatus(id,status){
    if(status==="cancelled"){setConfirmCancel(id);return;}
    var user=getUser();
    var updated=bookings.map(function(x){if(x.id!==id) return x;var extra={status:status,history:(x.history||[]).concat([histEntry("status → "+status,user)])};if(status==="completed"){var now=new Date();var nowM2=now.getHours()*60+now.getMinutes();var startMins=toMins(x.time);var actualDur=Math.max(15,nowM2-startMins);extra.duration=actualDur;extra.customDur=actualDur;}return Object.assign({},x,extra);});
    saveBookings(applyOpt(updated,viewDate,tableBlocks));if(status==="completed") flash();
  }
  function doCancelBooking(id,noShow){
    var user=getUser();
    var updated=bookings.map(function(x){if(x.id!==id) return x;var extra={status:"cancelled",history:(x.history||[]).concat([histEntry(noShow?"no show":"cancelled",user)])};if(noShow) extra.notes=(x.notes?x.notes+"\n":"")+"No show";return Object.assign({},x,extra);});
    saveBookings(applyOpt(updated,viewDate,tableBlocks));
    setConfirmCancel(null);flash();
  }
  function manualAssign(bookingId,tables,locked,affected){
    var user=getUser();
    var updated=bookings.map(function(x){
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
    // Re-optimize to reassign affected bookings to new tables
    var bk=bookings.find(function(x){return x.id===bookingId;});
    var bkDate=bk?bk.date:viewDate;
    var fin=(affected&&affected.length>0)?applyOpt(updated,bkDate,tableBlocks):updated;
    saveBookings(fin);
    setManualTarget(null);
    if(affected&&affected.length>0) flash();
  }

  function addBlock(block){
    var next=tableBlocks.concat([block]);
    saveBlocks(next);
    saveBookings(applyOpt(bookings,block.date,next));
    flash();
    setBlockTarget(null);
  }
  function removeBlock(block){
    var next=tableBlocks.filter(function(bl){return !(bl.tableId===block.tableId&&bl.date===block.date&&bl.allDay===block.allDay&&bl.from===block.from&&bl.to===block.to);});
    saveBlocks(next);
    saveBookings(applyOpt(bookings,block.date,next));
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
    var tables=trialFits(bookings,form.date,form.time,size,form.preference||"auto",d,tableBlocks,editId,form.preferredTables);
    if(tables) return {ok:true,tables:tables,sugg:null};
    var sugg=findTimes(form.date,size,form.preference,bookings,d,sm,tableBlocks,editId);
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
          backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",
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
      RC("div",{style:{textAlign:"center",marginBottom:4}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"#0d9488",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Preferred table")),
      RC("div",{style:{fontSize:13,color:S.text,marginBottom:14}},"Soft hint — optimizer tries this first, falls back if unavailable."),
      RC("div",{style:{marginBottom:14,padding:"10px 14px",borderRadius:14,background:"rgba(255,255,255,0.35)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"2px solid "+(capOk?"rgba(134,239,172,0.6)":"rgba(255,255,255,0.5)"),boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
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
  var kitchenSection=kitchenLoad?RC("div",{style:{padding:"10px 14px",borderRadius:14,border:"2px solid "+(kitchenBusy?"rgba(253,186,116,0.55)":"rgba(255,255,255,0.45)"),background:kitchenBusy?"rgba(255,237,213,0.6)":"rgba(255,255,255,0.35)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",marginBottom:14,fontSize:13,color:kitchenBusy?"#9a3412":S.muted}},
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

  var historyPopup=(function(){
    if(!showHistory||!editId) return null;
    var cur=bookings.find(function(b){return b.id===editId;});
    var hist=cur&&cur.history&&cur.history.length>0?cur.history:[];
    var reversed=hist.slice().reverse();
    return RC(Overlay,{onClose:function(){setShowHistory(false);}},
      RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:12,color:S.text}},"Booking history"),
      RC("div",{style:{fontSize:13,color:S.muted,marginBottom:12}},cur?(cur.name+" — "+cur.date+" "+cur.time):""),
      RC("div",{style:{maxHeight:300,overflowY:"auto",borderRadius:14,border:"2px solid rgba(160,170,190,0.4)",background:"rgba(255,255,255,0.35)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",padding:"10px 12px",boxShadow:"inset 0 1px 4px rgba(0,0,0,0.06)"}},
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

  var errorEl=error?RC("div",{style:{color:"#991b1b",fontSize:13,padding:"10px 14px",background:"rgba(254,226,226,0.7)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",borderRadius:14,border:"2px solid rgba(252,165,165,0.55)",marginBottom:14}},error):null;

  var reshuffledBanner=reshuffled?RC("div",{style:{background:"rgba(254,249,195,0.7)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"2px solid rgba(253,230,138,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#854d0e",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},"Tables re-optimised."):null;
  var ineffBanner=(!reshuffled&&inefficient&&dismissedIneff!==viewDate)?RC("div",{style:{background:"rgba(255,237,213,0.7)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"2px solid rgba(253,186,116,0.55)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"#9a3412",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},RC("span",null,"Tables could be reshuffled for better efficiency."),RC("div",{style:{display:"flex",gap:6}},RC("button",{onClick:function(){setDismissedIneff(viewDate);},style:mkBtn({fontSize:13,minHeight:36,padding:"6px 14px",background:BTN.dismiss})},"Dismiss"),RC("button",{onClick:forceReshuffle,style:{background:BTN.orange,color:"#fff",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"6px 14px",cursor:"pointer",fontSize:13,fontWeight:600,minHeight:36,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Reshuffle"))):null;

  var resetDurBtn=form.customDur?RC("button",{key:"rd",style:mkBtn({fontSize:12,background:BTN.reset}),onPointerDown:function(){setForm(function(f){return Object.assign({},f,{customDur:null});})}},  "Reset"):null;
  var endTime=form.time?toTime(toMins(form.time)+dur):"--";


  var mainView=view==="timeline"
    ?RC(TimelineView,{bookings:bookings,date:viewDate,onEdit:openEdit,onManual:function(id){setManualTarget(id);},onStatus:updateStatus,blocks:tableBlocks,onBlock:function(id){setBlockTarget(id);},nowMins:nowMins,warnings:overlapWarnings,zoom:timelineZoom,setZoom:setTimelineZoom,scrollPosRef:timelineScrollRef,followNow:followNow,setFollowNow:setFollowNow})
    :RC(ListView,{bookings:bookings,date:viewDate,onEdit:openEdit,onStatus:updateStatus,onDelete:function(id){setConfirmDel(id);},onManual:function(id){setManualTarget(id);},nowMins:nowMins,warnings:overlapWarnings});

  var formModal=showForm?RC(Overlay,{onClose:function(){setShowForm(false);}},
    RC("div",{style:{textAlign:"center",marginBottom:16}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"rgba(0,122,255,0.75)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},editId?"Edit booking":"New booking")),
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
          RC("button",{style:{background:"rgba(255,255,255,0.45)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.max(1,(Number(form.size)||2)-1);setForm(function(f){return Object.assign({},f,{size:v});});}},"-"),
          RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},String(Number(form.size)||2)),
          RC("button",{style:{background:"rgba(255,255,255,0.45)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.min(25,(Number(form.size)||2)+1);setForm(function(f){return Object.assign({},f,{size:v});});}},"+"))),
        RC(Fld,{label:"Duration"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
          RC("button",{style:{background:"rgba(255,255,255,0.45)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.max(15,Math.min(480,dur-15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}},"-"),
          RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},dur+" min"),
          RC("button",{style:{background:"rgba(255,255,255,0.45)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();var v=Math.max(15,Math.min(480,dur+15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}},"+"),
          RC("span",{style:{fontSize:13,color:S.text,marginLeft:4}},"End: "+endTime),
          resetDurBtn)))),
    kitchenSection,
    tablesBtn,
    availBanner,
    quickStatusBtns,
    RC(Section,null,
      RC(Fld,{label:"Notes"},RC("textarea",{value:form.notes,onChange:function(e){setForm(function(f){return Object.assign({},f,{notes:e.target.value});});},rows:2,placeholder:"Allergies, special requests...",style:Object.assign({},inp(),{resize:"vertical"})}))),
    errorEl,
    RC("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:18}},
      historyBtn||RC("div",null),
      RC("div",{style:{display:"flex",gap:8}},
        RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:function(){setShowForm(false);}},"Cancel"),
        RC("button",{onClick:save,style:{background:"rgba(0,122,255,0.8)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 22px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:"0 2px 8px rgba(0,122,255,0.25), inset 0 1px 1px rgba(255,255,255,0.2)"}},"Save booking")))):null;

  var delModal=confirmDel?RC(Overlay,{onClose:function(){setConfirmDel(null);}},
    RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}},"Delete booking?"),
    RC("div",{style:{fontSize:14,color:S.text,marginBottom:18}},"Tables will be re-optimised after deletion."),
    RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8}},
      RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:function(){setConfirmDel(null);}},"Cancel"),
      RC("button",{onClick:function(){delBooking(confirmDel);},style:{background:"#dc2626",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Delete"))):null;

  var manualModal=manualBooking?RC(ManualModal,{booking:manualBooking,bookings:manualTarget==="__new__"?bookings.filter(function(b){return b.date===form.date;}):bookings,blocks:tableBlocks,onSave:function(tables,locked,affected){if(manualTarget==="__new__"){setForm(function(f){return Object.assign({},f,{manualTables:tables});});setSwapAffected(affected||null);setManualTarget(null);}else{manualAssign(manualBooking.id,tables,locked,affected);}},onClose:function(){setManualTarget(null);}}):null;

  var walkinModal=(function(){
    if(!showWalkin) return null;
    var wf=walkinForm;
    var wSize=Number(wf.size)||2;
    var wTime=wf.time||nowTime();
    var wDur=wf.customDur||getDur(wSize);
    var wDate=new Date().toISOString().slice(0,10);
    var wS=toMins(wTime),wE=wS+wDur;
    var wOther=bookings.filter(function(b){return b&&b.date===wDate&&b.status!=="cancelled"&&(b.tables||[]).length>0;}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+(b.duration||90)};}).concat(getBlockSlots(tableBlocks,wDate));
    var wBusy=getBusy(wOther,wS,wE);
    var wAutoCheck=(function(){
      var pre=findBest(wSize,"auto",wS,wE,wOther)||(findBestAny(wSize,wS,wE,wOther));
      if(pre) return null;
      var sugg=findTimes(wDate,wSize,"auto",bookings,wDur,wS,tableBlocks);
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
    var wKitchenSection=RC("div",{style:{padding:"10px 14px",borderRadius:14,border:"2px solid "+(wKitchenBusy?"rgba(253,186,116,0.55)":"rgba(255,255,255,0.45)"),background:wKitchenBusy?"rgba(255,237,213,0.6)":"rgba(255,255,255,0.35)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",marginBottom:14,fontSize:13,color:wKitchenBusy?"#9a3412":S.muted}},
      RC("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center"}},
        RC("span",null,RC("span",{style:{fontWeight:700}},"Starting at this time: "),wKitchenStarts+" booking"+(wKitchenStarts!==1?"s":"")+" · "+wKitchenGuests+" guest"+(wKitchenGuests!==1?"s":"")),
        wKitchenBusy?RC("span",{style:{fontWeight:700,color:"#dc2626",fontSize:13,padding:"4px 12px",borderRadius:8,border:"1.5px solid rgba(220,38,38,0.4)",flexShrink:0}},"Kitchen busy"):null),
      wKitchenSugg&&(wKitchenSugg.before.length||wKitchenSugg.after.length)?RC("div",{style:{marginTop:8}},
        RC("div",{style:{fontSize:11,color:S.muted,marginBottom:6}},RC("span",{style:{background:"rgba(220,252,231,0.8)",color:"#166534",padding:"2px 6px",borderRadius:6,fontSize:10,fontWeight:600}},"green")," = tables available  ",RC("span",{style:{background:"rgba(254,249,195,0.8)",color:"#854d0e",padding:"2px 6px",borderRadius:6,fontSize:10,fontWeight:600}},"yellow")," = kitchen ok, tables tight"),
        wKitchenSugg.before.length?RC("div",{style:{marginBottom:4}},RC("span",{style:{fontWeight:700,fontSize:12}},"Before: "),RC("span",{style:{display:"inline-flex",gap:4,flexWrap:"wrap"}},wRenderKT(wKitchenSugg.before))):null,
        wKitchenSugg.after.length?RC("div",null,RC("span",{style:{fontWeight:700,fontSize:12}},"After: "),RC("span",{style:{display:"inline-flex",gap:4,flexWrap:"wrap"}},wRenderKT(wKitchenSugg.after))):null):
      wKitchenBusy?RC("div",{style:{marginTop:6,fontSize:12,color:"#991b1b"}},"No kitchen-friendly alternatives found nearby."):null);
    return RC(Overlay,{onClose:function(){setShowWalkin(false);}},
      RC("div",{style:{textAlign:"center",marginBottom:4}},RC("div",{style:{fontSize:16,fontWeight:700,color:"#fff",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"rgba(22,101,52,0.75)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Walk-in")),
      RC("div",{style:{fontSize:13,color:S.text,marginBottom:16,textAlign:"center"}},"Walk-in "+getNextWalkinNum()+" · Seated"),
      RC(Section,null,
        RC("div",{style:{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}},
          RC(Fld,{label:"Time"},RC("input",{type:"time",value:wTime,onChange:function(e){setWalkinForm(function(f){return Object.assign({},f,{tables:[],time:e.target.value});});},min:"13:00",max:"22:00",style:mkInp()})),
          RC(Fld,{label:"Number of guests"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
            RC("button",{style:{background:"rgba(255,255,255,0.45)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();setWalkinForm(function(f){return Object.assign({},f,{size:Math.max(1,(Number(f.size)||2)-1),tables:[]});});}},"-"),
            RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},String(wSize)),
            RC("button",{style:{background:"rgba(255,255,255,0.45)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();setWalkinForm(function(f){return Object.assign({},f,{size:Math.min(25,(Number(f.size)||2)+1),tables:[]});});}},"+"))),
          RC(Fld,{label:"Duration"},RC("div",{style:{display:"flex",alignItems:"center",gap:6}},
            RC("button",{style:{background:"rgba(255,255,255,0.45)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();setWalkinForm(function(f){var cd=f.customDur||getDur(Number(f.size)||2);return Object.assign({},f,{customDur:Math.max(15,cd-15)});});}},"-"),
            RC("span",{style:{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}},wDur+" min"),
            RC("button",{style:{background:"rgba(255,255,255,0.45)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"},onPointerDown:function(e){e.preventDefault();setWalkinForm(function(f){var cd=f.customDur||getDur(Number(f.size)||2);return Object.assign({},f,{customDur:Math.min(480,cd+15)});});}},"+"),
            RC("span",{style:{fontSize:13,color:S.muted,marginLeft:4}},"End: "+toTime(toMins(wTime)+wDur)),
            wf.customDur?RC("button",{style:mkBtn({fontSize:12,background:BTN.reset}),onPointerDown:function(e){e.preventDefault();setWalkinForm(function(f){return Object.assign({},f,{customDur:null});});}},"Reset"):null)),
        RC(Fld,{label:"Notes",style:{marginTop:12}},RC("textarea",{value:wf.notes,onChange:function(e){setWalkinForm(function(f){return Object.assign({},f,{notes:e.target.value});});},rows:2,placeholder:"Special requests...",style:Object.assign({},mkInp(),{resize:"vertical"})})))),
      RC("div",{style:{fontSize:13,color:S.text,marginBottom:14}},"Tap tables to select / deselect."),
      RC("div",{style:{marginBottom:14,padding:"12px 14px",borderRadius:14,background:"rgba(255,255,255,0.35)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"2px solid "+(wOk?"rgba(134,239,172,0.6)":"rgba(255,255,255,0.5)"),display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}},
        RC("div",null,
          RC("div",{style:{fontSize:14,fontWeight:700,color:S.text}},"Selected: "+(wSel.length?wSel.join(" + "):"none")),
          RC("div",{style:{fontSize:13,color:wSummaryColor,fontWeight:500,marginTop:2}},wSummaryText)),
        wClearBtn),
      RC(TableGrid,{selected:wSel,toggle:wToggle,busy:wBusy,seatedBusy:new Set(),swapBusy:false}),
      wAutoCheck&&wSel.length===0?RC(AvailBanner,{msg:"No tables available at "+wTime+".",sugg:wAutoCheck,warn:true,onTapTime:function(t){setWalkinForm(function(f){return Object.assign({},f,{tables:[],time:t});});}}):null,
      walkinError?RC("div",{style:{color:"#991b1b",fontSize:13,padding:"10px 14px",background:"rgba(254,226,226,0.7)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",borderRadius:14,border:"2px solid rgba(252,165,165,0.55)",marginBottom:14}},walkinError):null,
      wKitchenSection,
      RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,marginTop:18}},
        RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel}),onClick:function(){setConfirmKitchen(null);setShowWalkin(false);}},"Cancel"),
        RC("button",{onClick:saveWalkin,disabled:!wOk,style:{background:wOk?"rgba(22,101,52,0.8)":"rgba(180,180,190,0.4)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 22px",cursor:wOk?"pointer":"not-allowed",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,boxShadow:wOk?"0 2px 8px rgba(22,101,52,0.2), inset 0 1px 1px rgba(255,255,255,0.15)":"none"}},"Seat")));
  })();

  return RC("div",{style:{background:"linear-gradient(135deg, #e8edf5 0%, #dfe6f0 20%, #e2e0ef 40%, #dce8f0 60%, #e5eaf2 80%, #e0e4ee 100%)",minHeight:"100dvh",padding:isMobile?"12px 12px calc(12px + env(safe-area-inset-bottom))":"16px",fontFamily:"-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",color:S.text,boxSizing:"border-box"}},
    RC("div",{style:{maxWidth:1000,margin:"0 auto"}},
      RC("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}},
        RC("div",null,RC("div",{style:{fontSize:isMobile?18:22,fontWeight:700}},"Me Gustas T\u00fa"),RC("div",{style:{fontSize:12,color:S.text,fontWeight:500}},"4 indoor  9 outdoor  "+OPEN+":00 - "+CLOSE+":00")),
        RC("div",{style:{display:"flex",gap:6,flexWrap:"wrap"}},
          ["timeline","list"].map(function(v){return RC("button",{key:v,onClick:function(){setView(v);},style:mkBtn({background:view===v?S.accent:"rgba(120,130,150,0.55)",textTransform:"capitalize",minHeight:40})},v);}),
          RC("button",{onClick:openWalkin,style:{background:"rgba(22,101,52,0.75)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:600,color:"#fff",minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Walk-in"),
          RC("button",{onClick:openNew,style:{background:"rgba(0,122,255,0.75)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:600,color:"#fff",minHeight:40,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}},"+ New"),
          RC("button",{onClick:function(){signOut(auth);},style:mkBtn({fontSize:12,minHeight:40,padding:"8px 14px",background:"rgba(120,130,150,0.5)"})},"Log out"))),
      RC("div",{style:{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}},
        RC("div",{style:{display:"flex",gap:4,alignItems:"center"}},
          RC("button",{onClick:function(){var d=new Date(viewDate);d.setDate(d.getDate()-1);setViewDate(d.toISOString().slice(0,10));},style:mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize:18,background:BTN.nav}),dangerouslySetInnerHTML:{__html:"&#8249;"}}),
          RC("button",{onClick:function(){var d=new Date(viewDate);d.setDate(d.getDate()+1);setViewDate(d.toISOString().slice(0,10));},style:mkBtn({minHeight:40,minWidth:40,padding:"6px 10px",fontSize:18,background:BTN.nav}),dangerouslySetInnerHTML:{__html:"&#8250;"}}),
          RC("input",{type:"date",value:viewDate,onChange:function(e){setViewDate(e.target.value);},style:{fontSize:14,padding:"8px 10px",borderRadius:12,border:"1px solid rgba(255,255,255,0.4)",background:"rgba(255,255,255,0.45)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",color:S.text,fontWeight:600,minWidth:130,minHeight:40,boxSizing:"border-box",boxShadow:"inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"}})),
        RC("div",{style:{display:"flex",gap:6,alignItems:"center"}},
          viewDate!==new Date().toISOString().slice(0,10)?RC("button",{onClick:function(){setViewDate(new Date().toISOString().slice(0,10));},style:mkBtn({minHeight:40,padding:"6px 14px",background:BTN.today})},"Today"):null,
          RC("span",{style:{fontSize:13,color:S.text}},dayCount+" booking"+(dayCount!==1?"s":"")))),
      reshuffledBanner,
      ineffBanner,
      mainView,
      formModal,delModal,manualModal,walkinModal,prefPickerModal,
      blockTarget?RC(BlockModal,{tableId:blockTarget,date:viewDate,blocks:tableBlocks,onSave:addBlock,onRemove:removeBlock,onClose:function(){setBlockTarget(null);}}):null,
      confirmCancel?RC(Overlay,{onClose:function(){setConfirmCancel(null);}},
        RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:S.text}},"Cancel booking?"),
        RC("div",{style:{fontSize:14,color:S.text,marginBottom:18}},"Tables will be re-optimised after cancellation."),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}},
          RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setConfirmCancel(null);}},"Back"),
          RC("button",{onClick:function(){doCancelBooking(confirmCancel,true);setShowForm(false);},style:{background:"#9a3412",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"No show"),
          RC("button",{onClick:function(){doCancelBooking(confirmCancel,false);setShowForm(false);},style:{background:BLOCK_BG.cancelled,border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Cancel booking"))):null,
      confirmKitchen?RC(Overlay,{onClose:function(){setConfirmKitchen(null);}},
        RC("div",{style:{fontSize:17,fontWeight:700,marginBottom:8,color:"#9a3412"}},"Kitchen may be busy"),
        RC("div",{style:{fontSize:14,color:S.text,marginBottom:12}},"There are already "+(confirmKitchen==="walkin"?(function(){var wf=walkinForm;var t=wf.time||nowTime();var d=wf.customDur||getDur(Number(wf.size)||2);var l=getKitchenLoad(bookings,new Date().toISOString().slice(0,10),t,d,null);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})():(function(){var f=formRef.current;var d=f.customDur||getDur(Number(f.size)||2);var l=getKitchenLoad(bookings,f.date,f.time,d,editId);return l.starts+" booking"+(l.starts!==1?"s":"")+" with "+l.guests+" guest"+(l.guests!==1?"s":"");})())+" starting at this time. Check the suggested alternatives below, or confirm to proceed anyway."),
        RC("div",{style:{display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}},
          RC("button",{style:mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"}),onClick:function(){setConfirmKitchen(null);}},"Back"),
          RC("button",{onClick:function(){var isW=confirmKitchen==="walkin";setConfirmKitchen(null);if(isW) doSaveWalkin();else doSave();},style:{background:"#9a3412",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:14,fontWeight:600,color:"#fff",minHeight:44,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"}},"Confirm"))):null,
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
        error?RC("div",{style:{color:"#991b1b",fontSize:13,padding:"8px 12px",background:"rgba(254,226,226,0.7)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",borderRadius:12,border:"2px solid rgba(252,165,165,0.55)"}},error):null,
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
