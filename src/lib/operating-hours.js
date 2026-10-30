// src/lib/operating-hours.js
//
// v18.13.0 (#31): the two whitelists over `settings/operatingHours.days`, moved
// verbatim out of useOperatingHours.js. tests/schema.test.js hashed them there, which
// spots a change but cannot spot a wrong result; tests/operating-hours.test.js runs them.

import { DEFAULT_WEEK_HOURS } from "./constants.js";
import { clampHours } from "./special-days.js";

// Clamp ONE day. Bounds mirror the v14.5.0 single-pair editor: open 6–22,
// close (open+1)–25 (close may run past midnight). `closed` coerced to boolean.
// v18.10.0: the bounds are `clampHours`, which a special day obeys too.
export function sanitizeDay(raw){
  const src = raw && typeof raw === "object" ? raw : {};
  const h = clampHours(src.open, src.close);
  return { open: h.open, close: h.close, closed: src.closed === true };
}

// Accept BOTH the new {days:{0..6}} shape AND the legacy flat {open,close}
// (read as all-7-days-uniform → migrated on the next save). Anything else →
// the default week.
export function sanitizeWeek(val){
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
