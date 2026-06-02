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
// v14.4.0: OPEN/CLOSE/GRID_CLOSE + QUARTER_HOURS are runtime-editable (Settings
// → General → Opening hours), persisted to Firebase (settings/operatingHours) and
// shared across devices. `let` (not `var`) so setOperatingHours can reassign them:
// these are live ESM bindings, so reassigning HERE updates every importer —
// including booking-logic's pure functions — with NO signature changes. A React
// re-render after the setter runs repaints the timeline/forms. GRID_CLOSE (the
// timeline's right edge) stays one hour past close. Only this module may reassign
// its own exports, so the setter lives here.
export let OPEN=13,CLOSE=22,GRID_CLOSE=23;
export var KITCHEN_TABLE_LIMIT=3;
export let QUARTER_HOURS=Array.from({length:(GRID_CLOSE-OPEN)*4},function(_,i){return OPEN*60+i*15;});
export function setOperatingHours(open,close){
  OPEN=open;CLOSE=close;GRID_CLOSE=Math.min(24,close+1);
  QUARTER_HOURS=Array.from({length:(GRID_CLOSE-OPEN)*4},function(_,i){return OPEN*60+i*15;});
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
