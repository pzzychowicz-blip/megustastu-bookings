// src/lib/constants.js
// Configuration data — table layout, capacity rules, valid combos, time bounds,
// design tokens. Pure data only (no React, no DOM). Imported by App.jsx and
// any future component that needs layout/style/range info.
//
// Phase A extraction (v15-refactor): moved verbatim from App v.14.1 dev.jsx
// lines 59–88. No semantic changes — `var` retained for now; modernisation
// happens in Phase C.

export var INDOOR=[{id:"i1",capacity:2},{id:"i2",capacity:2},{id:"i3",capacity:2},{id:"i4",capacity:2}];
export var OUTDOOR=[{id:"1A",capacity:2},{id:"1B",capacity:2},{id:"2",capacity:2},{id:"3",capacity:2},{id:"4",capacity:2},{id:"5A",capacity:2},{id:"5B",capacity:2},{id:"6",capacity:2},{id:"7",capacity:4}];
export var ALL_TABLES=OUTDOOR.concat(INDOOR);
// v14.8.0: total restaurant capacity (Σ table capacities = 28). Denominator for the
// Summary status bar's live "seats filled" reading. Derived so it tracks layout changes.
export var TOTAL_SEATS=ALL_TABLES.reduce(function(a,t){return a+t.capacity;},0);
export var TIMELINE_TABLES=OUTDOOR.concat(INDOOR);
export var VALID_COMBOS=[
  {ids:["1A","1B"],cap:6},
  {ids:["2","3"],cap:5},{ids:["3","4"],cap:4},{ids:["2","3","4"],cap:8},
  {ids:["5A","5B"],cap:5},{ids:["5B","6"],cap:5},{ids:["5A","5B","6"],cap:8},
  {ids:["i2","i3"],cap:6},{ids:["i3","i4"],cap:6},{ids:["i2","i3","i4"],cap:8},
  {ids:["i1","i2","i3","i4"],cap:10},
  {ids:["1A","1B","7","i1"],cap:11},{ids:["1A","1B","7","i2"],cap:10},{ids:["1A","1B","7","i3"],cap:10},{ids:["1A","1B","7","i4"],cap:11},
  {ids:["1A","1B","7","i1","i2"],cap:12},{ids:["1A","1B","7","i1","i3"],cap:12},{ids:["1A","1B","7","i1","i4"],cap:12},{ids:["1A","1B","7","i2","i3"],cap:12},{ids:["1A","1B","7","i3","i4"],cap:12},
  {ids:["1A","1B","7","i1","i2","i3"],cap:14},{ids:["1A","1B","7","i1","i2","i4"],cap:14},{ids:["1A","1B","7","i1","i3","i4"],cap:14},{ids:["1A","1B","7","i2","i3","i4"],cap:14},
  {ids:["1A","1B","7","i1","i2","i3","i4"],cap:16},
  {ids:["1A","1B","7","2","3"],cap:15},{ids:["1A","1B","7","3","4"],cap:14},{ids:["1A","1B","7","2","3","4"],cap:18},
  {ids:["1A","1B","7","5A","5B"],cap:15},{ids:["1A","1B","7","5B","6"],cap:15},{ids:["1A","1B","7","5A","5B","6"],cap:18},
  {ids:["2","3","4","5A","5B","6"],cap:16},{ids:["2","3","4","5A","5B"],cap:13},{ids:["2","3","4","5B","6"],cap:13},{ids:["2","3","4","5A","5B","6","7"],cap:20},
  {ids:["2","3","4","5A","5B","6","i1"],cap:20},{ids:["2","3","4","5A","5B","6","i4"],cap:20},
  {ids:["1A","1B","7","2","3","4","5A","5B","6"],cap:26},{ids:["1A","1B","7","2","3","4","5A","5B"],cap:23},{ids:["1A","1B","7","2","3","4","5B","6"],cap:23},
];
export var CLUSTERS={"1A":["1A","1B"],"1B":["1A","1B"],"7":["7"],"2":["2","3","4"],"3":["2","3","4"],"4":["2","3","4"],"5A":["5A","5B","6"],"5B":["5A","5B","6"],"6":["5A","5B","6"],"i1":["i1"],"i2":["i2","i3","i4"],"i3":["i2","i3","i4"],"i4":["i2","i3","i4"]};
// v14.4.0 / v15.0.0: OPEN/CLOSE/GRID_CLOSE + QUARTER_HOURS are runtime-editable
// (Settings → General → Opening hours), persisted to Firebase (settings/operatingHours)
// and shared across devices. `let` (not `var`) so the setters below can reassign
// them: these are live ESM bindings, so reassigning HERE updates every importer —
// including booking-logic's pure functions — with NO signature changes. A React
// re-render after the setter runs repaints the timeline/forms. GRID_CLOSE (the
// timeline's right edge) stays one hour past close — v14.5.0: a past-midnight
// close (24 = 00:00, 25 = 01:00) extends the grid past midnight (GRID_CLOSE up to
// 26). Only this module may reassign its own exports, so the setters live here.
//
// v15.0.0: opening hours are now PER-WEEKDAY. The live bindings below hold the
// ACTIVE view-day's hours; useOperatingHours(viewDate) calls setActiveDayHours()
// on each render to point them at the viewed day. For ANY OTHER date, call
// hoursFor(date) — the three date-carrying pure functions (getBlockSlots,
// findTimes, findKitchenFriendlyTimes) and the forms read that, so a booking
// whose date ≠ the active view-day stays correct. WEEK_HOURS is the module-held
// schedule (keys 0–6 = Sun–Sat, matching Date#getUTCDay). weekRange() gives a
// STABLE min-open…max-close for global settings (shift split, optimizer cutoff)
// that must NOT track the volatile active-day bindings.

// Default day = the historical MGT window (13:00–22:00, open). An absent/empty
// Firebase node falls back to this for all 7 days → byte-identical to pre-v15.
export var DEFAULT_DAY={open:13,close:22,closed:false};
export var DEFAULT_WEEK_HOURS={0:DEFAULT_DAY,1:DEFAULT_DAY,2:DEFAULT_DAY,3:DEFAULT_DAY,4:DEFAULT_DAY,5:DEFAULT_DAY,6:DEFAULT_DAY};
// Module-held weekly schedule. Replaced wholesale by setWeekHours() on each
// Firebase snapshot. Read via hoursFor()/weekRange(); never mutate in place.
var WEEK_HOURS={0:DEFAULT_DAY,1:DEFAULT_DAY,2:DEFAULT_DAY,3:DEFAULT_DAY,4:DEFAULT_DAY,5:DEFAULT_DAY,6:DEFAULT_DAY};

export let OPEN=13,CLOSE=22,GRID_CLOSE=23;
export var KITCHEN_TABLE_LIMIT=3;
export let QUARTER_HOURS=Array.from({length:(GRID_CLOSE-OPEN)*4},function(_,i){return OPEN*60+i*15;});

// Weekday (0=Sun..6=Sat) for a "YYYY-MM-DD" string — all-UTC to match the app's
// date convention (mixing local getDay with UTC date strings shifts a day in
// UTC+ zones; the v14.7.0 Week-view lesson). Defensive: bad input → Sunday.
export function weekdayOf(dateStr){
  var wd=new Date(dateStr).getUTCDay();
  return Number.isFinite(wd)?wd:0;
}
// Hours for a specific date: {open, close, gridClose, closed}. THE accessor for
// any date that isn't necessarily the active view-day. Defensive against a day
// missing its open/close (e.g. a closed day stored bare).
export function hoursFor(dateStr){
  var d=WEEK_HOURS[weekdayOf(dateStr)]||DEFAULT_DAY;
  var open=Number.isFinite(d.open)?d.open:DEFAULT_DAY.open;
  var close=Number.isFinite(d.close)?d.close:DEFAULT_DAY.close;
  return {open:open,close:close,gridClose:close+1,closed:!!d.closed};
}
// Replace the whole schedule (the hook sanitizes before calling).
export function setWeekHours(week){
  if(week&&typeof week==="object") WEEK_HOURS=week;
}
// Point the live bindings at one date's hours (the active view-day). A closed
// day still yields a range so the timeline grid has dimensions; the "Closed"
// overlay is a render concern. Replaces the old single-pair setOperatingHours.
export function setActiveDayHours(dateStr){
  var h=hoursFor(dateStr);
  OPEN=h.open;CLOSE=h.close;GRID_CLOSE=h.gridClose;
  QUARTER_HOURS=Array.from({length:(GRID_CLOSE-OPEN)*4},function(_,i){return OPEN*60+i*15;});
}
// Stable min-open … max-close across the OPEN weekdays — for global settings
// (shift split, optimizer cutoff) that must not follow the volatile active-day
// bindings. Falls back to the default window if every day is closed.
export function weekRange(){
  var opens=[],closes=[];
  for(var k=0;k<7;k++){var d=WEEK_HOURS[k];if(d&&!d.closed){opens.push(d.open);closes.push(d.close);}}
  if(!opens.length) return {minOpen:DEFAULT_DAY.open,maxClose:DEFAULT_DAY.close};
  return {minOpen:Math.min.apply(null,opens),maxClose:Math.max.apply(null,closes)};
}
export var ROW_H=44,LABEL_W=58;
export var STATUS_COLORS={confirmed:{bg:"rgba(var(--status-confirmed-rgb),0.15)",text:"var(--status-confirmed-text)",border:"rgba(var(--status-confirmed-rgb),0.35)"},seated:{bg:"rgba(var(--status-seated-rgb),0.15)",text:"var(--status-seated-text)",border:"rgba(var(--status-seated-rgb),0.35)"},completed:{bg:"rgba(var(--status-completed-rgb),0.12)",text:"var(--status-completed-text)",border:"rgba(var(--status-completed-rgb),0.3)"},cancelled:{bg:"rgba(var(--status-cancelled-rgb),0.12)",text:"var(--status-cancelled-text)",border:"rgba(var(--status-cancelled-rgb),0.3)"}};
export var BLOCK_BG={confirmed:"var(--block-confirmed)",seated:"var(--block-seated)",completed:"var(--block-completed)",cancelled:"var(--block-cancelled)"};
// Dark mode (v14.2.0 `S`; v14.2.1 the colour sets STATUS_COLORS / BLOCK_BG /
// TBL / BTN): values reference CSS custom properties from index.html (:root
// light / [data-theme="dark"]), so a theme flip re-resolves them with zero JS.
// Alpha-composited families (STATUS_COLORS bg/border, TBL bg/border) use
// RGB-channel triplets composed here as `rgba(var(--…-rgb), a)`; single-alpha
// families (BLOCK_BG, BTN) are direct tokens. Block/table/button tokens are
// theme-invariant (saturated fills read on both themes); only status-chip
// *text* flips light in dark. `S.bg` stays the literal "transparent".
export var S={bg:"transparent",card:"var(--bg-card)",border:"var(--border-card)",muted:"var(--text-muted)",text:"var(--text-primary)",accent:"var(--accent)"};
export var TBL={out:{bg:"rgba(var(--tbl-out-rgb),0.8)",text:"var(--text-on-accent)",border:"rgba(var(--tbl-out-rgb),0.5)"},ind:{bg:"rgba(var(--tbl-ind-rgb),0.8)",text:"var(--text-on-accent)",border:"rgba(var(--tbl-ind-rgb),0.5)"}};
export var EMPTY_FORM={name:"",phone:"+",date:new Date().toISOString().slice(0,10),time:"13:00",size:2,preference:"auto",notes:"",status:"confirmed",customDur:null,manualTables:[],preferredTables:[],returnOf:null};

// ── Button colour tokens ──────────────────────────────────────────────────────
// Phase B1 addition: BTN was previously defined inline in App.jsx; moved here
// so component files (atoms.jsx and future B2–B5 extractions) can import it.
export var BTN={tables:"var(--btn-tables)",edit:"var(--btn-edit)",del:"var(--btn-del)",cancel:"var(--btn-cancel)",clear:"var(--btn-clear)",reset:"var(--btn-reset)",today:"var(--btn-today)",nav:"var(--btn-nav)",dismiss:"var(--btn-dismiss)",orange:"var(--btn-orange)"};

// ── Table groupings for UI pickers ────────────────────────────────────────────
// Phase B2 addition: TABLE_GROUPS was previously defined inline in App.jsx
// alongside the original TableGrid component. With TableGrid extracted to
// ./components/, and a second consumer remaining in App.jsx (the inline
// "Preferred tables" picker in the new-booking form), the array is shared
// from here. Used by:
//   • src/components/TableGrid.jsx — the assignment grid
//   • src/App.jsx                  — the "Preferred tables" picker
// `tables[].cap` is the standalone capacity for the visual chip label.
export var TABLE_GROUPS=[
  {name:"Tables: 1A / 1B / 7",color:"#78716c",note:"1A+1B = 6 · table 7 = 4 standalone",tables:[{id:"1A",cap:2},{id:"1B",cap:2},{id:"7",cap:4}]},
  {name:"Tables: 2 / 3 / 4",color:"#78716c",note:"2+3 = 5 · 3+4 = 4 · 2+3+4 = 8",tables:[{id:"2",cap:2},{id:"3",cap:2},{id:"4",cap:2}]},
  {name:"Tables: 5A / 5B / 6",color:"#78716c",note:"5A+5B = 5 · 5B+6 = 5 · 5A+5B+6 = 8",tables:[{id:"5A",cap:2},{id:"5B",cap:2},{id:"6",cap:2}]},
  {name:"Tables: i2 / i3 / i4",color:"#7c3aed",note:"i2+i3 = 6 · i3+i4 = 6 · i2+i3+i4 = 8",tables:[{id:"i2",cap:2},{id:"i3",cap:2},{id:"i4",cap:2}]},
  {name:"Table: i1",color:"#7c3aed",note:"Standalone cap 2 · all 4 indoor = 10",tables:[{id:"i1",cap:2}]},
];
