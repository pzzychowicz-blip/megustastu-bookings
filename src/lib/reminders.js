// src/lib/reminders.js
// Pure reminder logic — slot keys, applicability checks, active banner
// computation, fire-state pruning, draft validation. No React, no DOM, no
// Firebase.
//
// Phase A extraction (v15-refactor): moved verbatim from App v.14.1 dev.jsx
// lines 441–521. No semantic changes.

import { toMins } from "./booking-logic";

// ── v14 preview 7: Reminder helpers (module-level, pure) ────────────────────
// `rem_<id>_<YYYY-MM-DD>_<HH:MM>` — identifies one fire slot. Per-slot keys
// let staff dismiss the 21:00 banner without affecting the 22:00 banner of
// the same reminder.
export function reminderFireKey(id,date,time){return "rem_"+id+"_"+date+"_"+time;}

// Is this reminder active for the given date? Handles both recurrence types.
// For weekly, noon-local is used to sidestep DST shifts crossing midnight.
export function reminderAppliesTo(r,date){
  if(!r||!r.active) return false;
  var rec=r.recurrence||{};
  if(rec.type==="once") return rec.date===date;
  if(rec.type==="weekly"){
    var dow=new Date(date+"T12:00:00").getDay();
    return Array.isArray(rec.days)&&rec.days.indexOf(dow)>=0;
  }
  return false;
}

// Which reminder slots are currently needing display? A slot qualifies when
// (a) the reminder applies to `date`, (b) its time-of-day <= nowMins,
// (c) it's not marked `done`, (d) it's not snoozed past `Date.now()`.
// Sorted by time ascending (earliest-fired at top — typically most urgent).
export function getActiveReminderBanners(reminders,fires,date,nowMins){
  var out=[];
  var nowMs=Date.now();
  (reminders||[]).forEach(function(r){
    if(!reminderAppliesTo(r,date)) return;
    (r.times||[]).forEach(function(t){
      if(toMins(t)>nowMins) return;
      var key=reminderFireKey(r.id,date,t);
      var st=fires?fires[key]:null;
      if(st){
        if(st.status==="done") return;
        if(st.status==="snoozed"&&st.until&&nowMs<st.until) return;
      }
      out.push({reminder:r,time:t,fireKey:key});
    });
  });
  out.sort(function(a,b){return toMins(a.time)-toMins(b.time);});
  return out;
}

// Prune fire-state entries for dates earlier than today. Runs once on mount
// to keep storage lean — without this, dismissed entries accumulate.
// Today's entries are kept so same-day reopens don't re-fire dismissed slots.
export function pruneOldReminderFires(fires,todayStr){
  if(!fires||typeof fires!=="object") return {};
  var next={};
  Object.keys(fires).forEach(function(k){
    var m=k.match(/_(\d{4}-\d{2}-\d{2})_/);
    if(m&&m[1]>=todayStr) next[k]=fires[k];
  });
  return next;
}

// Validate a reminder draft from the editor. Returns an error string, or null
// if valid. For once-reminders: at least one (date,time) combo must be in the
// future (per design decision — no dead reminders allowed). For weekly: no
// past-time check needed (recurs forever), but at least one weekday required.
export function validateReminderDraft(d){
  if(!d||!d.text||!d.text.trim()) return "Text is required.";
  if(!Array.isArray(d.times)||!d.times.length) return "Add at least one time.";
  for(var i=0;i<d.times.length;i++){if(!/^\d{2}:\d{2}$/.test(d.times[i])) return "Invalid time format.";}
  var rec=d.recurrence||{};
  if(rec.type==="once"){
    if(!rec.date) return "Pick a date.";
    var now=new Date();var todayStr=now.toISOString().slice(0,10);
    if(rec.date<todayStr) return "Date is in the past.";
    if(rec.date===todayStr){
      var nowM=now.getHours()*60+now.getMinutes();
      var anyFuture=d.times.some(function(t){return toMins(t)>nowM;});
      if(!anyFuture) return "All times are in the past.";
    }
  } else if(rec.type==="weekly"){
    if(!Array.isArray(rec.days)||!rec.days.length) return "Pick at least one weekday.";
  } else {
    return "Pick a recurrence type.";
  }
  return null;
}
