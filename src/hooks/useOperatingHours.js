// src/hooks/useOperatingHours.js
//
// v14.4.0: Operating-hours subsystem — the app's FIRST Firebase `settings` node,
// shared across devices (theme stays per-device in localStorage; only
// restaurant-wide config goes to Firebase — see CLAUDE.md).
//
// v15.0.0: opening hours are now PER-WEEKDAY. The node was reshaped from a flat
// `{open, close}` to `{ days: { "0":{open,close,closed}, … "6":{…} } }` (keys 0–6
// = Sun–Sat, matching Date#getUTCDay). A legacy flat value is read as
// all-7-days-uniform and migrated to the new shape on the next save (sanitizeWeek
// handles both). Each weekday can also be marked `closed`.
//
// On each snapshot the hook (a) pushes the schedule into constants.js via
// setWeekHours(), then (b) points the live ESM bindings OPEN/CLOSE/GRID_CLOSE/
// QUARTER_HOURS at the ACTIVE view-day via setActiveDayHours(viewDate). That call
// runs on every render (the hook takes viewDate) so navigating days repaints the
// timeline/forms with that day's hours — booking-logic's pure functions read
// hoursFor(date) for any OTHER date, so a booking whose date ≠ viewDate stays
// correct. setActiveDayHours mutates module bindings only (no setState), so
// calling it during render is a safe, idempotent side-effect.
//
// Write-guard mirrors usePersistence: a `loaded` ref refuses writes until the
// initial read completes. The empty-array guard doesn't apply (small object).

import { useState, useRef, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { DEFAULT_WEEK_HOURS, setWeekHours, setActiveDayHours } from "../lib/constants";

const TODAY = () => new Date().toISOString().slice(0, 10);

// Clamp ONE day. Bounds mirror the v14.5.0 single-pair editor: open 6–22,
// close (open+1)–25 (close may run past midnight). `closed` coerced to boolean.
function sanitizeDay(raw){
  const src = raw && typeof raw === "object" ? raw : {};
  let o = Math.round(Number(src.open));
  let c = Math.round(Number(src.close));
  if(!Number.isFinite(o)) o = 13;
  if(!Number.isFinite(c)) c = 22;
  o = Math.max(6, Math.min(22, o));
  c = Math.max(o + 1, Math.min(25, c));
  return { open: o, close: c, closed: src.closed === true };
}

// Accept BOTH the new {days:{0..6}} shape AND the legacy flat {open,close}
// (read as all-7-days-uniform → migrated on the next save). Anything else →
// the default week.
function sanitizeWeek(val){
  const week = {};
  if(val && typeof val === "object" && val.days && typeof val.days === "object"){
    for(let i = 0; i < 7; i++) week[i] = sanitizeDay(val.days[i]);
  } else if(val && typeof val === "object" && (("open" in val) || ("close" in val))){
    const uni = sanitizeDay(val); // legacy flat — every day the same
    for(let j = 0; j < 7; j++) week[j] = { ...uni };
  } else {
    for(let k = 0; k < 7; k++) week[k] = sanitizeDay(DEFAULT_WEEK_HOURS[k]);
  }
  return week;
}

export function useOperatingHours(viewDate){
  // Seed from the defaults (all days 13/22, open) until Firebase responds.
  const [weekHours, setWH] = useState(() => sanitizeWeek(null));
  const loaded = useRef(false);
  // v16.0.0: revision-CAS ref (lib/revGuard.js) — a stale device's overwrite is
  // rejected server-side; the rollback echo restores state via onValue.
  const revRef = useRef(0);
  useEffect(function(){ return attachRev("settings/operatingHours", revRef); }, []);

  useEffect(function(){
    const unsub = onValue(ref(db, "settings/operatingHours"), function(snap){
      const val = snap.val();
      if(val && typeof val === "object"){
        const wk = sanitizeWeek(val);
        setWeekHours(wk); // update the module schedule (drives hoursFor/weekRange)
        setWH(wk);        // trigger a React repaint
      }
      // Node absent (first run): keep the default week already applied at import.
      loaded.current = true;
    });
    return unsub;
  }, []);

  // Apply the ACTIVE view-day's hours to the live bindings on every render so the
  // timeline/forms (which read OPEN/CLOSE at render time) repaint when viewDate
  // changes. Module-side-effect only — no setState — so it's safe in render.
  setActiveDayHours(viewDate || TODAY());

  // Persist one day (partial patch merged onto the current day). Writes the whole
  // {days} object so the node always carries the new shape.
  function saveDayHours(weekdayKey, patch){
    if(!loaded.current){
      console.warn("[SAFE] Refused to write operatingHours — initial read has not completed yet.");
      return;
    }
    const k = Number(weekdayKey);
    const next = { ...weekHours };
    next[k] = sanitizeDay({ ...weekHours[k], ...(patch || {}) });
    setWeekHours(next);
    setWH(next);
    setActiveDayHours(viewDate || TODAY());
    writeWithRev("settings/operatingHours", { days: next }, revRef);
  }

  // "Copy to all days" — set every weekday to one day's full config.
  function saveAllDays(dayConfig){
    if(!loaded.current){
      console.warn("[SAFE] Refused to write operatingHours — initial read has not completed yet.");
      return;
    }
    const clean = sanitizeDay(dayConfig);
    const next = {};
    for(let i = 0; i < 7; i++) next[i] = { ...clean };
    setWeekHours(next);
    setWH(next);
    setActiveDayHours(viewDate || TODAY());
    writeWithRev("settings/operatingHours", { days: next }, revRef);
  }

  return { weekHours, saveDayHours, saveAllDays };
}
