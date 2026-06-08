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
// where zone ∈ {"indoor","outdoor"}. `kitchenLimit` is the max simultaneous
// kitchen starts (was the hard-coded KITCHEN_TABLE_LIMIT).
//
// v15.0.0 Phase 4: the combo system is now DERIVED from this config too (was the
// hard-coded VALID_COMBOS/CLUSTERS below). Three combo fields drive buildLayout():
//   • joinGroups — ordered physical "runs" of adjacent tables. Every contiguous
//     sub-run of ≥2 auto-generates a combo (cap = Σ member caps unless overridden).
//     A table not in any ≥2 group is standalone. (7 and i1 are standalone here.)
//   • comboCaps  — per-auto-combo seat-count overrides, key = comboKey(run ids)
//     (sorted, "|"-joined). Only combos whose real seat count ≠ the member sum need
//     an entry (e.g. 1A+1B seats 6, not 4; but 3+4 = 4 = sum, so it's omitted).
//   • megaCombos — explicit cross-group big-party combos that pairwise adjacency
//     can't generate (each {ids, cap}). Appended to the auto combos in order.
// buildLayout(DEFAULT_LAYOUT) reproduces the pre-Phase-4 VALID_COMBOS (40, ordered)
// + CLUSTERS exactly — the zero-regression linchpin (see /tmp verify script).
export var DEFAULT_LAYOUT={
  tables:[
    {id:"1A",capacity:2,zone:"outdoor"},{id:"1B",capacity:2,zone:"outdoor"},
    {id:"2",capacity:2,zone:"outdoor"},{id:"3",capacity:2,zone:"outdoor"},{id:"4",capacity:2,zone:"outdoor"},
    {id:"5A",capacity:2,zone:"outdoor"},{id:"5B",capacity:2,zone:"outdoor"},{id:"6",capacity:2,zone:"outdoor"},
    {id:"7",capacity:4,zone:"outdoor"},
    {id:"i1",capacity:2,zone:"indoor"},{id:"i2",capacity:2,zone:"indoor"},{id:"i3",capacity:2,zone:"indoor"},{id:"i4",capacity:2,zone:"indoor"}
  ],
  // Ordered physical runs (singletons 7 / i1 are omitted → standalone clusters).
  joinGroups:[["1A","1B"],["2","3","4"],["5A","5B","6"],["i2","i3","i4"]],
  // Auto-combo seat overrides (key = sorted ids joined by "|"). "3|4" is omitted
  // because its real cap (4) equals the member sum.
  comboCaps:{"1A|1B":6,"2|3":5,"2|3|4":8,"5A|5B":5,"5B|6":5,"5A|5B|6":8,"i2|i3":6,"i3|i4":6,"i2|i3|i4":8},
  // Explicit cross-group big-party combos (order preserved in VALID_COMBOS).
  megaCombos:[
    {ids:["i1","i2","i3","i4"],cap:10},
    {ids:["1A","1B","7","i1"],cap:11},{ids:["1A","1B","7","i2"],cap:10},{ids:["1A","1B","7","i3"],cap:10},{ids:["1A","1B","7","i4"],cap:11},
    {ids:["1A","1B","7","i1","i2"],cap:12},{ids:["1A","1B","7","i1","i3"],cap:12},{ids:["1A","1B","7","i1","i4"],cap:12},{ids:["1A","1B","7","i2","i3"],cap:12},{ids:["1A","1B","7","i3","i4"],cap:12},
    {ids:["1A","1B","7","i1","i2","i3"],cap:14},{ids:["1A","1B","7","i1","i2","i4"],cap:14},{ids:["1A","1B","7","i1","i3","i4"],cap:14},{ids:["1A","1B","7","i2","i3","i4"],cap:14},
    {ids:["1A","1B","7","i1","i2","i3","i4"],cap:16},
    {ids:["1A","1B","7","2","3"],cap:15},{ids:["1A","1B","7","3","4"],cap:14},{ids:["1A","1B","7","2","3","4"],cap:18},
    {ids:["1A","1B","7","5A","5B"],cap:15},{ids:["1A","1B","7","5B","6"],cap:15},{ids:["1A","1B","7","5A","5B","6"],cap:18},
    {ids:["2","3","4","5A","5B","6"],cap:16},{ids:["2","3","4","5A","5B"],cap:13},{ids:["2","3","4","5B","6"],cap:13},{ids:["2","3","4","5A","5B","6","7"],cap:20},
    {ids:["2","3","4","5A","5B","6","i1"],cap:20},{ids:["2","3","4","5A","5B","6","i4"],cap:20},
    {ids:["1A","1B","7","2","3","4","5A","5B","6"],cap:26},{ids:["1A","1B","7","2","3","4","5A","5B"],cap:23},{ids:["1A","1B","7","2","3","4","5B","6"],cap:23}
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
// v15.0.0 Phase 4: combos + physical clusters are now DERIVED (was hard-coded).
// VALID_COMBOS = [{ids,cap}] (within-run auto combos then megaCombos, in order);
// CLUSTERS = id → its full ≥2 physical run (standalone → [id]). Reassigned by
// setLayout; consumed live by booking-logic (comboCap / findBest / canAssign / …).
export let VALID_COMBOS=[];
export let CLUSTERS={};

// Derive the table pickers' grouping from a config (live caps, fixed structure).
function buildTableGroups(cfg){
  var capOf={};(cfg.tables||[]).forEach(function(t){capOf[t.id]=t.capacity;});
  return TABLE_GROUP_STRUCT.map(function(g){
    return {name:g.name,color:g.color,note:g.note,tables:g.ids.map(function(id){return {id:id,cap:capOf[id]!=null?capOf[id]:2};})};
  });
}

// Canonical combo key: sorted ids joined by "|". MUST match booking-logic's
// comboCap / comboCapBest matching (ids.slice().sort().join("|")) so override
// lookups and combo identity agree across the module boundary.
export function comboKey(ids){return ids.slice().sort().join("|");}

// Every contiguous sub-run of length ≥2 within an ordered group, by length then
// start position. The auto-combo generator — shared by buildLayout and the Layout
// editor (LayoutSettings) so both enumerate combos identically. The L-then-start
// order is what reproduces the historical VALID_COMBOS order (2+3, 3+4, 2+3+4, …).
export function contiguousRuns(group){
  var runs=[];
  if(!Array.isArray(group)) return runs;
  for(var L=2;L<=group.length;L++){
    for(var start=0;start+L<=group.length;start++){
      runs.push(group.slice(start,start+L));
    }
  }
  return runs;
}

// Pure derivation: a layout config → every value the app reads at runtime,
// INCLUDING the combos + clusters (Phase 4). setLayout() assigns the result to the
// live bindings; the deep-equal verify calls this directly. buildLayout(DEFAULT_LAYOUT)
// reproduces the pre-Phase-4 hard-coded VALID_COMBOS (40, ordered) + CLUSTERS exactly.
// Combo fields fall back to DEFAULT_LAYOUT's when absent (e.g. a Phase-3 node that
// only has tables+kitchenLimit), so an upgrade-in-place stays MGT-correct.
export function buildLayout(cfg){
  cfg=(cfg&&typeof cfg==="object")?cfg:DEFAULT_LAYOUT;
  var tables=(Array.isArray(cfg.tables)&&cfg.tables.length)?cfg.tables:DEFAULT_LAYOUT.tables;
  // ZONE keeps OUTDOOR-before-INDOOR ordering to preserve the timeline row order
  // (and ALL_TABLES order) of the original hard-coded layout.
  var outdoor=tables.filter(function(t){return t.zone!=="indoor";}).map(function(t){return {id:t.id,capacity:t.capacity};});
  var indoor=tables.filter(function(t){return t.zone==="indoor";}).map(function(t){return {id:t.id,capacity:t.capacity};});
  var allTables=outdoor.concat(indoor);
  var zoneOf={};tables.forEach(function(t){zoneOf[t.id]=t.zone==="indoor"?"indoor":"outdoor";});
  var capOf={};tables.forEach(function(t){capOf[t.id]=t.capacity;});
  var idSet={};tables.forEach(function(t){idSet[t.id]=true;});
  // Combo config — fall back to DEFAULT's when a field is absent/malformed.
  var joinGroups=Array.isArray(cfg.joinGroups)?cfg.joinGroups:DEFAULT_LAYOUT.joinGroups;
  var comboCaps=(cfg.comboCaps&&typeof cfg.comboCaps==="object")?cfg.comboCaps:DEFAULT_LAYOUT.comboCaps;
  var megaCombos=Array.isArray(cfg.megaCombos)?cfg.megaCombos:DEFAULT_LAYOUT.megaCombos;
  // Normalize each run to existing ids only (a removed table drops out of its run).
  var groups=(joinGroups||[]).map(function(g){return (Array.isArray(g)?g:[]).filter(function(id){return idSet[id];});}).filter(function(g){return g.length>0;});
  var combos=[];
  // Within-run auto combos: every contiguous sub-run of length L≥2, by L then start
  // — this order reproduces the historical VALID_COMBOS layout (e.g. 2+3, 3+4, 2+3+4).
  groups.forEach(function(g){
    contiguousRuns(g).forEach(function(run){
      var key=comboKey(run);
      var cap=(comboCaps&&comboCaps[key]!=null)?comboCaps[key]:run.reduce(function(a,id){return a+(capOf[id]||0);},0);
      combos.push({ids:run,cap:cap});
    });
  });
  // Explicit cross-group mega combos, in order — kept only if every member exists.
  (megaCombos||[]).forEach(function(mc){
    if(!mc||!Array.isArray(mc.ids)||mc.ids.length<2) return;
    if(!mc.ids.every(function(id){return idSet[id];})) return;
    var cap=Number.isFinite(Number(mc.cap))?Number(mc.cap):mc.ids.reduce(function(a,id){return a+(capOf[id]||0);},0);
    combos.push({ids:mc.ids.slice(),cap:cap});
  });
  // Clusters: each table → its full ≥2 physical run, or [id] when standalone.
  var clusters={};
  tables.forEach(function(t){
    var grp=groups.find(function(g){return g.length>=2&&g.indexOf(t.id)>=0;});
    clusters[t.id]=grp?grp.slice():[t.id];
  });
  var kitchenLimit=Number.isFinite(Number(cfg.kitchenLimit))?Number(cfg.kitchenLimit):3;
  return {
    OUTDOOR:outdoor,INDOOR:indoor,ALL_TABLES:allTables,TIMELINE_TABLES:allTables,
    TOTAL_SEATS:allTables.reduce(function(a,t){return a+t.capacity;},0),
    ZONE_OF:zoneOf,KITCHEN_TABLE_LIMIT:kitchenLimit,
    TABLE_GROUPS:buildTableGroups({tables:tables}),
    VALID_COMBOS:combos,CLUSTERS:clusters
  };
}

// Reassign the layout-derived bindings from a config. Called by useLayout on each
// Firebase snapshot, and once at module load (bottom of file) to seed from
// DEFAULT_LAYOUT. Only this module may reassign its own exports, so the setter
// lives here.
export function setLayout(cfg){
  var L=buildLayout(cfg);
  OUTDOOR=L.OUTDOOR;INDOOR=L.INDOOR;ALL_TABLES=L.ALL_TABLES;TIMELINE_TABLES=L.TIMELINE_TABLES;
  TOTAL_SEATS=L.TOTAL_SEATS;ZONE_OF=L.ZONE_OF;KITCHEN_TABLE_LIMIT=L.KITCHEN_TABLE_LIMIT;
  TABLE_GROUPS=L.TABLE_GROUPS;VALID_COMBOS=L.VALID_COMBOS;CLUSTERS=L.CLUSTERS;
}
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
