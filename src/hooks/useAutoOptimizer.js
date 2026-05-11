// src/hooks/useAutoOptimizer.js
//
// Phase D3 (v14.1.10): Optimizer thermostat extracted from BookingApp.
// Owns the `autoOptimizer` feature flag plus its daily-reset behaviour:
// auto-off at 15:00 for today's shift, auto-on at new-day-start (before
// 15:00). The two transitions are gated by per-day refs so each fires
// exactly once per ISO date — at app mount if the boundary is already
// crossed, or at the moment of crossing during a running session.
//
// Hook signature:
//   const { autoOptimizer, setAutoOptimizer } = useAutoOptimizer({ nowMins });
//
// Why both effects depend on nowMins (not their own time read): nowMins is
// the single source of truth for wall-clock minute-of-day across the app.
// Wiring it as a hook arg keeps the dep arrays trivially correct and makes
// the once-per-minute re-evaluation cadence explicit.
//
// Why the setter is exposed: the keyboard 'o' shortcut and the optimizer
// toggle in TimelineView's legend both write to it (via kbRef and a direct
// prop, respectively). The shortcut path needs the setter accessible from
// BookingApp's kbRef builder; the TimelineView path needs it as a passable
// prop.
//
// Why the daily-reset refs (autoFlippedRef / autoOnRef) stay internal:
// they're pure implementation detail of the once-per-day behaviour.
// Nothing outside this hook needs to know they exist.
//
// Why both auto-on and auto-off coexist without conflict at the day
// boundary: each effect's first guard short-circuits the wrong half of
// the 24-hour cycle (`nowMins<15*60 return` in auto-off, `nowMins>=15*60
// return` in auto-on). At midnight, only auto-on fires; at 15:00, only
// auto-off fires. The per-day refs prevent re-firing within the same
// ISO date.

import { useState, useRef, useEffect } from "react";

export function useAutoOptimizer({ nowMins }){
  const [autoOptimizer, setAutoOptimizer] = useState(function(){
    const d=new Date();
    return d.getHours()*60+d.getMinutes()<15*60;
  });
  // Auto-off at 15:00 for today's shift.
  const autoFlippedRef=useRef(null);
  useEffect(function(){
    if(nowMins<15*60) return;
    const today=new Date().toISOString().slice(0,10);
    if(autoFlippedRef.current===today) return;
    autoFlippedRef.current=today;
    setAutoOptimizer(false);
  },[nowMins]);
  // Auto-on at new-day-start (before 15:00). Day transitions detected via
  // date-string key, so this fires at ~00:00 when the new day begins — or
  // at app mount if we start before 15:00. No reshuffle on flip.
  const autoOnRef=useRef(null);
  useEffect(function(){
    if(nowMins>=15*60) return;
    const today=new Date().toISOString().slice(0,10);
    if(autoOnRef.current===today) return;
    autoOnRef.current=today;
    setAutoOptimizer(true);
  },[nowMins]);

  return { autoOptimizer, setAutoOptimizer };
}
