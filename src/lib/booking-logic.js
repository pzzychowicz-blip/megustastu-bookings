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
  PRIORITIES,
  DUR_TIERS,
  TURN_BUFFER
} from "./constants";
import { todayStr, nowOn } from "./day";

// ── Primitive helpers ─────────────────────────────────────────────────────────
// v16.1.0: default duration reads the DUR_TIERS live binding (settings/
// bookingDefaults via useBookingDefaults). Seed = the historical literals
// (≤4 → 90, else 120), so behaviour is unchanged until the setting is edited.
// Read at call time — never capture DUR_TIERS into a local (live binding).
export function getDur(s){var ts=DUR_TIERS.tiers||[];for(var i=0;i<ts.length;i++){if(s<=ts[i].max) return ts[i].dur;}return DUR_TIERS.restDur;}
// v16.1.0: running-late state for a booking. Returns null | "warn" | "noshow".
// Only a CONFIRMED booking on TODAY whose start time is ≥ warn/no-show minutes
// in the past qualifies (seated/completed/cancelled never flag). cfg =
// {lateEnabled, lateWarnMin, lateNoShowMin} from settings/bookingDefaults.
// NOTE (v16.1.1): no midnight-wraparound handling — `lateBy` assumes `nowMins`
// and the booking's start are on the same day. Safe today because bookings never
// START past midnight (the extend-window caps starts ≤ 23:30); if that ever
// changes, a booking near midnight compared against a post-rollover `nowMins`
// would compute a large negative `lateBy` (harmlessly → null here, but any future
// consumer of the raw minutes must account for it).
export function lateState(b,today,nowMins,cfg){
  if(!cfg||!cfg.lateEnabled) return null;
  // v17.0.0: PENDING flags late too (Patryk-confirmed "same as confirmed") —
  // an unconfirmed request past its time needs staff attention just the same.
  if(!b||(b.status!=="confirmed"&&b.status!=="pending")||b.date!==today) return null;
  var lateBy=lateMins(b,nowMins,today);
  if(lateBy>=cfg.lateNoShowMin) return "noshow";
  if(lateBy>=cfg.lateWarnMin) return "warn";
  return null;
}
// v16.1.1: minutes a booking is past its start time. Single source for the
// "N min late" arithmetic (was duplicated in the App banner + the ListView tag).
export function lateMins(b,nowMins,today){return nowOn(b.date,today,nowMins)-toMins(b.time);}
// v16.3.0: table-turn prediction. Which of TODAY'S SEATED bookings are about to
// free their table? Returns [{id, name, tables, inMin}] for seated bookings whose
// scheduled end (start + duration) is 0 < end−now ≤ windowMin (default 15),
// sorted soonest-first. OVERSTAYERS (end already passed) are excluded — the
// overlap-warning machinery covers them, and "free in ~N" would be a lie for an
// open-ended overstay. cfg-gated by the caller (freeSoonEnabled). Same
// v17.16.2 (CT-2B-02): the old note here claimed a no-midnight-wraparound
// assumption "same as lateState", and it was false in a way worth keeping.
// An end up to ~01:30 does stay same-side of the BOOKING's own midnight — and
// that says nothing about `nowMins`, which after midnight is measured from the
// NEXT day's. So a party seated 23:30-00:30 was never offered as freeing soon.
// `nowOn` puts both on the booking's ruler. The date filter is gone rather than
// replaced because this function is SELF-BOUNDING (0 < inMin <= win), so a stale
// seated booking falls out on its own — which is exactly why lateState, which is
// unbounded backwards, keeps its filter.
export function freeingSoon(bookings,today,nowMins,windowMin){
  var win=windowMin||15;
  var out=[];
  (bookings||[]).forEach(function(b){
    if(!b||b.status!=="seated") return;
    var end=toMins(b.time)+(b.duration||90);
    var inMin=end-nowOn(b.date,today,nowMins);
    if(inMin>0&&inMin<=win) out.push({id:b.id,name:b.name,tables:(b.tables||[]).slice(),inMin:inMin});
  });
  out.sort(function(a,b){return a.inMin-b.inMin;});
  return out;
}
// v17.12.0 (/code-review): what a booking SOUNDS like — the one source for every
// spoken label in the app.
//
// It shipped as three hand-written copies: ListView's card, TimelineView's block
// and PlanView's table, the first two byte-identical down to the
// `size === 1 ? " guest" : " guests"` branch and the `"no table assigned"`
// fallback. Adding a status, changing the pluralisation, or deciding a
// three-table booking should not read "5A and 5B and 6" meant three edits, and
// the app's own `STATUS_LABEL` note ("reuses the List card's vocabulary so the
// two cannot drift") is the standing argument against that.
//
// PlanView is the reason for the option rather than a second function: its
// subject is a TABLE, so it prefixes "Table 3, " and must not then repeat the
// table at the end — but the rest of the sentence is this one exactly. That is a
// parameter, not a different sentence; contrast `hourLabel`/`cutoffLabel` in
// `time-grid.js`, which looked like copies and were genuinely two functions.
//
// Callers append their own state clauses (a block adds double-booked /
// overstaying / running late) — those are properties of how a booking is being
// DRAWN, not of the booking.
export function describeBooking(b, opts){
  const o=opts||{};
  const out=[b.name, b.time, b.size+(b.size===1?" guest":" guests")];
  // `tables: false` drops the clause entirely rather than saying "no table
  // assigned" — on the floor plan the table is already the subject.
  if(o.tables!==false){
    const t=b.tables&&b.tables.length?b.tables:null;
    out.push(t?(t.length>1?"tables ":"table ")+joinList(t):"no table assigned");
  }
  out.push(b.status);
  return out.join(", ");
}
// v17.14.0: the extraction commit joined with `" and "`, which is right for two
// and wrong for three — "5A and 5B and 6". A mega-combo of three or four tables
// is an ordinary Settings → Layout configuration, so this is reachable, not
// theoretical. No serial comma, matching the app's copy elsewhere.
//
// The NOUN follows the count too. "table 5A, 5B and 6" is the same sentence
// still half-broken, and this function exists so there is exactly one place
// that decides what a booking sounds like.
function joinList(a){
  if(a.length<=1) return a.join("");
  if(a.length===2) return a[0]+" and "+a[1];
  return a.slice(0,-1).join(", ")+" and "+a[a.length-1];
}
// v17.6.0: how long a COMPLETED party actually stayed, in minutes — or null when
// that is not knowable. List renders the tag only when this is non-null.
//
// Why a stored field and not just `duration`: only a real seated→completed
// transition truncates `duration` to the actual span (v16.2.0). A booking taken
// straight confirmed→completed keeps its SCHEDULED duration, so printing that
// number would assert a stay that never happened. `stayedMin` is written by both
// completion paths in exactly that branch, so its presence IS the marker.
//
// The history fallback backfills bookings completed BEFORE v17.6.0, which have
// no stamp: if the trail records a seated transition then `duration` was already
// truncated and is the real span. Deliberately a loose /seated/i match — the two
// completion paths word their entries differently ("status → seated" from
// updateStatus, "edited: …status confirmed→seated" from the form), which is
// precisely why the live path uses a field instead of parsing this.
export function stayedMins(b){
  if(!b||b.status!=="completed") return null;
  var st=Number(b.stayedMin);
  if(Number.isFinite(st)&&st>0) return st;
  var hist=Array.isArray(b.history)?b.history:[];
  var seated=hist.some(function(h){return h&&typeof h.action==="string"&&/seated/i.test(h.action);});
  if(!seated) return null;
  var d=Number(b.duration);
  return Number.isFinite(d)&&d>0?d:null;
}
export function toMins(t){var p=t.split(":");return Number(p[0])*60+Number(p[1]);}
export function toTime(m){return String(Math.floor(m/60)%24).padStart(2,"0")+":"+String(m%60).padStart(2,"0");}
// v17.16.2: MOVED here from usePersistence.js, where it had been module-private
// since v15.1.0 — the one function in the repo that ever put "now" and a booking
// on a common axis, locked inside the one file no test could reach. It lives
// here because it needs the `hoursFor` LIVE BINDING, which day.js must not take
// (day.js imports nothing so constants.js may import it; see that file's header).
//
// Has `dateStr`'s closing moment already passed? A booking's closing moment is
// its OWN date's per-weekday close (may be 24/25, i.e. past midnight) in minutes
// since that date's midnight; `nowOn` puts now on the same ruler. Returns the
// close-in-minutes when it has passed, else null — including for a future date,
// whose projected `now` is negative and so can never reach a close of 6..25.
//
// This is now also the LIVENESS guard for the two functions that grow a seated
// booking (`liveBarDur`, `syncLiveDurations`). It replaced a `b.date === today`
// filter in both, and replacing it with nothing would have been a runaway: a
// booking left `seated` from three weeks ago has a real elapsed time of 30240
// minutes, which the old filter hid and a bare axis fix would have written to
// the database as its duration.
// v17.16.2: minutes a SEATED party has been at the table, on the booking's own
// axis, capped at that day's close.
//
// The cap is the bound that makes dropping the old `b.date === today` filter
// safe, and it is a CAP rather than a skip for a reason found by a test: skipping
// made the figure jump back to the stored duration the moment close passed, and
// made an existing test time-dependent (it fails after 22:00 and passes before).
// Capping matches auto-complete's own formula exactly, so the live number and
// the frozen one agree at the boundary instead of stepping. A booking left
// seated three weeks ago reads its own day's full service, once, and then stops
// — not 30240 minutes and rising.
// v17.16.2 (/code-review): is this seated booking still LIVE — i.e. may its
// duration grow? Today's, always (auto-complete owns it after close, and the cap
// below keeps the figure honest in the gap). Another day's, only while that day
// is still open, which is what a 24/25 close means and what the midnight fix
// exists for.
//
// Dropping `b.date === today` without this let `syncLiveDurations` rewrite
// HISTORICAL records: a booking left seated three weeks ago has a capped elapsed
// of 540 against a stored 90, so the next unrelated save emitted a patch child
// for it. The cap bounds the VALUE; it never authorised the WRITE. It also grew
// the atomic multi-path update, where one malformed historical booking can
// reject an otherwise valid save.
export function seatedIsLive(b,today,nowM){
  return b.date===today||pastCloseMins(b.date,today,nowM)===null;
}
export function seatedElapsed(b,today,nowM){
  var closeMins=hoursFor(b.date).close*60;
  return Math.min(nowOn(b.date,today,nowM),closeMins)-toMins(b.time);
}
export function pastCloseMins(dateStr,todayS,nowMins){
  var nm=nowOn(dateStr,todayS,nowMins);
  var closeMins=hoursFor(dateStr).close*60;
  return nm>=closeMins?closeMins:null;
}
export function overlaps(s1,e1,s2,e2){return s1<e2&&e1>s2;}
// ── Turnaround buffer (v17.6.0) ───────────────────────────────────────────────
// The separation between bookings (Settings → General; off by default, so
// TURN_BUFFER is 0 and everything below is a no-op). The rule is: pad every
// END — both a stored slot's `e` and the candidate query window's `e` — and
// NEVER a start.
//
// Why both ends and no starts: padding only the stored slots would stop a new
// booking starting right after an existing one, but would still let it END
// exactly when the next one starts. Padding both ends closes that direction
// too, and because only ends move, the gap between any pair is exactly
// TURN_BUFFER — never twice it.
//
// Scope is PLACEMENT ONLY: findFreeSlot/trialFits/optimise/findTimes and the
// UI busy-sets route through these. verifyClean/findConflicts/checkInefficent
// deliberately do NOT, so switching the setting on can never flag or reshuffle
// a day that is already booked back-to-back. getBlockSlots is untouched.
export function padEnd(e){return e+TURN_BUFFER;}
// Buffered occupancy end of a booking — the drop-in for `toMins(b.time)+(b.duration||90)`
// at every slot-building site.
export function bookEnd(b){return toMins(b.time)+((b&&b.duration)||90)+TURN_BUFFER;}
export function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

// ── Booking sanitisation / diffing ────────────────────────────────────────────
// v17.16.5 (CT-2A-03, client half): is this value a time the rest of the app can
// READ? `sanitize` has always guarded truthiness — `b.time || "13:00"` — and
// every consumer needs something `toMins` can take apart. The gap between the
// two is not academic: `toMins` is `t.split(":")` at 83 call sites, so a stored
// `time: 2000` survives sanitisation (a number is truthy), reaches the first
// consumer and throws `t.split is not a function`. v17.16.0's error boundary
// contains that crash; it does not make the day usable. And it is reachable
// from the server, because v17.16.1's per-field rules deliberately check TYPE
// and not FORMAT — the two halves of one finding, and this is the client half.
//
// The predicate is deliberately the CONSUMER'S requirement rather than a format
// of its own: readable means `toMins` yields a finite number. That is the
// narrowest possible guard — a value only stops being kept if it already throws
// or already produces NaN today — so nothing that currently works can move. The
// cost of that choice, stated rather than hidden: `":"` reads as 00:00 and is
// therefore KEPT, because it is not a crash. Times outside the day (`"25:99"`
// reads as 1599) are kept for the same reason; normalising them would rewrite a
// record that renders, which is a different decision and not this one.
export function isReadableTime(v){
  if(typeof v!=="string") return false;
  var p=v.split(":");
  return p.length>=2&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]));
}
export function sanitize(b){if(!b||typeof b!=="object") return null;var t=isReadableTime(b.time)?b.time:"13:00";return {id:b.id||genId(),name:b.name||"",phone:b.phone||"",date:b.date||"",time:t,scheduledTime:isReadableTime(b.scheduledTime)?b.scheduledTime:t,size:Number(b.size)||2,duration:Number(b.duration)||90,originalDuration:Number(b.originalDuration)||Number(b.duration)||90,preference:b.preference||"auto",notes:b.notes||"",status:b.status||"confirmed",tables:Array.isArray(b.tables)?b.tables:[],customDur:b.customDur||null,_manual:!!b._manual,_locked:!!b._locked,_conflict:!!b._conflict,preferredTables:Array.isArray(b.preferredTables)?b.preferredTables:[],returnOf:b.returnOf||null,history:Array.isArray(b.history)?b.history:[],
  // v16.0.0: no-show flag set by doCancelBooking(id,noShow=true). Whitelisted so
  // it survives reads; legacy no-shows (history entry only) are counted by
  // customers.js isNoShow's history fallback — no migration needed.
  noShow:!!b.noShow,
  // v16.3.0: deposit / prepayment amount in € (0 = none). Whitelisted so it
  // survives reads; per-booking field → covered by the existing per-$id CAS.
  // Clamped ≥0 (/code-review): the form's min={0} only blocks the stepper —
  // a typed "-50" would otherwise pass Number() straight through.
  deposit:Math.max(0,Number(b.deposit)||0),
  // v16.3.0: recurring-occurrence stamps (null for a one-off). recurringId links
  // to the settings/recurring rule; recurringDate is the occurrence's date. The
  // generator dedupes on these; doDelete adds recurringDate to the rule's
  // skipDates so a deleted occurrence is never regenerated.
  recurringId:b.recurringId||null,
  recurringDate:b.recurringDate||null,
  // v17.0.0: "Delete customer" anonymizes instead of deleting — the booking
  // stays for statistics as name "Data removed" (phone/notes/history wiped,
  // noShow kept). The flag excludes it from the name-search/autocomplete paths.
  anonymized:!!b.anonymized,
  // v17.10.0: the SECOND customer-identity key, for guests who never give a
  // phone number — `"g"+<seed booking id>`, minted only when a human joins two
  // phone-less bookings from the name dropdown. Whitelisted so it survives
  // reads; per-booking field, so the existing per-$id updatedAt CAS covers it
  // and there is NO new node and no Firebase console step. See
  // customers.js → identityKey / matchCustomerFor.
  guestId:b.guestId||null,
  // v17.6.0: how long the party ACTUALLY stayed, in minutes — written by the two
  // completion paths ONLY on a real seated→completed transition (App.jsx's
  // updateStatus + doSave). Whitelisted so it survives reads. 0/absent means
  // "not known" (a direct confirmed→completed never sets it); read it through
  // stayedMins() below rather than touching the field directly.
  stayedMin:Number(b.stayedMin)||0,
  // v15.5.0: per-booking revision stamp for the per-node write model. Carried
  // through sanitise so it survives reads (this whitelist would otherwise drop
  // it) — used by usePersistence's write-diff/stamp + the per-$id Security Rule.
  updatedAt:Number(b.updatedAt)||0};}
export function histEntry(action,user){return {at:new Date().toISOString(),by:user||"staff",action:action};}
export function diffBooking(orig,f,size){var ch=[];if(orig.name!==f.name) ch.push("name "+orig.name+"→"+f.name);if(size!==orig.size) ch.push("size "+orig.size+"→"+size);if(f.time!==orig.time) ch.push("time "+orig.time+"→"+f.time);if(f.date!==orig.date) ch.push("date "+orig.date+"→"+f.date);if(f.preference!==orig.preference) ch.push("pref "+orig.preference+"→"+f.preference);var origPhone=orig.phone||"";var formPhone=f.phone&&f.phone.trim()!=="+"?f.phone.trim():"";if(origPhone!==formPhone) ch.push("phone "+(origPhone||"none")+"→"+(formPhone||"none"));var origDur=orig.originalDuration||orig.duration||90;var formDur=f.customDur||getDur(size);if(origDur!==formDur) ch.push("duration "+origDur+"→"+formDur+"min");if(f.status!==orig.status) ch.push("status "+orig.status+"→"+f.status);if(f.notes!==(orig.notes||"")) ch.push("notes updated");var origDep=Math.max(0,Number(orig.deposit)||0);var formDep=Math.max(0,Number(f.deposit)||0);if(origDep!==formDep) ch.push("deposit "+origDep+"→"+formDep+" €");var mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:null;if(mt) ch.push("tables manually set: "+mt.join(", "));if(f._clearManual) ch.push("manual assignment cleared");var pt=Array.isArray(f.preferredTables)?f.preferredTables:[];var origPt=Array.isArray(orig.preferredTables)?orig.preferredTables:[];if(pt.slice().sort().join(",")!==origPt.slice().sort().join(",")) ch.push("preferred tables: "+(pt.length?pt.join(", "):"cleared"));return ch.length?ch.join(", "):"saved (no field changes)";}
export function sanitizeAll(arr){if(!arr) return [];if(!Array.isArray(arr)){var vals=Object.values(arr);return vals.map(sanitize).filter(Boolean);}return arr.map(sanitize).filter(Boolean);}

// ── Table-block identity (v17.15.3) ───────────────────────────────────────────
// A block gets a real `id` the way a booking does (`sanitize` above reads
// `b.id||genId()`), because until v17.15.3 it had none and `removeBlock` matched
// on the field set instead — tableId+date+allDay+from+to. Nothing dedupes
// blocks, so blocking one table for one range TWICE produced two entries
// agreeing on every one of those fields, and unblocking either DROPPED BOTH.
// v17.15.2 worked around the visible half (a duplicate-occurrence ordinal, so at
// least each row on screen targeted the right block) and recorded the data half
// as still broken; this is that half.
//
// Minted at READ time, and deliberately NOT written back by a migration pass.
// `saveBlocks` writes the WHOLE array, so the first add or remove after this
// ships persists every id in it — the node self-heals, which is why there is no
// connected gate and no migratedRef here. The only cost is that a node never
// written since the upgrade re-mints on each snapshot, and `tableBlocks`
// snapshots only fire when blocks change, i.e. on the very write that ends it.
//
// A MINT, NOT A WHITELIST — do not "finish" this by copying `sanitize`'s shape
// above. `reason` is read by DaySheet and written by nothing, and `allDay` is
// likewise read-only legacy; a whitelist would silently drop `reason` from any
// block in PROD that carries one. Unknown fields pass through untouched.
//
// Returns the SAME object when an id is already present, so a settled node keeps
// its per-block references across snapshots.
export function sanitizeBlock(bl,legacyId){
  if(!bl||typeof bl!=="object") return null;
  // /code-review: the mint goes in the SOURCE, not the target. As
  // `Object.assign({id:genId()},bl)` it was silently discarded whenever `bl`
  // carried a falsy-but-PRESENT id — "" / 0 / null / an explicit undefined all
  // overwrote it, so the branch that exists to mint an id handed back the
  // unusable one it had just rejected. Unreachable from any current writer
  // (addBlock routes through here, and RTDB cannot store null), but the failure
  // it would produce is this version's own bug back again: two blocks sharing a
  // falsy id make removeBlock's `bl.id !== block.id` drop BOTH, and BlockModal
  // and DaySheet key their rows on it.
  return bl.id?bl:Object.assign({},bl,{id:legacyId||genId()});
}
// v17.16.4 (CT-2B-06): the DETERMINISTIC seed `sanitizeBlocks` hands the mint
// for a block read out of a legacy, id-less node.
//
// The defect a random mint produced: `genId()` answers "what read was this",
// not "which block is this", so two reads of the SAME unchanged node disagreed
// about every id in it. `removeBlock` filters on `bl.id!==block.id`, and
// `BlockModal` holds the block object it was handed when it opened — so a
// resync landing between opening the list and tapping Unblock left the modal
// naming an id that no longer existed anywhere, and the removal silently did
// nothing. Fails safe (a no-op, never the wrong block) and self-limiting (the
// first successful `saveBlocks` persists ids and the node stops being legacy)
// — which is why it is a P3 and not a fix to the identity itself.
//
// Deriving from CONTENT rather than from array position is the load-bearing
// choice, and it is about what happens when the node is NOT frozen. An index
// seed is stable only while nothing is inserted or removed; if a stale index
// ever did resolve, it would resolve to a DIFFERENT block, turning a harmless
// no-op into unblocking the wrong table. A content key cannot: it either finds
// the same block or finds none.
//
// The `n` ordinal is what keeps two IDENTICAL blocks distinguishable, which is
// the whole point of v17.15.3's ids and is pinned in the tests. It is the
// v17.15.2 ordinal in a much narrower role — there it WAS the identity of every
// block, here it only seeds the mint for a block that has no stored identity —
// and the case it used to get wrong is now benign: when two blocks agree on
// every field, "the wrong one" and "the right one" are the same block.
//
// The separator is an ASCII control character for `undoKey`'s reason — `reason`
// is free staff-entered text — written as the escape and never the raw byte,
// which is invisible in every editor, grep and diff.
//
// /code-review: the invariant `removeBlock` actually depends on is that every id
// in ONE `sanitizeBlocks` result is distinct, and a content hash alone does not
// give it. `hash36` is 32-bit, so two blocks with DIFFERENT content can share a
// hash — constructed, not argued: two `reason` strings on the same table and
// window both hash to `dqduwy`, and since the ordinal counts identical CONTENT
// keys each got ordinal 1, i.e. one id for two different blocks. That is
// precisely the v17.15.3 defect this file exists to prevent, reintroduced by its
// own fix. The first draft also claimed the `bl_` shape "can never collide with
// a real minted id" on the grounds that `genId()` contains no "_" — true of
// `genId()` ids and FALSE of a previously-minted `bl_…_n` that has since been
// persisted by `saveBlocks`. Both paths close the same way: the ordinal is now
// "first one not already taken", against a set seeded with the ids the node
// already stores. Identical siblings still get _1, _2 — the common case is
// unchanged — and determinism is untouched, since the scan is left-to-right
// over a stable array.
var BLOCK_KEY_FIELDS=["tableId","date","allDay","from","to","reason"];
function blockContentKey(bl){
  return BLOCK_KEY_FIELDS.map(function(k){return String(bl[k]===undefined?"":bl[k]);}).join("\u001f");
}
function hash36(s){
  var h=2166136261;
  for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0).toString(36);
}
// RTDB hands back an array only for sequential integer keys, an object otherwise
// (and null for an absent node) — both read sites passed through the same
// three-way shrug, so it lives here once.
export function sanitizeBlocks(val){
  if(!val) return [];
  var arr=Array.isArray(val)?val:Object.values(val);
  // v17.16.4: `.map(sanitizeBlock)` is deliberately no longer point-free — the
  // seed needs the whole array, and passing map's (value,index,array) straight
  // through would have made `index` the legacyId.
  //
  // `used` is seeded with the ids the node ALREADY stores, then every minted id
  // is added to it, so the result cannot contain a duplicate by either route —
  // a 32-bit hash collision between two different blocks, or a mint landing on
  // a real stored id. See the note above `blockContentKey` for why that is the
  // invariant rather than the hash. `Object.create(null)` because a stored id is
  // data and "__proto__" must be an ordinary key here.
  var used=Object.create(null);
  arr.forEach(function(bl){if(bl&&typeof bl==="object"&&bl.id) used[bl.id]=true;});
  return arr.map(function(bl){
    if(!bl||typeof bl!=="object"||bl.id) return sanitizeBlock(bl);
    var base="bl_"+hash36(blockContentKey(bl));
    var n=1;
    while(used[base+"_"+n]) n++;
    used[base+"_"+n]=true;
    return sanitizeBlock(bl,base+"_"+n);
  }).filter(Boolean);
}

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
  // v17.16.6 — the `getBlockSlots` sibling of CT-2A-03. v17.16.5 made `sanitize`
  // guarantee that a booking's `time` is something `toMins` can read; a table
  // BLOCK's `from`/`to` reach the same `toMins` two lines below and had no such
  // guard, so a stored `from: 2000` throws `t.split is not a function` in the
  // placement path exactly as a booking used to. Reachability is identical to
  // the booking case — `tableBlocks` carries no per-field `.validate`, so any
  // non-app writer can put one there — and v17.16.0's error boundary contains
  // that crash without making the day usable.
  //
  // **The guard is HERE and not in `sanitizeBlock`, which is the whole decision.**
  // That function is a MINT, not a whitelist (its header says so, and says not
  // to "finish" it by copying `sanitize`'s shape): it exists to give a block an
  // identity, and `reason` survives only because nothing there drops unknown
  // fields. Defaulting an unreadable `from` there would hand the block a time
  // window nobody entered and then persist it on the next `saveBlocks`, which is
  // stored data silently rewritten. An unreadable block is not a block, so the
  // consumer skips it.
  //
  // The cost, stated rather than hidden: the table is silently UNDER-blocked —
  // it will be offered to the optimiser and to walk-ins for minutes somebody
  // meant to protect. That is strictly better than the day being unusable, and
  // it is the direction that leaves the stored record alone for whoever comes to
  // repair it. An `allDay` block never reads `from`/`to` and is unaffected.
  return blocks.filter(function(bl){
    if(bl.date!==date) return false;
    return bl.allDay?true:(isReadableTime(bl.from)&&isReadableTime(bl.to));
  }).map(function(bl){
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
// v17.6.0: the scheduled end is buffered (bookEnd) — this feeds availability
// checks, which is exactly the placement scope. The overstay branch returns
// nowM+1+buffer for the same reason: the party is still at the table, so the
// turnaround has not started yet.
// v17.16.2 (CT-2B-02): `nowM` arrives on TODAY's axis and every value it is
// compared with here is on `b.date`'s, so after midnight the overstay branch
// could not fire — a party seated 23:30 still at the table at 00:30 had
// `e`(1470) > `nowM`(30), the slot read FREE, and canAssign offered their table
// to a walk-in. `nowOn` is the whole fix; the returned minute stays on b.date's
// axis, which is what the callers' `s`/`e` are built from.
export function occupancyEnd(b,nowM,today){
  var e=bookEnd(b);
  var nm=nowOn(b.date,today,nowM);
  if(b.status==="seated"&&e<=nm) return padEnd(nm+1);
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

// v17.0.0 correction rounds 4–5: the drag&drop candidate ranking. Every combo
// containing `tableId` that seats `size`, ranked for a MANUAL drop — NOT the
// optimizer's global order (round 4 used that and produced a bloated combo).
// The user pointed at a table, so:
//   1. FEWEST tables first — "don't assign more tables than necessary" (the
//      reported bug: an 8-top on 7 took a 5-table combo);
//   2. then the coded PREFERENCE rules (PRIORITIES.comboRules — editable in
//      Settings → Layout → Table priorities), so within one footprint the
//      preferred attach wins (e.g. 1A+1B+7+i4/i1 over +i2/+i3). The rule match
//      is BAND-AGNOSTIC here (key only, size ignored) — a drop honors the
//      preference regardless of the rule's optimizer size-band, per Patryk;
//   3. then least capacity (fewest wasted seats), then id for determinism.
// The zone/location tiebreak is deliberately dropped: the human already chose
// the location by dropping. Availability filtering (blocked/seated members)
// stays the caller's job. Respecting Settings edits falls out for free — the
// weights/avoid flags come live from PRIORITIES.
function _comboPriKey(c){
  // v17.0.0 review fix: pick the STRONGEST-preference matching rule (lowest
  // value — most negative sorts earliest), not the first in array order, so
  // two rules sharing a key can't make drag ranking depend on rule ordering.
  var k=c.ids.slice().sort().join("|");var rules=PRIORITIES.comboRules;var best=0,found=false;
  for(var i=0;i<rules.length;i++){if(rules[i].key===k){var v=rules[i].avoid?100:-rules[i].weight;if(!found||v<best){best=v;found=true;}}}
  return found?best:0;
}
// /code-review #2: does ANY declared combo containing tableId seat `size`,
// ignoring the drag-only filters below? Lets a refusal tell "this party can
// never sit here" apart from "the drag rules won't join that many tables —
// Manual assign will".
export function comboExistsFor(tableId,size){
  return VALID_COMBOS.some(function(c){return c.ids.includes(tableId)&&c.cap>=size;});
}
export function rankCombosContaining(tableId,size){
  // v17.0.0 round 9 (Patryk): two hard EXCLUSIONS for a manual drop — the
  // recurring "more tables than necessary" bug (a 4-top dropped on standalone
  // i1 took a whole cross-room mega, because every combo containing i1 IS one
  // and fewest-tables can't help).
  //   1. avoid-flagged combos are excluded, not just sorted last (sorted-last
  //      is meaningless when the avoided combo is the only candidate).
  //      _comboPriKey===100 ⟺ every rule matching the key is avoid (a
  //      coexisting preference rule wins the min and un-hides it — deliberate).
  //   2. DRAG_MAX_WASTE: a drop may conscript at most 4 unused seats
  //      (cap − size ≤ 4, Patryk-picked). 4-on-i1 → refuses (best mega wastes
  //      7); 8-on-7 → still 1A+1B+7+i4 (wastes 3, the round-5 contract).
  // Bigger joins stay reachable via Manual assign — the explicit override.
  var DRAG_MAX_WASTE=4;
  return VALID_COMBOS.filter(function(c){return c.ids.includes(tableId)&&c.cap>=size&&c.cap-size<=DRAG_MAX_WASTE&&_comboPriKey(c)!==100;})
    .sort(function(a,b){
      if(a.ids.length!==b.ids.length) return a.ids.length-b.ids.length;
      var pa=_comboPriKey(a),pb=_comboPriKey(b);if(pa!==pb) return pa-pb;
      if(a.cap!==b.cap) return a.cap-b.cap;
      return a.ids.join("|")<b.ids.join("|")?-1:1;
    });
}

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
// v16.3.0 perf rewrite — same output, a fraction of the work. The old shape ran
// the FULL trial optimisation (trialFits → applyOpt → optimise, incl. its retry
// passes) for EVERY quarter-slot of the day — with 07:00–01:00 hours that's ~70
// slots, and on a day where one booking is unplaceable each optimise takes ~70ms
// (the retry pass), so one findTimes call cost ~5 SECONDS (the "New booking
// freezes" bug). Two changes, both output-preserving for the only consumers
// (formatSugg keeps just the 10 nearest valid slots each side of `around`):
//   1. CHEAP-FIRST: per slot, try the no-reshuffle findFreeSlot before the full
//      optimizer trial. A plain free table means the slot is bookable WITHOUT
//      touching anyone — trivially valid, no simulation needed. Only slots that
//      fail the cheap check pay for the full trial (which exists to find
//      reshuffle-rescuable slots).
//   2. OUTWARD EARLY-STOP: scan from `around` outwards and stop after 10 valid
//      slots per side — exactly what formatSugg would keep. Result is returned
//      ascending, so formatSugg's slice sees the identical list.
export function findTimes(date,size,pref,existing,dur,around,blocks,editId,noReshuffle){
  var h=hoursFor(date); // v15.0.0: per-weekday hours for THIS date
  if(h.closed) return []; // closed day → no valid times
  var aroundM=around||0;
  // v16.3.0 perf phase 2: hard time budget. On an extreme day (many mutually
  // conflicting bookings) a single full trial can cost 100ms+ — 20 of them would
  // freeze the UI for seconds even off the mount path. When the budget runs out
  // we stop scanning and return what we found (partial suggestions on
  // pathological days beat a frozen app; normal days never hit this).
  var BUDGET_MS=600;
  var t0=Date.now();
  function slotValid(m){
    if(m>=24*60) return false; // v14.5.0: never suggest a post-midnight start (24h-hours is extend-window only)
    if(m+dur>h.close*60) return false;
    if(m===aroundM) return false;
    // Cheap-first: a slot with a plainly free table is valid without simulation.
    if(!noReshuffle&&findFreeSlot(existing,date,toTime(m),size,pref,dur,blocks,editId,null)) return true;
    if(Date.now()-t0>BUDGET_MS) return false; // budget spent — skip the expensive trial
    return !!trialFits(existing,date,toTime(m),size,pref,dur,blocks,editId,null,noReshuffle);
  }
  var first=h.open*60,last=h.close*60-15;
  var CAP=10; // formatSugg keeps 10 per side — scanning further is wasted work
  // Stay on the quarter-hour grid even when `around` isn't grid-aligned (the old
  // fixed-grid scan only ever produced grid slots): step outwards from the
  // nearest grid positions strictly below/above aroundM.
  var off=((aroundM-first)%15+15)%15;
  var startEarlier=off===0?aroundM-15:aroundM-off;
  var startLater=off===0?aroundM+15:aroundM+(15-off);
  // Bounds clamp (/code-review): an out-of-hours `around` (e.g. pre-opening)
  // must not let the outward scan step outside the service grid — the old
  // fixed-grid scan structurally never produced such slots. `first`/`last` are
  // grid-aligned (open/close are whole hours), so clamping stays on-grid.
  // (The upper side of the earlier-loop is additionally covered by the
  // m+dur>close check in slotValid, but the clamp keeps both symmetric.)
  if(startLater<first) startLater=first;
  if(startEarlier>last) startEarlier=last;
  var earlier=[];
  for(var m=startEarlier;m>=first&&earlier.length<CAP;m-=15){ if(Date.now()-t0>BUDGET_MS) break; if(slotValid(m)) earlier.push(m); }
  var later=[];
  for(var m2=startLater;m2<=last&&later.length<CAP;m2+=15){ if(Date.now()-t0>BUDGET_MS) break; if(slotValid(m2)) later.push(m2); }
  return earlier.reverse().concat(later);
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
  var exSl=bookings.filter(function(b){return b.date===date&&b.status!=="cancelled"&&b.status!=="completed";}).map(function(b){return {tables:b.tables||[],s:toMins(b.time),e:bookEnd(b)};});
  if(blocks) exSl=exSl.concat(getBlockSlots(blocks,date));
  times.forEach(function(m){
    if(m===aroundM) return;
    if(m>=24*60) return; // v14.5.0: never suggest a post-midnight start (24h-hours is extend-window only)
    if(m+dur>h.close*60) return;
    var load=getKitchenLoad(bookings,date,toTime(m),dur,excludeId);
    if(load.starts+1>=KITCHEN_TABLE_LIMIT) return;
    var hasTables=!!findBest(size,pref,m,padEnd(m+dur),exSl)||(pref==="auto"?!!findBestAny(size,m,padEnd(m+dur),exSl):false);
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
  day.forEach(function(b){if(!b||!b.time) return;var s=toMins(b.time),e=bookEnd(b);var tables;if(isLocked(b)){tables=b.tables;}else{
    if(b.preferredTables&&b.preferredTables.length>0){var pt=b.preferredTables;var ptCap=comboCap(pt);if(ptCap>=(b.size||2)&&canAssign(pt,slots,s,e)) tables=pt;}
    if(!tables){tables=findBest(b.size||2,b.preference||"auto",s,e,slots);if(!tables) tables=findBestAny(b.size||2,s,e,slots);}}assigned[b.id]=tables||null;if(tables) slots.push({tables:tables,s:s,e:e});});
  return assigned;
}
export function optimise(bookings,date,blocks){
  var completed=bookings.filter(function(b){return b&&b.date===date&&b.status==="completed"&&(b.tables||[]).length>0;});
  var baseSlots=completed.map(function(b){return {tables:b.tables,s:toMins(b.time),e:bookEnd(b)};});
  if(blocks) baseSlots=baseSlots.concat(getBlockSlots(blocks,date));
  // v17.16.5 (CT-2A-05): `id` is the FIFTH key, and it is what makes this a
  // total order. The four above it — locked first, larger party first, a stated
  // preference before "auto", earlier start first — leave real ties, and
  // `Array.prototype.sort` is stable, so a tie fell through to ARRAY POSITION:
  // the order the list happened to arrive in decided who got which table.
  //
  // Measured over 200 shuffled days (see REFACTOR_LOG): on a varied day the
  // assignment differs in 13/200, and on the shape a service actually has —
  // parties of 2 and 4, on the hour and half hour, nearly all "auto", which is
  // exactly where these four keys tie — in 138/200. Which table you get was a
  // coin flip on two days in three. Whether you get one was not: the number of
  // UNPLACED bookings differed in 0/200 in both scenarios, so this buys
  // determinism and costs nothing in placement quality.
  //
  // You cannot regress from "undefined", which is what array position is here —
  // but the replacement is meaningful rather than merely stable: `genId()` is a
  // base36 timestamp, so ordering by id orders by CREATION, and the party who
  // booked first is served first among equals. It is also the only key here
  // guaranteed unique, so the sort has no remaining tie to fall through.
  //
  // The later passes need no key of their own. The swap pass's `others.sort` is
  // just as partial, but it sorts a list DERIVED from `day`, and
  // `Array.prototype.sort` is stable — the same property that made the defect
  // is what propagates the fix, so one total order at the top settles all of
  // them. Verified: after this, both scenarios above are 0/200.
  var day=bookings.filter(function(b){return b&&b.date===date&&isActive(b);}).sort(function(a,b){var la=isLocked(a)?0:1,lb=isLocked(b)?0:1;if(la!==lb) return la-lb;if(b.size!==a.size) return b.size-a.size;var pa=a.preference!=="auto"?0:1,pb=b.preference!=="auto"?0:1;if(pa!==pb) return pa-pb;var ta=toMins(a.time),tb=toMins(b.time);if(ta!==tb) return ta-tb;return String(a.id)<String(b.id)?-1:(String(a.id)>String(b.id)?1:0);});
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
    holders.forEach(function(fb){var fs=toMins(fb.time),fe=bookEnd(fb);var three=day.find(function(b){return !isLocked(b)&&b.size===rule.toSize&&b.id!==fb.id&&overlaps(fs,fe,toMins(b.time),bookEnd(b))&&(!assigned[b.id]||assigned[b.id][0]!==rule.table);});if(!three) return;var lockedSlots=baseSlots.slice();day.forEach(function(b){if(isLocked(b)&&b.tables) lockedSlots.push({tables:b.tables,s:toMins(b.time),e:bookEnd(b)});});var ts=toMins(three.time),te=bookEnd(three);if(!canAssign([rule.table],lockedSlots,ts,te)) return;var trialSlots=lockedSlots.slice();trialSlots.push({tables:[rule.table],s:ts,e:te});var trialAssigned={};trialAssigned[three.id]=[rule.table];var others=day.filter(function(b){return b.id!==three.id&&!isLocked(b);}).sort(function(a,b){return b.size-a.size||toMins(a.time)-toMins(b.time);});others.forEach(function(b){var bs=toMins(b.time),be=bookEnd(b);var tables;if(b.preferredTables&&b.preferredTables.length>0){var pt=b.preferredTables;if(comboCap(pt)>=(b.size||2)&&canAssign(pt,trialSlots,bs,be)) tables=pt;}if(!tables){tables=findBest(b.size||2,b.preference||"auto",bs,be,trialSlots);if(!tables) tables=findBestAny(b.size||2,bs,be,trialSlots);}trialAssigned[b.id]=tables||null;if(tables) trialSlots.push({tables:tables,s:bs,e:be});});day.forEach(function(b){if(isLocked(b)) trialAssigned[b.id]=b.tables;});var curUn=day.filter(function(b){return !isLocked(b)&&!assigned[b.id];}).length;var tryUn=day.filter(function(b){return !isLocked(b)&&!trialAssigned[b.id];}).length;if(tryUn<=curUn) assigned=trialAssigned;});
  });
  // Preference retry: if any non-auto booking got wrong area, force-fix it
  var prefMismatch=day.filter(function(b){if(isLocked(b)||!assigned[b.id]||b.preference==="auto") return false;var tbl=assigned[b.id];if(b.preference==="indoor") return !isAllIn(tbl);if(b.preference==="outdoor") return !isAllOut(tbl);return false;});
  if(prefMismatch.length){
    var lockedSlots=baseSlots.slice();day.forEach(function(b){if(isLocked(b)&&b.tables) lockedSlots.push({tables:b.tables,s:toMins(b.time),e:bookEnd(b)});});
    prefMismatch.forEach(function(pb){
      var s=toMins(pb.time),e=bookEnd(pb);
      var prefTables=findBest(pb.size||2,pb.preference,s,e,lockedSlots);
      if(!prefTables) return;
      var trialSlots=baseSlots.slice();trialSlots.push({tables:prefTables,s:s,e:e});
      var trialAssigned={};trialAssigned[pb.id]=prefTables;
      day.forEach(function(b){if(!b||!b.time||b.id===pb.id) return;var bs=toMins(b.time),be=bookEnd(b);var tables;if(isLocked(b)){tables=b.tables;}else{tables=findBest(b.size||2,b.preference||"auto",bs,be,trialSlots);if(!tables) tables=findBestAny(b.size||2,bs,be,trialSlots);}trialAssigned[b.id]=tables||null;if(tables) trialSlots.push({tables:tables,s:bs,e:be});});
      var curUn=day.filter(function(b){return !isLocked(b)&&!assigned[b.id];}).length;
      var tryUn=day.filter(function(b){return !isLocked(b)&&!trialAssigned[b.id];}).length;
      if(tryUn<=curUn){assigned=trialAssigned;}
    });
  }
  // Retry: find combo bookings that could use alternatives
  var unassigned=day.filter(function(b){return !isLocked(b)&&!assigned[b.id];});
  if(!unassigned.length) return assigned;
  // Retry: try reshuffling any assigned booking that overlaps with unassigned ones
  var unTimes=unassigned.map(function(b){return {s:toMins(b.time),e:bookEnd(b)};});
  var comboBookings=day.filter(function(b){if(isLocked(b)||!assigned[b.id]) return false;var bs=toMins(b.time),be=bookEnd(b);return unTimes.some(function(u){return overlaps(bs,be,u.s,u.e);});}).sort(function(a,b){return b.size-a.size;}).slice(0,8);
  if(!comboBookings.length) return assigned;
  var bestAssigned=assigned;
  var bestUnassignedCount=unassigned.length;
  comboBookings.forEach(function(cb){
    var s=toMins(cb.time),e=bookEnd(cb);
    var lockedSlots=baseSlots.slice();
    day.forEach(function(b){if(isLocked(b)&&b.tables) lockedSlots.push({tables:b.tables,s:toMins(b.time),e:bookEnd(b)});});
    var options=findAllOptions(cb.size||2,cb.preference||"auto",s,e,lockedSlots);
    var currentKey=assigned[cb.id].slice().sort().join("|");
    options.forEach(function(opt){
      var optKey=opt.slice().sort().join("|");
      if(optKey===currentKey) return;
      // Reserve forced booking's tables first
      var trialSlots=baseSlots.slice();
      var cbs=toMins(cb.time),cbe=bookEnd(cb);
      trialSlots.push({tables:opt,s:cbs,e:cbe});
      var trialAssigned={};
      trialAssigned[cb.id]=opt;
      day.forEach(function(b){
        if(!b||!b.time||b.id===cb.id) return;
        var bs=toMins(b.time),be=bookEnd(b);
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
  var today=todayStr();
  if(date===today&&autoOptimizerState===false) return false;
  return true;
}
// v17.16.2 (CT-2B-02): was `b.date===today`, which no-op'd across midnight so a
// party seated 23:30 stopped accruing at 00:00. The filter is replaced by, not
// merely removed from, the liveness test: `pastCloseMins === null` means this
// booking's own day is still open, which covers yesterday's party under a 24/25
// close AND still excludes one left seated three weeks ago, whose true elapsed
// time is 30240 minutes and would otherwise be written as its duration.
export function syncLiveDurations(bookings,today,nowM){
  return bookings.map(function(b){
    if(b.status==="seated"&&seatedIsLive(b,today,nowM)){
      var elapsed=seatedElapsed(b,today,nowM);
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
// v17.16.2 (CT-2B-01): `nowM` arrived on TODAY's axis while every value below is
// on `booking.date`'s. Seating a 23:30 booking at 00:30 gave nowM=30 against a
// scheduledEnd of 1470, so the `nowM>=scheduledEnd` guard did not fire and this
// returned newDuration = 1470-30 = **1440** — a 24-hour reservation, written to
// the database. Its conflict scan excludes completed bookings, so nothing at
// 00:30 stood in the way.
export function applySeatedShift(booking,nowM,allBookings,today){
  if(!booking||!booking.time) return null;
  var scheduledStart=toMins(booking.time);
  var scheduledDur=booking.duration||90;
  var scheduledEnd=scheduledStart+scheduledDur;
  var nm=nowOn(booking.date,today,nowM);
  // A start time is stored as HH:MM against the booking's own date, so a shift
  // to a moment OUTSIDE that date cannot be REPRESENTED: toTime wraps modulo 24,
  // and `now` must therefore fall inside [0, 1440) of the booking's own day.
  //
  // BOTH ends are load-bearing (/code-review). Past the end: writing "00:15"
  // onto yesterday's booking moves it a full day into the past. Before the
  // start: seating a booking dated TOMORROW projects `now` NEGATIVE, and the
  // first version of this guard only checked the upper bound — so seating a
  // 13:00 booking on tomorrow's date at 23:00 today gave nm = -60, cleared
  // every remaining guard (newDuration 930 is inside the clamp), and wrote
  // `toTime(-60)` = **"-1:00"** as the booking's time. The pre-v17.16.2 code was
  // safe here by accident: its `nowM >= scheduledEnd` test fired on the
  // unprojected 1380, so the axis fix REMOVED that protection.
  if(!Number.isFinite(nm)||nm<0||nm>=1440) return null;
  if(nm===scheduledStart) return null;
  if(nm>=scheduledEnd) return null;
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
      return overlaps(nm,scheduledEnd,os,oe);
    });
    if(conflict) return null;
  }
  var newDuration=scheduledEnd-nm;
  // Second line of defence, at the one point this reaches the database. The
  // shared axis above makes it unreachable; a duration the schedule cannot mean
  // should still be refused where it would be written, not only where it is
  // computed.
  if(!Number.isFinite(newDuration)||newDuration<=0||newDuration>1440) return null;
  return {newTime:toTime(nm),newDuration:newDuration,oldTime:booking.time,direction:nm<scheduledStart?"early":"late"};
}
export function findFreeSlot(bookings,date,time,size,pref,dur,blocks,editId,prefTables){
  // v16.0.0 follow-up: completed excluded — a completed visit's table is free.
  var slots=bookings.filter(function(b){return b.date===date&&b.status!=="cancelled"&&b.status!=="completed"&&b.id!==editId&&(b.tables||[]).length>0;}).map(function(b){return {tables:b.tables,s:toMins(b.time),e:bookEnd(b)};});
  if(blocks) slots=slots.concat(getBlockSlots(blocks,date));
  var s=toMins(time),e=padEnd(s+dur);
  var pt=Array.isArray(prefTables)?prefTables:[];
  if(pt.length>0&&canAssign(pt,slots,s,e)&&comboOk(pt,pref||"auto")&&comboCap(pt)>=size) return pt;
  var tables=findBest(size,pref||"auto",s,e,slots);
  if(!tables&&(pref||"auto")==="auto") tables=findBestAny(size,s,e,slots);
  return tables;
}
// v17.14.0: did this pass actually change anything? Element-wise, in order, on
// `undoKey`'s field set — which is deliberately the SAME set `dayBookingsSig`
// compares, because v17.10.2 learned that a gate NARROWER than the pass it
// guards silently discards work: that version's first attempt compared
// `id:tables` alone and threw away both the `duration` extension
// `syncLiveDurations` writes and the `_conflict` flag `applyOpt` writes. Every
// field either of those two touches is in UNDO_FIELDS, which is what makes this
// compare exactly as wide as the transform.
//
// Order differences count as a change. Nothing in this module reorders, so the
// branch is unreachable today; treating it as changed is the conservative
// direction if something ever does.
function sameBookings(a,b){
  if(a===b) return true;
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length) return false;
  for(var i=0;i<a.length;i++){
    var x=a[i],y=b[i];
    if(x===y) continue;
    if(!x||!y) return false;
    if(x.id!==y.id) return false;
    if(undoKey(x)!==undoKey(y)) return false;
  }
  return true;
}
// Drop-in replacement for applyOpt() in user-triggered actions. Respects the
// autoOptimizer state for today. When ON → applyOpt as usual. When OFF → keep
// all existing tables untouched; only reassign `changedId` if forceReassign.
//
// ── v17.14.0: a no-op returns its INPUT ARRAY, not a copy ────────────────────
// This function used to return a fresh array whether or not the pass changed
// anything, which is the root cause behind the v15.6.1 reconciliation effect
// spinning forever (fixed at ONE call site in v17.10.2, by comparing
// `dayBookingsSig` before dispatching). Every other `useEffect` that depends on
// `bookings` and calls this was one line away from reintroducing the same loop
// with no warning, and the sibling manual branch survived only by accident —
// it happens to break with `next === prev`, and React bails out of identical
// state.
//
// Fixing it here removes the bug class for all 29 call sites at once: a caller
// can now compare identity and trust it. Callers must keep treating the result
// as immutable — none of them mutates it today (all read via map/filter/find),
// and the returned array may now BE the caller's own input.
export function bookingsAfterAction(updatedBks,date,blocks,changedId,forceReassign,autoOptimizerState){
  var today=todayStr();
  var d=new Date();var nowM=d.getHours()*60+d.getMinutes();
  var synced=syncLiveDurations(updatedBks,today,nowM);
  var out=computeAfterAction(synced,date,blocks,changedId,forceReassign,autoOptimizerState);
  return sameBookings(out,updatedBks)?updatedBks:out;
}
function computeAfterAction(synced,date,blocks,changedId,forceReassign,autoOptimizerState){
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

// ── Undo support (v17.4.0) ────────────────────────────────────────────────────
// An action (edit / delete / cancel) runs bookingsAfterAction, which may ALSO
// move other bookings' tables when the optimizer reshuffles. Undo therefore has
// to put back more than the booking the user acted on — but NOT the whole day:
// rewriting bookings the action never touched would widen the window in which
// undo can clobber another device's concurrent edit (the lost-write class the
// v15.2.0–v16.0.0 CAS arc exists to prevent).
//
// `undoSnapshots(prev,next)` returns the PRE-action version of exactly those
// bookings that `next` changed or removed; `applyUndo` puts them back. Both are
// pure so the contract is unit-tested.
//
// The compared field set is deliberately explicit: `updatedAt`/`baseUpdatedAt`
// are per-write metadata (a server echo must not read as a change), and
// `history` grows on every write so comparing it would mark everything changed.
var UNDO_FIELDS=["name","phone","date","time","scheduledTime","size","duration",
  "originalDuration","customDur","preference","notes","deposit","status","noShow",
  "tables","_manual","_locked","_conflict","preferredTables","returnOf",
  "recurringId","recurringDate","anonymized"];
// v17.10.2 (/code-review): the separators are ASCII control characters, not "|"
// and "+". Those were reachable FROM THE DATA — a table id only has to avoid
// "|" (`idOk` in LayoutSettings.jsx), so a venue naming a joined table "1+2"
// made `["1+2"]` and `["1","2"]` the same key, and `notes` is free text that can
// contain either. A collision reads as "nothing changed": for undo that means a
// snapshot is never taken, for `dayBookingsSig` below that a real reshuffle is
// discarded. The key is only ever compared — never stored, never shown.
//
// v17.16.6 (CT-2A-11): that comment used to end "No text field in the app can
// produce a control character", and **it was an assertion nothing enforced and
// nothing was true of**. `notes` is a `<textarea>`, `sanitize` writes
// `b.notes || ""` verbatim, and a paste carries whatever bytes it carries. The
// choice was to make the sentence true or to delete it; making it true is now
// `escSep` below, so the guarantee is a property of this function rather than a
// claim about the rest of the app — which is the version of it that cannot rot
// when somebody adds a field.
//
// **It ESCAPES rather than strips, and that distinction is the whole fix.**
// Stripping the separator bytes out of each value would close the boundary-shift
// collision by opening an identical one a character away: `"a\u001fb"` and
// `"ab"` would map to the same key, so an edit between them reads as "nothing
// changed" — the very failure this exists to prevent, differing only in which
// pair of values triggers it. Caret escaping is injective, so no two distinct
// field sets can share a key at all, and the cost is nothing.
//
// The escape prefix is \u001b (ESC, the natural choice and outside the four
// separators), and it escapes ITSELF first by being inside the replaced range:
// every \u001b in the output is a prefix, never data. `+0x40` is caret notation
// — \u001b..\u001f map to [ \ ] ^ _ — so a decoder is unambiguous even though
// nothing decodes: the key is compared, and injectivity is the only property
// asked of it.
var K_ARR="\u001f", K_FLD="\u001e", K_REC="\u001d", K_LST="\u001c";
// `no-control-regex` exists to catch a control character that got into a pattern
// by ACCIDENT — a pasted byte, a mistyped escape. Here the characters are the
// entire subject: this is the one regex in the app whose job is to find them.
// Disabled with the reason rather than worked around, because every alternative
// is worse: a char-by-char loop runs on every field of every booking through
// `dayBookingsSig`, and `new RegExp("[\\u001b-\\u001f]")` is flagged by the same
// rule while hiding the range from a reader.
// eslint-disable-next-line no-control-regex
var SEP_RE=/[\u001b-\u001f]/g;
function escSep(v){
  return String(v).replace(SEP_RE,function(c){
    return "\u001b"+String.fromCharCode(c.charCodeAt(0)+0x40);
  });
}
function undoKey(b){
  return UNDO_FIELDS.map(function(k){
    var v=b[k];
    if(Array.isArray(v)) return v.slice().sort().map(escSep).join(K_ARR);
    return (v===undefined||v===null)?"":escSep(v);
  }).join(K_FLD);
}
export function undoSnapshots(prev,next){
  var nextById={};
  (next||[]).forEach(function(b){ if(b&&b.id!=null) nextById[b.id]=b; });
  var out=[];
  (prev||[]).forEach(function(b){
    if(!b||b.id==null) return;
    var after=nextById[b.id];
    // removed by the action, or its compared fields changed
    if(!after||undoKey(after)!==undoKey(b)) out.push(b);
  });
  return out;
}
// Restore the snapshots into `current`: replace where the booking still exists,
// re-add where the action deleted it. Bookings not in `snapshots` are returned
// untouched (identity preserved, so the per-booking diff-write skips them).
export function applyUndo(current,snapshots){
  if(!snapshots||!snapshots.length) return current||[];
  var byId={};
  snapshots.forEach(function(s){ if(s&&s.id!=null) byId[s.id]=s; });
  var seen={};
  var out=(current||[]).map(function(b){
    if(b&&b.id!=null&&byId[b.id]){ seen[b.id]=true; return byId[b.id]; }
    return b;
  });
  snapshots.forEach(function(s){ if(s&&s.id!=null&&!seen[s.id]) out=out.concat([s]); });
  return out;
}

// ── Validation / efficiency check ─────────────────────────────────────────────
export function verifyClean(bookings,date){
  var day=bookings.filter(function(b){return b.date===date&&isActive(b)&&(b.tables||[]).length>0;});
  for(var i=0;i<day.length;i++){for(var j=i+1;j<day.length;j++){var a=day[i],b=day[j];var as=toMins(a.time),ae=as+a.duration,bs=toMins(b.time),be=bs+b.duration;if(!overlaps(as,ae,bs,be)) continue;if(!canAssign(b.tables,[{tables:a.tables,s:as,e:ae}],bs,be)) return false;}}
  return true;
}
// v17.11.0: the PAIRS behind findConflicts — who clashes with WHOM, on which
// tables, over which minutes. This is the same pair-scan verifyClean and
// findConflicts already ran; it just stops throwing away the pairing.
//
// The id SET was enough for the only consumer there had ever been — the
// reconciliation effect picks one booking out of the set and relocates it, and
// does not care what it collided with. Drawing the clash needs the other half:
// a block must say "double-booked with Rita Camps on table 3", and a strip row
// is about a PAIR, not about a booking. Neither sentence is recoverable from
// `["p","r"]`.
//
// Unbuffered, deliberately, like the two functions it replaces the loop of —
// turning the turnaround setting on must never make an already-booked day
// start reporting clashes (see the v17.6.0 scope note above).
//
// `tables` is the INTERSECTION, which is the shared table in the ordinary case
// and EMPTY in the other one: canAssign also rejects a pair when each booking
// takes two or more tables from the same join cluster, since they would need
// the same physical join, and those two sets need not intersect. That case is
// unreachable in the DEFAULT layout by pigeonhole — its biggest cluster is
// three tables and two 2-subsets of a 3-set always share a member — but a join
// group of FOUR is a legitimate Settings → Layout edit, so it is reachable in a
// custom layout and pinned in the tests. Callers must handle an empty array
// rather than assume there is always a table id to name: "both on table N" is
// otherwise a sentence with no N in it. See ClashBanner's fallback wording.
export function findClashes(bookings,date){
  return clashScan(bookings,date,false);
}
// v17.14.0 (/code-review follow-up): the one scan, with the pair-building made
// optional. `findConflicts` wants ids and nothing else, and it runs inside the
// reconciliation loop — up to 20 times per dirty date, on every settled
// snapshot — so building an object and running an Array.filter intersection per
// clashing pair for it to discard is work done in the hottest path this
// function has. `idsOnly` skips both; the loop and its two rejection tests are
// shared, which is what keeps findClashes' tests a proof of BOTH contracts.
function clashScan(bookings,date,idsOnly){
  var day=bookings.filter(function(b){return b.date===date&&isActive(b)&&(b.tables||[]).length>0;});
  var out=[];var hit=idsOnly?{}:null;
  for(var i=0;i<day.length;i++){for(var j=i+1;j<day.length;j++){
    var a=day[i],b=day[j];
    var as=toMins(a.time),ae=as+a.duration,bs=toMins(b.time),be=bs+b.duration;
    if(!overlaps(as,ae,bs,be)) continue;
    if(canAssign(b.tables,[{tables:a.tables,s:as,e:ae}],bs,be)) continue;
    if(idsOnly){hit[a.id]=true;hit[b.id]=true;continue;}
    var bt=b.tables||[];
    var shared=(a.tables||[]).filter(function(t){return bt.indexOf(t)>=0;});
    out.push({a:a.id,b:b.id,tables:shared,from:Math.max(as,bs),to:Math.min(ae,be)});
  }}
  return idsOnly?Object.keys(hit):out;
}
// The stable identity of ONE clash pair, for anything that has to remember a
// particular clash across renders — today that is the strip's per-row dismissal
// Set, which is keyed by pair rather than by booking so that dismissing
// "Pau vs Rita" does not also silence "Rita vs a third party".
//
// The separator is a control character, not "|" or "+", for the reason `undoKey`
// learned in v17.10.2: a separator reachable FROM THE DATA is a collision
// waiting to happen. Booking ids are `[0-9a-z]` from `genId`, but a recurring
// occurrence id is `"r" + ruleId + "_" + date`, so "_" and "-" are already
// spoken for and the next id format is not something this function gets to know
// about. Written as the ESCAPE and never as the raw byte: a literal 0x1F in
// source is invisible in every editor, grep and diff — the same class of trap
// as the HTML entity that hid from v17.9.0's glyph sweep.
//
// It lives HERE and not in ClashBanner because a component file that also
// exports a plain function trips `react-refresh/only-export-components`, which
// is a lint ERROR and a hard CI gate — the trap Icons.jsx's StatusIcon note
// already records. It also belongs here on the merits: the id of a clash is a
// property of the clash, not of the banner that happens to list it.
export function clashRowId(c){return c.a+"\u001f"+c.b;}
// v17.14.0 (/code-review follow-up): merge overlapping [from,to) minute spans.
//
// `clashSpans` (App.jsx) emitted one band per PAIR, so three bookings all
// clashing on one table drew three coincident bands stacked on the same pixels
// — three times the paint for one fact, and any future opacity on the band
// would have compounded per pair and made a three-way clash a different colour
// from a two-way one.
//
// Touching spans merge (`from <= to`), not just strictly overlapping ones: two
// clashes that meet at 20:30 are one continuously-contested stretch of that
// row, and drawing them as two bands separated by a zero-width seam is a
// rendering artefact rather than information. Input is not mutated.
export function mergeSpans(spans){
  if(!spans||spans.length<2) return spans||[];
  var s=spans.slice().sort(function(a,b){return a.from-b.from||a.to-b.to;});
  var out=[{from:s[0].from,to:s[0].to}];
  for(var i=1;i<s.length;i++){
    var last=out[out.length-1],cur=s[i];
    if(cur.from<=last.to){ if(cur.to>last.to) last.to=cur.to; }
    else out.push({from:cur.from,to:cur.to});
  }
  return out;
}
// v15.6.1: the ids version of verifyClean's pair-scan — returns every booking
// involved in a same-table overlap on `date` (active, assigned-tables only).
// Used by App.jsx's post-sync reconciliation to pick which booking to relocate
// when the optimiser is OFF.
// v17.11.0: derived from findClashes rather than repeating its loop a third
// time. The contract is unchanged (a deduped id array) and its tests are what
// prove that. verifyClean keeps its own copy on purpose — it short-circuits at
// the first clash, and it runs over every active date on every settled
// snapshot, so making it build a pair list it then throws away would be a real
// cost for no gain.
// v17.14.0: which is exactly what THIS function was then doing. It shares the
// loop with findClashes but takes the ids-only path, so no pair object and no
// intersection filter is built for data it discards — the reconciler calls it
// up to 20 times per dirty date.
export function findConflicts(bookings,date){
  return clashScan(bookings,date,true);
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
// urgent), then confirmed (upcoming), pending (awaiting confirmation, v17.0.0),
// completed (already left), cancelled.
// Previously inlined in ListView. Pure function of the status string.
export function statusOrder(s){return s==="seated"?0:s==="confirmed"?1:s==="pending"?2:s==="completed"?3:4;}

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
// v17.16.2 (CT-2B-02): `nowMins-toMins(b.time)` mixed axes, so a seated booking
// on ANY past date measured negative and clamped to the 15-minute floor — a
// party an hour into their meal drawn as a fifteen-minute block. Bounded by
// pastCloseMins for syncLiveDurations' reason: past its own day's close a
// booking shows its STORED duration, which auto-complete has already frozen at
// the close, rather than growing without limit.
export function liveBarDur(b,nowMins,today){
  // Same liveness test as syncLiveDurations, so the bar drawn and the duration
  // stored can never disagree: a booking the writer will not touch shows the
  // value the writer left.
  if(b&&b.status==="seated"&&seatedIsLive(b,today,nowMins)){
    return Math.max(15,seatedElapsed(b,today,nowMins));
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

// ── Range stats (v16.3.0) ─────────────────────────────────────────────────────
// Aggregate booking metrics over an inclusive date range [fromDate, toDate]
// (ISO date strings). Pure; one pass over the bookings list. Cancelled bookings
// are excluded from covers/bookings/table/hour tallies (matching daySummary);
// no-shows are counted separately (the flag OR a legacy history entry — the
// isNoShow rule, inlined here to keep booking-logic free of a customers.js dep).
//   totalCovers, totalBookings, avgParty
//   activeDays (distinct dates with ≥1 booking) + avgCoversPerDay
//   hours: [{hour, covers}] sorted busiest-first
//   tables: [{id, bookings, covers}] sorted by bookings desc
//   noShows
export function rangeStats(bookings,fromDate,toDate){
  var day=(bookings||[]).filter(function(b){return b&&b.date>=fromDate&&b.date<=toDate;});
  var active=day.filter(function(b){return b.status!=="cancelled";});
  var totalCovers=0,totalBookings=active.length;
  var byHour={},byTable={},dates={},noShows=0;
  day.forEach(function(b){
    var isNS=b.noShow===true||(Array.isArray(b.history)&&b.history.some(function(h){return h&&h.action==="no show";}));
    if(isNS) noShows++;
  });
  active.forEach(function(b){
    var size=Number(b.size)||2;
    totalCovers+=size;
    dates[b.date]=true;
    var h=Math.floor(toMins(b.time)/60);
    if(!byHour[h]) byHour[h]=0;
    byHour[h]+=size;
    (b.tables||[]).forEach(function(id){
      if(!byTable[id]) byTable[id]={id:id,bookings:0,covers:0};
      byTable[id].bookings+=1;byTable[id].covers+=size;
    });
  });
  var activeDays=Object.keys(dates).length;
  var hours=Object.keys(byHour).map(function(h){return {hour:Number(h),covers:byHour[h]};}).sort(function(a,b){return b.covers-a.covers;});
  var tables=Object.keys(byTable).map(function(id){return byTable[id];}).sort(function(a,b){return b.bookings-a.bookings||b.covers-a.covers;});
  return {
    totalCovers:totalCovers,
    totalBookings:totalBookings,
    avgParty:totalBookings?Math.round((totalCovers/totalBookings)*10)/10:0,
    activeDays:activeDays,
    avgCoversPerDay:activeDays?Math.round(totalCovers/activeDays):0,
    hours:hours,
    tables:tables,
    noShows:noShows
  };
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
    if(b.status==="seated"){seatedCount+=1;seatedCovers+=size;}else if(b.status==="confirmed"||b.status==="pending"){upcomingCount+=1;} // v17.0.0: pending counts as upcoming
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

// dayBookingsSig — v17.10.2. A content signature of ONE DATE's bookings: each
// booking's id paired with its `undoKey`, sorted so the answer does not depend
// on array order. Two lists with the same signature for a date are, as far as
// anything the app persists is concerned, the same day.
//
// It exists because `bookingsAfterAction` USED TO return a NEW array whether or
// not the pass changed anything, and the post-sync reconciliation effect
// (App.jsx) must be able to tell the difference. Without it that effect
// re-dispatched an identical snapshot on every commit whenever a date held a
// clash the optimizer cannot resolve — two `_locked` bookings on one table,
// which `applyOpt` copies through verbatim — and React re-ran the effect on the
// new reference forever.
//
// **v17.14.0 fixed that at the source**: `bookingsAfterAction` now returns its
// input array when the pass moved nothing, so a caller can compare identity.
// This function stays, because identity answers "did THIS pass change
// anything" while a signature answers "are these two lists the same day" —
// the reconciliation loop needs the second (it compares its own accumulated
// `next` against a pass's output across up to 20 iterations), and so would any
// future caller diffing two independently-derived snapshots.
//
// **It reuses `undoKey`'s field set deliberately, and the first version did not.**
// That version compared `id:tables` alone, which is wrong in a way that is easy
// to miss: `bookingsAfterAction` also runs `syncLiveDurations` (extending a
// seated party's `duration`/`customDur`) and `applyOpt` sets `_conflict` on
// every booking for the date. On a date that stays dirty — the all-locked clash
// this guard exists for — a tables-only comparison read those as "no change" and
// the effect DISCARDED them. Comparing the same fields undo already trusts means
// the guard cannot be narrower than the thing it is gating.
export function dayBookingsSig(list,date){
  if(!Array.isArray(list)) return "";
  var out=[];
  for(var i=0;i<list.length;i++){
    var b=list[i];
    if(!b||b.date!==date) continue;
    out.push(b.id+K_REC+undoKey(b));
  }
  return out.sort().join(K_LST);
}
