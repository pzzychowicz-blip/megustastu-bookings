// src/lib/booking-logic.js
// Pure booking-management logic — table assignment, optimization, kitchen-load
// checks, seated-shift, displacement protection. No React, no DOM, no Firebase.
// Fully testable in isolation.
//
// Phase A extraction (v15-refactor): moved verbatim from App v.14.1 dev.jsx
// lines 90–176 (helpers + finders + trial fits) and 195–400 (kitchen, optimise,
// applyOpt, optimizer-OFF helpers). No semantic changes.
//
// Phase C1 additions: helper consolidation. Five new exports moved here from
// component files / App.jsx — `nowTime`, `statusOrder`, `pct`, `liveBarDur`,
// `comboCapBest`. Each preserves its original semantics exactly. See the
// "Phase C1 helpers" section near the bottom of the file.
//
// Internal helpers (prefixed `_`) are not exported; everything else is.

import {
  ALL_TABLES,
  VALID_COMBOS,
  CLUSTERS,
  OPEN,
  GRID_CLOSE,
  KITCHEN_TABLE_LIMIT,
  hoursFor,
  ZONE_OF,
  PRIORITIES
} from "./constants";

// ── Primitive helpers ─────────────────────────────────────────────────────────
export function getDur(s){return s<5?90:120;}
export function toMins(t){var p=t.split(":");return Number(p[0])*60+Number(p[1]);}
export function toTime(m){return String(Math.floor(m/60)%24).padStart(2,"0")+":"+String(m%60).padStart(2,"0");}
export function overlaps(s1,e1,s2,e2){return s1<e2&&e1>s2;}
export function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

// ── Booking sanitisation / diffing ────────────────────────────────────────────
export function sanitize(b){if(!b||typeof b!=="object") return null;var t=b.time||"13:00";return {id:b.id||genId(),name:b.name||"",phone:b.phone||"",date:b.date||"",time:t,scheduledTime:b.scheduledTime||t,size:Number(b.size)||2,duration:Number(b.duration)||90,originalDuration:Number(b.originalDuration)||Number(b.duration)||90,preference:b.preference||"auto",notes:b.notes||"",status:b.status||"confirmed",tables:Array.isArray(b.tables)?b.tables:[],customDur:b.customDur||null,_manual:!!b._manual,_locked:!!b._locked,_conflict:!!b._conflict,preferredTables:Array.isArray(b.preferredTables)?b.preferredTables:[],returnOf:b.returnOf||null,history:Array.isArray(b.history)?b.history:[],
  // v16.0.0: no-show flag set by doCancelBooking(id,noShow=true). Whitelisted so
  // it survives reads; legacy no-shows (history entry only) are counted by
  // customers.js isNoShow's history fallback — no migration needed.
  noShow:!!b.noShow,
  // v15.5.0: per-booking revision stamp for the per-node write model. Carried
  // through sanitise so it survives reads (this whitelist would otherwise drop
  // it) — used by usePersistence's write-diff/stamp + the per-$id Security Rule.
  updatedAt:Number(b.updatedAt)||0};}
export function histEntry(action,user){return {at:new Date().toISOString(),by:user||"staff",action:action};}
export function diffBooking(orig,f,size){var ch=[];if(orig.name!==f.name) ch.push("name "+orig.name+"→"+f.name);if(size!==orig.size) ch.push("size "+orig.size+"→"+size);if(f.time!==orig.time) ch.push("time "+orig.time+"→"+f.time);if(f.date!==orig.date) ch.push("date "+orig.date+"→"+f.date);if(f.preference!==orig.preference) ch.push("pref "+orig.preference+"→"+f.preference);var origPhone=orig.phone||"";var formPhone=f.phone&&f.phone.trim()!=="+"?f.phone.trim():"";if(origPhone!==formPhone) ch.push("phone "+(origPhone||"none")+"→"+(formPhone||"none"));var origDur=orig.originalDuration||orig.duration||90;var formDur=f.customDur||getDur(size);if(origDur!==formDur) ch.push("duration "+origDur+"→"+formDur+"min");if(f.status!==orig.status) ch.push("status "+orig.status+"→"+f.status);if(f.notes!==(orig.notes||"")) ch.push("notes updated");var mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:null;if(mt) ch.push("tables manually set: "+mt.join(", "));if(f._clearManual) ch.push("manual assignment cleared");var pt=Array.isArray(f.preferredTables)?f.preferredTables:[];var origPt=Array.isArray(orig.preferredTables)?orig.preferredTables:[];if(pt.slice().sort().join(",")!==origPt.slice().sort().join(",")) ch.push("preferred tables: "+(pt.length?pt.join(", "):"cleared"));return ch.length?ch.join(", "):"saved (no field changes)";}
export function sanitizeAll(arr){if(!arr) return [];if(!Array.isArray(arr)){var vals=Object.values(arr);return vals.map(sanitize).filter(Boolean);}return arr.map(sanitize).filter(Boolean);}

// ── Table classification ──────────────────────────────────────────────────────
// v15.0.0: indoor classification is data-driven via the layout config's zones
// (ZONE_OF), not the legacy id.startsWith("i") convention — so a re-zoned or
// arbitrarily-named table is classified correctly. Falls back to the "i" prefix
// only if the id is somehow absent from the map (defensive).
export function isIn(id){return ZONE_OF[id]?ZONE_OF[id]==="indoor":String(id).startsWith("i");}
export function isAllIn(ids){return ids.every(isIn);}
export function isAllOut(ids){return ids.every(function(id){return !isIn(id);});}
// v15.0.0 Phase 5 / v15.9.0: a "mixed-large" combo spans both zones. When the
// priorities config names required tables (PRIORITIES.mixedRequire — MGT's seed:
// 1A+1B+7), a cross-zone set is allowed only when it includes ALL of them;
// otherwise any cross-zone set that is a DECLARED combo (in VALID_COMBOS) is allowed.
export function isMixedLarge(ids){
  if(!ids.some(isIn)||!ids.some(function(id){return !isIn(id);})) return false;
  var req=PRIORITIES.mixedRequire;
  if(req.length) return req.every(function(id){return ids.includes(id);});
  var k=ids.slice().sort().join("|");
  return VALID_COMBOS.some(function(c){return c.ids.slice().sort().join("|")===k;});
}
export function comboOk(ids,pref){var mixed=!isAllIn(ids)&&!isAllOut(ids);if(mixed&&pref!=="auto") return false;if(mixed&&!isMixedLarge(ids)) return false;if(pref==="indoor") return isAllIn(ids);if(pref==="outdoor") return isAllOut(ids);return true;}
export function comboCap(ids){var k=ids.slice().sort().join("|");var c=VALID_COMBOS.find(function(x){return x.ids.slice().sort().join("|")===k;});return c?c.cap:ids.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);}
export function isLocked(b){return b&&(b._locked===true||b.status==="seated");}
export function isActive(b){return b.status!=="cancelled"&&b.status!=="completed";}

// ── Slot/busy/assignment checks ───────────────────────────────────────────────
export function getBlockSlots(blocks,date){
  // v15.0.0: an all-day block spans the BLOCK'S date's hours, not the active
  // view-day's — hoursFor(date) keeps it correct when date ≠ viewDate.
  var h=hoursFor(date);
  return blocks.filter(function(bl){return bl.date===date;}).map(function(bl){
    var s=bl.allDay?h.open*60:toMins(bl.from);
    var e=bl.allDay?h.gridClose*60:toMins(bl.to);
    return {tables:[bl.tableId],s:s,e:e};
  });
}
export function getBusy(slots,s,e){var busy=new Set();slots.forEach(function(sl){if(!overlaps(s,e,sl.s,sl.e)) return;sl.tables.forEach(function(id){busy.add(id);});});return busy;}
// v15.1.1: occupancy end-minute of booking `b` for availability checks, given
// the real current minute `nowM`. A still-`seated` guest physically holds the
// table THROUGH now even once their live end has reached the present minute
// (overstay): syncLiveDurations sets a seated overstayer's end to exactly `now`,
// and getBusy's half-open overlap (s1<e2) then reads the slot as FREE for a
// walk-in starting at that same minute. For an overstaying seated booking
// (e<=nowM) we extend the end to nowM+1 so a query at `now` reads busy.
// Deliberately keyed on `nowM`, NOT the query window: a FUTURE query (a walk-in
// time set past now) must still see the table free — the guest is expected to
// have left by then. Non-overstaying seated bookings (e>nowM) and any non-seated
// booking are returned unchanged (a no-show `confirmed` past its time stays free).
export function occupancyEnd(b,nowM){
  var e=toMins(b.time)+(b.duration||90);
  if(b.status==="seated"&&e<=nowM) return nowM+1;
  return e;
}
export function canAssign(ids,slots,s,e){
  var busy=getBusy(slots,s,e);
  if(ids.some(function(id){return busy.has(id);})) return false;
  if(ids.length<2) return true;
  var mc={};ids.forEach(function(id){var cl=CLUSTERS[id];if(!cl||cl.length<2) return;var k=cl.slice().sort().join("|");if(!mc[k]) mc[k]=0;mc[k]++;});
  for(var i=0;i<slots.length;i++){var sl=slots[i];if(!overlaps(s,e,sl.s,sl.e)||sl.tables.length<2) continue;var tc={};sl.tables.forEach(function(id){var cl=CLUSTERS[id];if(!cl||cl.length<2) return;var k=cl.slice().sort().join("|");if(!tc[k]) tc[k]=0;tc[k]++;});var ks=Object.keys(mc);for(var j=0;j<ks.length;j++){if(mc[ks[j]]>=2&&tc[ks[j]]&&tc[ks[j]]>=2) return false;}}
  return true;
}

// ── Combo prioritisation (internal) ───────────────────────────────────────────
// v15.9.0: _indoorPri + _comboPri are DATA-DRIVEN via PRIORITIES (settings/layout
// .priorities) — MGT's hand-tuned literals became DEFAULT_LAYOUT's seed values
// (byte-identical output, proven by the v15.9.0 regression script). With an empty
// config both return 0 (no preference) — the optimizer then ranks combos purely by
// _comboLoc (zone grouping, layout-agnostic) + capacity/length. _comboLoc stays on.
// _indoorPri: ranked anchor tables inside cross-zone combos; the earliest-ranked
// anchor present wins, boost = anchors.length - index (MGT seed: i4→2, i1→1).
function _indoorPri(c){var an=PRIORITIES.anchors;for(var i=0;i<an.length;i++){if(c.ids.indexOf(an[i])>=0) return an.length-i;}return 0;}
function _comboLoc(c){if(isAllOut(c.ids)) return 0;if(isAllIn(c.ids)) return 1;return 2;}
// _comboPri: first comboRule matching (key, size band) wins — avoid → +100 (last
// resort), else -weight (more negative sorts earlier). No match → 0.
function _comboPri(c,size){var k=c.ids.slice().sort().join("|");var rules=PRIORITIES.comboRules;for(var i=0;i<rules.length;i++){var r=rules[i];if(r.key===k&&size>=r.min&&size<=r.max) return r.avoid?100:-r.weight;}return 0;}

// ── Best-table finders ────────────────────────────────────────────────────────
export function findBest(size,pref,s,e,slots){
  var sg=ALL_TABLES.filter(function(t){return t.capacity>=size&&comboOk([t.id],pref)&&canAssign([t.id],slots,s,e);});
  var co=VALID_COMBOS.filter(function(c){return c.cap>=size&&comboOk(c.ids,pref)&&canAssign(c.ids,slots,s,e);}).sort(function(a,b){var pa=_comboPri(a,size),pb=_comboPri(b,size);if(pa!==pb) return pa-pb;var la=_comboLoc(a),lb=_comboLoc(b);if(la!==lb) return la-lb;if(la===2){var ia=_indoorPri(a),ib=_indoorPri(b);if(ia!==ib) return ib-ia;}return a.cap-b.cap||a.ids.length-b.ids.length;});
  // v15.9.0: data-driven single-table selection. The first PRIORITIES band whose
  // min≤size≤max supplies the rules (MGT seed: hold 7 back from ≤2 with a per-size
  // zone order; prefer 7 for 3–4 with combos before singles). A size with NO band
  // takes the generic path: smallest-capacity single that fits (least wasted
  // seats), else the best combo. Byte-identical to the pre-v15.9.0 literals for
  // both the MGT seed and an empty config (regression-proven).
  var band=PRIORITIES.bands.find(function(b){return size>=b.min&&size<=b.max;});
  if(!band){
    if(sg.length) return [sg.slice().sort(function(a,b){return a.capacity-b.capacity;})[0].id];
    if(co.length) return co[0].ids;
    return null;
  }
  // 1. Ranked prefer list — each entry needs capacity, zone-pref fit and a free slot.
  for(var i=0;i<band.prefer.length;i++){
    var pid=band.prefer[i];
    var pt=ALL_TABLES.find(function(t){return t.id===pid;});
    if(pt&&pt.capacity>=size&&comboOk([pid],pref)&&canAssign([pid],slots,s,e)) return [pid];
  }
  // 2. Singles: non-avoided by zoneOrder → first non-avoided (ALL_TABLES order) →
  //    any single (avoided = last resort). Order vs combos flips on combosFirst.
  function bandSingle(){
    var ok=sg.filter(function(t){return band.avoid.indexOf(t.id)<0;});
    for(var z=0;z<band.zoneOrder.length;z++){
      var indoorZone=band.zoneOrder[z]==="indoor";
      var zs=ok.filter(function(t){return isIn(t.id)===indoorZone;});
      if(zs.length) return [zs[0].id];
    }
    if(ok.length) return [ok[0].id];
    if(sg.length) return [sg[0].id];
    return null;
  }
  if(band.combosFirst){
    if(co.length) return co[0].ids;
    var st=bandSingle();if(st) return st;
    return null;
  }
  var st2=bandSingle();if(st2) return st2;
  if(co.length) return co[0].ids;
  return null;
}
export function findBestAny(size,s,e,slots){
  var r=findBest(size,"outdoor",s,e,slots)||findBest(size,"indoor",s,e,slots);
  if(r) return r;
  var busy=getBusy(slots,s,e);
  var mx=VALID_COMBOS.filter(function(c){return c.cap>=size&&c.ids.every(function(id){return !busy.has(id);})&&isMixedLarge(c.ids)&&canAssign(c.ids,slots,s,e);}).sort(function(a,b){return _indoorPri(b)-_indoorPri(a)||a.cap-b.cap||a.ids.length-b.ids.length;});
  return mx.length?mx[0].ids:null;
}

// ── Trial-fit + alternative-time finders ──────────────────────────────────────
export function trialFits(bookings,date,time,size,pref,dur,blocks,editId,prefTables,noReshuffle){
  // When optimizer is OFF for today: slot-only check, no reshuffle simulation
  if(noReshuffle){
    return findFreeSlot(bookings,date,time,size,pref,dur,blocks,editId,prefTables);
  }
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
export function findTimes(date,size,pref,existing,dur,around,blocks,editId,noReshuffle){
  var h=hoursFor(date); // v15.0.0: per-weekday hours for THIS date
  if(h.closed) return []; // closed day → no valid times
  var times=Array.from({length:(h.close-h.open)*4},function(_,i){return h.open*60+i*15;});
  var aroundM=around||0;
  var valid=times.filter(function(m){
    if(m>=24*60) return false; // v14.5.0: never suggest a post-midnight start (24h-hours is extend-window only)
    if(m+dur>h.close*60) return false;
    if(m===aroundM) return false;
    return !!trialFits(existing,date,toTime(m),size,pref,dur,blocks,editId,null,noReshuffle);
  });
  return valid;
}
export function formatSugg(sugg,around){
  if(!sugg||!sugg.length) return {earlier:[],later:[]};
  var before=sugg.filter(function(s){return s<around;}).slice(-10).map(toTime);
  var after=sugg.filter(function(s){return s>around;}).slice(0,10).map(toTime);
  return {earlier:before,later:after};
}

// ── Kitchen-load helpers ──────────────────────────────────────────────────────
export function getKitchenLoad(bookings,date,time,dur,excludeId){
  if(!time) return {tables:0,guests:0,starts:0};
  var s=toMins(time);
  var active=bookings.filter(function(b){return b&&b.date===date&&b.status!=="cancelled"&&b.status!=="completed"&&b.id!==excludeId;});
  var starting=active.filter(function(b){var bs=toMins(b.time);return Math.abs(bs-s)<15;});
  var tblCount=0;var guests=0;
  starting.forEach(function(b){guests+=b.size||2;tblCount+=(b.tables||[]).length||1;});
  return {tables:tblCount,guests:guests,starts:starting.length};
}
export function findKitchenFriendlyTimes(bookings,date,size,pref,dur,around,excludeId,blocks){
  var h=hoursFor(date); // v15.0.0: per-weekday hours for THIS date
  if(h.closed) return {before:[],after:[]}; // closed day → no times to suggest
  var times=Array.from({length:(h.close-h.open)*4},function(_,i){return h.open*60+i*15;});
  var aroundM=toMins(around);
  var results=[];
  // v16.0.0 follow-up: completed excluded — a completed visit's table is free
  // (its duration is frozen at the completion moment; app-wide rule).
  var exSl=bookings.filter(function(b){return b.date===date&&b.status!=="cancelled"&&b.status!=="completed";}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:toMins(b.time)+b.duration};});
  if(blocks) exSl=exSl.concat(getBlockSlots(blocks,date));
  times.forEach(function(m){
    if(m===aroundM) return;
    if(m>=24*60) return; // v14.5.0: never suggest a post-midnight start (24h-hours is extend-window only)
    if(m+dur>h.close*60) return;
    var load=getKitchenLoad(bookings,date,toTime(m),dur,excludeId);
    if(load.starts+1>=KITCHEN_TABLE_LIMIT) return;
    var hasTables=!!findBest(size,pref,m,m+dur,exSl)||(pref==="auto"?!!findBestAny(size,m,m+dur,exSl):false);
    results.push({time:m,timeStr:toTime(m),hasTables:hasTables});
  });
  var before=results.filter(function(r){return r.time<aroundM;}).slice(-5);
  var after=results.filter(function(r){return r.time>aroundM;}).slice(0,5);
  return {before:before,after:after};
}
export function findAllOptions(size,pref,s,e,slots){
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

// ── Optimizer (greedy + retry passes) ─────────────────────────────────────────
function _runGreedy(day,baseSlots){
  var slots=baseSlots.slice();var assigned={};
  day.forEach(function(b){if(!b||!b.time) return;var s=toMins(b.time),e=s+(b.duration||90);var tables;if(isLocked(b)){tables=b.tables;}else{
    if(b.preferredTables&&b.preferredTables.length>0){var pt=b.preferredTables;var ptCap=comboCap(pt);if(ptCap>=(b.size||2)&&canAssign(pt,slots,s,e)) tables=pt;}
    if(!tables){tables=findBest(b.size||2,b.preference||"auto",s,e,slots);if(!tables) tables=findBestAny(b.size||2,s,e,slots);}}assigned[b.id]=tables||null;if(tables) slots.push({tables:tables,s:s,e:e});});
  return assigned;
}
export function optimise(bookings,date,blocks){
  var completed=bookings.filter(function(b){return b&&b.date===date&&b.status==="completed"&&(b.tables||[]).length>0;});
  var baseSlots=completed.map(function(b){return {tables:b.tables,s:toMins(b.time),e:toMins(b.time)+(b.duration||90)};});
  if(blocks) baseSlots=baseSlots.concat(getBlockSlots(blocks,date));
  var day=bookings.filter(function(b){return b&&b.date===date&&isActive(b);}).sort(function(a,b){var la=isLocked(a)?0:1,lb=isLocked(b)?0:1;if(la!==lb) return la-lb;if(b.size!==a.size) return b.size-a.size;var pa=a.preference!=="auto"?0:1,pb=b.preference!=="auto"?0:1;if(pa!==pb) return pa-pb;return toMins(a.time)-toMins(b.time);});
  // First pass
  var assigned=_runGreedy(day,baseSlots);
  // Swap pass — v15.9.0: data-driven via PRIORITIES.swapRules (was the MGT-only
  // hard-coded table-7 swap). For each rule {table, fromSize, toSize}: if a party
  // of `fromSize` holds exactly [table] and an overlapping party of `toSize`
  // exists without it, trial giving the table to the `toSize` party and let
  // greedy re-assign everyone else; accept only if the unassigned count doesn't
  // grow. Empty rules → pass skipped (the pre-v15.9.0 generic behaviour).
  PRIORITIES.swapRules.forEach(function(rule){
    var holders=day.filter(function(b){return !isLocked(b)&&assigned[b.id]&&assigned[b.id].length===1&&assigned[b.id][0]===rule.table&&b.size===rule.fromSize;});
    holders.forEach(function(fb){var fs=toMins(fb.time),fe=fs+(fb.duration||90);var three=day.find(function(b){return !isLocked(b)&&b.size===rule.toSize&&b.id!==fb.id&&overlaps(fs,fe,toMins(b.time),toMins(b.time)+(b.duration||90))&&(!assigned[b.id]||assigned[b.id][0]!==rule.table);});if(!three) return;var lockedSlots=baseSlots.slice();day.forEach(function(b){if(isLocked(b)&&b.tables) lockedSlots.push({tables:b.tables,s:toMins(b.time),e:toMins(b.time)+(b.duration||90)});});var ts=toMins(three.time),te=ts+(three.duration||90);if(!canAssign([rule.table],lockedSlots,ts,te)) return;var trialSlots=lockedSlots.slice();trialSlots.push({tables:[rule.table],s:ts,e:te});var trialAssigned={};trialAssigned[three.id]=[rule.table];var others=day.filter(function(b){return b.id!==three.id&&!isLocked(b);}).sort(function(a,b){return b.size-a.size||toMins(a.time)-toMins(b.time);});others.forEach(function(b){var bs=toMins(b.time),be=bs+(b.duration||90);var tables;if(b.preferredTables&&b.preferredTables.length>0){var pt=b.preferredTables;if(comboCap(pt)>=(b.size||2)&&canAssign(pt,trialSlots,bs,be)) tables=pt;}if(!tables){tables=findBest(b.size||2,b.preference||"auto",bs,be,trialSlots);if(!tables) tables=findBestAny(b.size||2,bs,be,trialSlots);}trialAssigned[b.id]=tables||null;if(tables) trialSlots.push({tables:tables,s:bs,e:be});});day.forEach(function(b){if(isLocked(b)) trialAssigned[b.id]=b.tables;});var curUn=day.filter(function(b){return !isLocked(b)&&!assigned[b.id];}).length;var tryUn=day.filter(function(b){return !isLocked(b)&&!trialAssigned[b.id];}).length;if(tryUn<=curUn) assigned=trialAssigned;});
  });
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
export function applyOpt(bookings,date,blocks){
  var map=optimise(bookings,date,blocks);
  return bookings.map(function(b){if(b.date!==date||b.status==="cancelled") return Object.assign({},b);if(b.status==="completed") return Object.assign({},b,{_conflict:false});var tables=isLocked(b)?b.tables:(map[b.id]||[]);return Object.assign({},b,{tables:tables,_conflict:!tables||!tables.length});});
}

// ── Optimizer-OFF helpers ─────────────────────────────────────────────────────
// When the auto-optimizer is OFF (after 15:00 today), we do not reshuffle other
// bookings. We only find a free slot for the booking being added/edited.
export function optimizerActiveFor(date,autoOptimizerState){
  var today=new Date().toISOString().slice(0,10);
  if(date===today&&autoOptimizerState===false) return false;
  return true;
}
export function syncLiveDurations(bookings,today,nowM){
  return bookings.map(function(b){
    if(b.date===today&&b.status==="seated"){
      var elapsed=nowM-toMins(b.time);
      if(elapsed>(b.duration||90)) return Object.assign({},b,{duration:elapsed,customDur:elapsed});
    }
    return b;
  });
}

// ── v14: Seated start-time adjustment helper ─────────────────────────────────
// When a booking's status flips to "seated", its actual start time should match
// NOW (whether the guest arrived early OR late) and the end time stays pinned to
// the ORIGINAL scheduled end — so new duration = scheduledEnd - NOW.
// Returns null (no shift) when:
//   (1) now === scheduledStart (no adjustment needed)
//   (2) now >= scheduledEnd   (arriving past original end; nonsensical to shrink)
//   (3) shifted window [now, scheduledEnd] would overlap an active booking on
//       any shared table (per user rule 3a: don't shift).
// Otherwise returns {newTime, newDuration, oldTime, direction}.
export function applySeatedShift(booking,nowM,allBookings){
  if(!booking||!booking.time) return null;
  var scheduledStart=toMins(booking.time);
  var scheduledDur=booking.duration||90;
  var scheduledEnd=scheduledStart+scheduledDur;
  if(nowM===scheduledStart) return null;
  if(nowM>=scheduledEnd) return null;
  var myTables=booking.tables||[];
  if(myTables.length>0){
    var conflict=allBookings.some(function(other){
      if(!other||other.id===booking.id) return false;
      if(other.date!==booking.date) return false;
      if(other.status==="cancelled"||other.status==="completed") return false;
      if(!other.tables||!other.tables.length) return false;
      var shared=myTables.some(function(t){return other.tables.includes(t);});
      if(!shared) return false;
      var os=toMins(other.time);
      var oe=os+(other.duration||90);
      return overlaps(nowM,scheduledEnd,os,oe);
    });
    if(conflict) return null;
  }
  return {newTime:toTime(nowM),newDuration:scheduledEnd-nowM,oldTime:booking.time,direction:nowM<scheduledStart?"early":"late"};
}
export function findFreeSlot(bookings,date,time,size,pref,dur,blocks,editId,prefTables){
  // v16.0.0 follow-up: completed excluded — a completed visit's table is free.
  var slots=bookings.filter(function(b){return b.date===date&&b.status!=="cancelled"&&b.status!=="completed"&&b.id!==editId&&(b.tables||[]).length>0;}).map(function(b){return {tables:b.tables,s:toMins(b.time),e:toMins(b.time)+(b.duration||90)};});
  if(blocks) slots=slots.concat(getBlockSlots(blocks,date));
  var s=toMins(time),e=s+dur;
  var pt=Array.isArray(prefTables)?prefTables:[];
  if(pt.length>0&&canAssign(pt,slots,s,e)&&comboOk(pt,pref||"auto")&&comboCap(pt)>=size) return pt;
  var tables=findBest(size,pref||"auto",s,e,slots);
  if(!tables&&(pref||"auto")==="auto") tables=findBestAny(size,s,e,slots);
  return tables;
}
// Drop-in replacement for applyOpt() in user-triggered actions. Respects the
// autoOptimizer state for today. When ON → applyOpt as usual. When OFF → keep
// all existing tables untouched; only reassign `changedId` if forceReassign.
export function bookingsAfterAction(updatedBks,date,blocks,changedId,forceReassign,autoOptimizerState){
  var today=new Date().toISOString().slice(0,10);
  var d=new Date();var nowM=d.getHours()*60+d.getMinutes();
  var synced=syncLiveDurations(updatedBks,today,nowM);
  if(optimizerActiveFor(date,autoOptimizerState)) return applyOpt(synced,date,blocks);
  // OFF path: preserve everyone's tables
  if(!changedId||!forceReassign) return synced.map(function(b){return Object.assign({},b);});
  // Find a slot for changedId without touching others
  var target=synced.find(function(b){return b.id===changedId;});
  if(!target||target.date!==date||!isActive(target)) return synced.map(function(b){return Object.assign({},b);});
  if(isLocked(target)&&(target.tables||[]).length>0) return synced.map(function(b){return Object.assign({},b);});
  var tables=findFreeSlot(synced.filter(function(b){return b.id!==changedId;}),date,target.time,target.size||2,target.preference||"auto",target.duration||90,blocks,null,target.preferredTables);
  return synced.map(function(b){
    if(b.id===changedId) return Object.assign({},b,{tables:tables||[],_conflict:!tables||!tables.length});
    return Object.assign({},b);
  });
}

// ── Validation / efficiency check ─────────────────────────────────────────────
export function verifyClean(bookings,date){
  var day=bookings.filter(function(b){return b.date===date&&isActive(b)&&(b.tables||[]).length>0;});
  for(var i=0;i<day.length;i++){for(var j=i+1;j<day.length;j++){var a=day[i],b=day[j];var as=toMins(a.time),ae=as+a.duration,bs=toMins(b.time),be=bs+b.duration;if(!overlaps(as,ae,bs,be)) continue;if(!canAssign(b.tables,[{tables:a.tables,s:as,e:ae}],bs,be)) return false;}}
  return true;
}
// v15.6.1: the ids version of verifyClean's pair-scan — returns every booking
// involved in a same-table overlap on `date` (active, assigned-tables only).
// Used by App.jsx's post-sync reconciliation to pick which booking to relocate
// when the optimiser is OFF. Mirrors verifyClean's loop exactly; collects ids
// instead of short-circuiting to a boolean.
export function findConflicts(bookings,date){
  var day=bookings.filter(function(b){return b.date===date&&isActive(b)&&(b.tables||[]).length>0;});
  var hit={};
  for(var i=0;i<day.length;i++){for(var j=i+1;j<day.length;j++){var a=day[i],b=day[j];var as=toMins(a.time),ae=as+a.duration,bs=toMins(b.time),be=bs+b.duration;if(!overlaps(as,ae,bs,be)) continue;if(!canAssign(b.tables,[{tables:a.tables,s:as,e:ae}],bs,be)){hit[a.id]=true;hit[b.id]=true;}}}
  return Object.keys(hit);
}
export function checkInefficent(bookings,date){
  var day=bookings.filter(function(b){return b.date===date&&isActive(b)&&!isLocked(b);});
  return day.some(function(b){var oth=day.filter(function(x){return x.id!==b.id;}).map(function(x){return {tables:x.tables,s:toMins(x.time),e:toMins(x.time)+x.duration};});var best=findBest(b.size,b.preference,toMins(b.time),toMins(b.time)+b.duration,oth);return best&&best.length<(b.tables||[]).length;});
}

// ── Phase C1 helpers ─────────────────────────────────────────────────────────
// Five helpers consolidated from component files / App.jsx. Each was either
// duplicated across files or buried inside a closure. Moving them here makes
// them testable in isolation and removes a class of "which copy is canonical?"
// confusion. Style intentionally matches the rest of this module (var, no
// JSX) — modernisation comes in Phase C3.

// Current local time as "HH:MM" — module-level convenience for any caller
// that needs "right now" formatted as a clock string. Previously inlined in
// App.jsx and WalkinForm (`localNowTime`).
export function nowTime(){var d=new Date();return toTime(d.getHours()*60+d.getMinutes());}

// Sort priority for the day-list view: seated first (most operationally
// urgent), then confirmed (upcoming), completed (already left), cancelled.
// Previously inlined in ListView. Pure function of the status string.
export function statusOrder(s){return s==="seated"?0:s==="confirmed"?1:s==="completed"?2:3;}

// Position-percentage helper for the timeline grid — converts a clock-minutes
// value into a CSS `left` percentage relative to the open–close span. The
// total span is computed internally from OPEN/GRID_CLOSE, so callers pass
// only the minute they want positioned. Previously inlined in TimelineView,
// where it closed over a derived `totalMins` constant.
export function pct(mins){var totalMins=(GRID_CLOSE-OPEN)*60;return ((mins-OPEN*60)/totalMins)*100+"%";}

// Live duration for the Gantt bar width on the timeline. For a seated
// booking, returns max(15, elapsed-since-seating) so the bar always shows at
// least 15 min and grows as the party stays. For non-seated, returns the
// stored duration. Previously inlined in TimelineView as a closure over
// `nowMins`. NB: ListView's similarly-shaped inline `liveDur` has different
// semantics (pinned-to-plan end-time) and is intentionally NOT consolidated
// here — that lives in ListView and is a separate concern.
export function liveBarDur(b,nowMins){
  if(b&&b.status==="seated"){
    var elapsed=nowMins-toMins(b.time);
    return Math.max(15,elapsed);
  }
  return b?b.duration:0;
}

// Capacity of a chosen subset of table ids using "best-subset greedy"
// matching. Algorithm: exact-match in VALID_COMBOS wins; otherwise find the
// largest VALID_COMBO entirely contained in `ids` and add the standalone
// capacities of any leftover ids; falls back to sum-of-standalones if no
// containing combo exists. Previously duplicated as `getCapOf` in
// ManualModal and WalkinForm. PrefPickerModal uses the simpler `comboCap`
// (also exported above) which has no greedy branch — by design, since for
// soft-hint preferences we don't need partial-match scoring.
export function comboCapBest(ids){
  if(ids.length===0) return 0;
  var k=ids.slice().sort().join("|");
  var c=VALID_COMBOS.find(function(x){return x.ids.slice().sort().join("|")===k;});
  if(c) return c.cap;
  var bestCap=0;var bestIds=[];
  VALID_COMBOS.forEach(function(combo){
    if(combo.ids.length<=ids.length&&combo.ids.every(function(id){return ids.includes(id);})&&combo.cap>bestCap){
      bestCap=combo.cap;
      bestIds=combo.ids;
    }
  });
  if(bestIds.length>0){
    var rem=ids.filter(function(id){return !bestIds.includes(id);});
    return bestCap+rem.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);
  }
  return ids.reduce(function(a,id){var t=ALL_TABLES.find(function(x){return x.id===id;});return a+(t?t.capacity:0);},0);
}

// ── Day summary (v14.6.0) ─────────────────────────────────────────────────────
// Covers (guests) for one date, broken down by hour and by the two editable
// shifts. Covers = Σ booking.size over NON-cancelled bookings (cancelled excluded
// to match the header's dayCount; completed kept — they're still covers served).
// Each booking is bucketed by its START hour. Shift split: Afternoon = start hour
// < splitHour, Evening = start hour >= splitHour. Pure; reuses toMins.
export function daySummary(bookings,date,splitHour){
  var day=(bookings||[]).filter(function(b){return b&&b.date===date&&b.status!=="cancelled";});
  var byHour={};
  var totalCovers=0;
  var aCovers=0,aCount=0,eCovers=0,eCount=0;
  var seatedCount=0,seatedCovers=0,upcomingCount=0; // v14.8.0: live status-bar tallies
  day.forEach(function(b){
    var size=Number(b.size)||2;
    var h=Math.floor(toMins(b.time)/60);
    totalCovers+=size;
    if(!byHour[h]) byHour[h]={covers:0,count:0};
    byHour[h].covers+=size;byHour[h].count+=1;
    if(h<splitHour){aCovers+=size;aCount+=1;}else{eCovers+=size;eCount+=1;}
    if(b.status==="seated"){seatedCount+=1;seatedCovers+=size;}else if(b.status==="confirmed"){upcomingCount+=1;}
  });
  var hours=Object.keys(byHour).map(Number).sort(function(a,b){return a-b;}).map(function(h){
    return {hour:h,covers:byHour[h].covers,count:byHour[h].count};
  });
  return {
    totalCovers:totalCovers,
    totalBookings:day.length,
    hours:hours,
    afternoon:{covers:aCovers,count:aCount},
    evening:{covers:eCovers,count:eCount},
    seated:{count:seatedCount,covers:seatedCovers}, // v14.8.0 — live occupancy
    upcoming:{count:upcomingCount}                  // v14.8.0 — confirmed (not yet seated)
  };
}
