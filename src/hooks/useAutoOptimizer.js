// src/hooks/useAutoOptimizer.js
//
// Phase D3 (v14.1.10): Optimizer thermostat extracted from BookingApp.
// Owns the `autoOptimizer` feature flag plus its daily-reset behaviour:
// auto-off at the cutoff for today's shift, auto-on at new-day-start (before
// the cutoff). The two transitions are gated by per-day refs so each fires
// exactly once per ISO date — at app mount if the boundary is already
// crossed, or at the moment of crossing during a running session.
//
// v15.0.0: the cutoff and the automatic-switching behaviour are now editable
// (Settings → General, Firebase settings/optimizer via useOptimizerSettings).
//   const { autoOptimizer, setAutoOptimizer } =
//     useAutoOptimizer({ nowMins, cutoffMins, autoSwitch });
// `cutoffMins` replaces the old hard-coded 15*60. `autoSwitch === false` makes
// the thermostat FULLY MANUAL — both daily-reset effects early-return, so the
// flag changes only via the `o` shortcut / timeline toggle. Defaults
// ({ cutoffMins: 15*60, autoSwitch: true }) reproduce the pre-v15 behaviour.
//
// Why both effects depend on nowMins (not their own time read): nowMins is
// the single source of truth for wall-clock minute-of-day across the app.
// Wiring it as a hook arg keeps the dep arrays trivially correct and makes
// the once-per-minute re-evaluation cadence explicit. cutoffMins/autoSwitch
// join the dep arrays so a config change re-evaluates immediately.
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
// the 24-hour cycle (`nowMins<cutoff return` in auto-off, `nowMins>=cutoff
// return` in auto-on). At midnight, only auto-on fires; at the cutoff, only
// auto-off fires. The per-day refs prevent re-firing within the same
// ISO date.

import { useState, useRef, useEffect } from "react";

export function useAutoOptimizer({ nowMins, cutoffMins, autoSwitch }){
  // Defaults reproduce the pre-v15 hard-coded behaviour when the optimizer
  // settings haven't loaded yet (cutoff 15:00, automatic switching on).
  const cutoff = typeof cutoffMins === "number" ? cutoffMins : 15*60;
  const auto = autoSwitch !== false;
  const [autoOptimizer, setAutoOptimizer] = useState(function(){
    const d=new Date();
    return d.getHours()*60+d.getMinutes()<cutoff;
  });
  // Auto-off at the cutoff for today's shift. Skipped entirely in manual mode.
  const autoFlippedRef=useRef(null);
  useEffect(function(){
    if(!auto) return;
    if(nowMins<cutoff) return;
    const today=new Date().toISOString().slice(0,10);
    if(autoFlippedRef.current===today) return;
    autoFlippedRef.current=today;
    setAutoOptimizer(false);
  },[nowMins,cutoff,auto]);
  // Auto-on at new-day-start (before the cutoff). Day transitions detected via
  // date-string key, so this fires at ~00:00 when the new day begins — or
  // at app mount if we start before the cutoff. No reshuffle on flip. Skipped
  // entirely in manual mode.
  const autoOnRef=useRef(null);
  useEffect(function(){
    if(!auto) return;
    if(nowMins>=cutoff) return;
    const today=new Date().toISOString().slice(0,10);
    if(autoOnRef.current===today) return;
    autoOnRef.current=today;
    setAutoOptimizer(true);
  },[nowMins,cutoff,auto]);

  return { autoOptimizer, setAutoOptimizer };
}
