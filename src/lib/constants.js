// src/lib/constants.js
// Configuration data — table layout, capacity rules, valid combos, time bounds,
// design tokens. Pure data only (no React, no DOM). Imported by App.jsx and
// any future component that needs layout/style/range info.
//
// Phase A extraction (v15-refactor): moved verbatim from App v.14.1 dev.jsx
// lines 59–88. No semantic changes — `var` retained for now; modernisation
// happens in Phase C.

// v15.0.0: the physical table layout is now runtime-configurable (Settings →
// Layout; Firebase settings/layout, shared). DEFAULT_LAYOUT = the historical MGT
// 13-table layout — an absent/empty Firebase node falls back to this, so an
// untouched install is byte-identical to pre-v15. Each table: {id, capacity, zone}
// where zone ∈ {"indoor","outdoor"}. (Phase 4 extends the config with join-groups
// + combo caps; v15.0.0 keeps VALID_COMBOS/CLUSTERS fixed below.) `kitchenLimit`
// is the max simultaneous kitchen starts (was the hard-coded KITCHEN_TABLE_LIMIT).
export var DEFAULT_LAYOUT={
  tables:[
    {id:"1A",capacity:2,zone:"outdoor"},{id:"1B",capacity:2,zone:"outdoor"},
    {id:"2",capacity:2,zone:"outdoor"},{id:"3",capacity:2,zone:"outdoor"},{id:"4",capacity:2,zone:"outdoor"},
    {id:"5A",capacity:2,zone:"outdoor"},{id:"5B",capacity:2,zone:"outdoor"},{id:"6",capacity:2,zone:"outdoor"},
    {id:"7",capacity:4,zone:"outdoor"},
    {id:"i1",capacity:2,zone:"indoor"},{id:"i2",capacity:2,zone:"indoor"},{id:"i3",capacity:2,zone:"indoor"},{id:"i4",capacity:2,zone:"indoor"}
  ],
  kitchenLimit:3
};

// The physical-cluster grouping for the table pickers. v15.0.0: the structure
// (which tables cluster + the combo-hint notes + zone colour) stays fixed here;
// each chip's `cap` is pulled LIVE from the layout config (so a capacity edit
// reflects in the picker). Phase 4 will derive the structure from join-groups.
var TABLE_GROUP_STRUCT=[
  {name:"Tables: 1A / 1B / 7",color:"#78716c",note:"1A+1B = 6 · table 7 = 4 standalone",ids:["1A","1B","7"]},
  {name:"Tables: 2 / 3 / 4",color:"#78716c",note:"2+3 = 5 · 3+4 = 4 · 2+3+4 = 8",ids:["2","3","4"]},
  {name:"Tables: 5A / 5B / 6",color:"#78716c",note:"5A+5B = 5 · 5B+6 = 5 · 5A+5B+6 = 8",ids:["5A","5B","6"]},
  {name:"Tables: i2 / i3 / i4",color:"#7c3aed",note:"i2+i3 = 6 · i3+i4 = 6 · i2+i3+i4 = 8",ids:["i2","i3","i4"]},
  {name:"Table: i1",color:"#7c3aed",note:"Standalone cap 2 · all 4 indoor = 10",ids:["i1"]},
];

// ── Layout-derived live bindings (reassigned ONLY by setLayout, below) ─────────
// `let` exports so setLayout can reassign them as live ESM bindings — every
// importer (incl. booking-logic's pure functions) sees the new layout with NO
// signature changes, exactly like the OPEN/CLOSE hours bindings. Seeded from
// DEFAULT_LAYOUT at import so module-eval-time reads are valid.
export let INDOOR=[];
export let OUTDOOR=[];
export let ALL_TABLES=[];
// v14.8.0: total restaurant capacity (Σ table capacities; 28 for the default
// layout). Denominator for the Summary status bar's "seats filled" reading.
export let TOTAL_SEATS=0;
export let TIMELINE_TABLES=[];
// id → "indoor"|"outdoor" — replaces the old isIn(id)=id.startsWith("i") heuristic
// so zoning is data-driven (booking-logic's isIn reads this).
export let ZONE_OF={};

// Derive the table pickers' grouping from a config (live caps, fixed structure).
function buildTableGroups(cfg){
  var capOf={};(cfg.tables||[]).forEach(function(t){capOf[t.id]=t.capacity;});
  return TABLE_GROUP_STRUCT.map(function(g){
    return {name:g.name,color:g.color,note:g.note,tables:g.ids.map(function(id){return {id:id,cap:capOf[id]!=null?capOf[id]:2};})};
  });
}

// Reassign the layout-derived bindings from a config. Called by useLayout on each
// Firebase snapshot, and once at module load (bottom of file) to seed from
// DEFAULT_LAYOUT. Only this module may reassign its own exports, so the setter
// lives here. Note: ZONE keeps OUTDOOR-before-INDOOR ordering to preserve the
// timeline row order (and ALL_TABLES order) of the original hard-coded layout.
export function setLayout(cfg){
  var tables=(cfg&&Array.isArray(cfg.tables)&&cfg.tables.length)?cfg.tables:DEFAULT_LAYOUT.tables;
  OUTDOOR=tables.filter(function(t){return t.zone!=="indoor";}).map(function(t){return {id:t.id,capacity:t.capacity};});
  INDOOR=tables.filter(function(t){return t.zone==="indoor";}).map(function(t){return {id:t.id,capacity:t.capacity};});
  ALL_TABLES=OUTDOOR.concat(INDOOR);
  TIMELINE_TABLES=OUTDOOR.concat(INDOOR);
  TOTAL_SEATS=ALL_TABLES.reduce(function(a,t){return a+t.capacity;},0);
  ZONE_OF={};tables.forEach(function(t){ZONE_OF[t.id]=t.zone==="indoor"?"indoor":"outdoor";});
  KITCHEN_TABLE_LIMIT=(cfg&&Number.isFinite(Number(cfg.kitchenLimit)))?Number(cfg.kitchenLimit):3;
  TABLE_GROUPS=buildTableGroups({tables:tables});
}
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
// v15.0.0: layout-derived (cfg.kitchenLimit) — reassigned by setLayout, seeded
// from DEFAULT_LAYOUT at module load. `let` so the live binding can update.
export let KITCHEN_TABLE_LIMIT=3;
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
// Phase B2: shared from here (consumed by TableGrid + App.jsx's Preferred picker).
// v15.0.0: now a layout-derived live `let` binding (set by setLayout from
// TABLE_GROUP_STRUCT + the config's live caps). `tables[].cap` is the standalone
// capacity for the visual chip label.
export let TABLE_GROUPS=[];

// ── Seed all layout-derived bindings from DEFAULT_LAYOUT at module load ────────
// Runs AFTER every `let` binding above is declared (TDZ-safe). useLayout replaces
// these on the first Firebase snapshot; until then the default layout is in force.
setLayout(DEFAULT_LAYOUT);
