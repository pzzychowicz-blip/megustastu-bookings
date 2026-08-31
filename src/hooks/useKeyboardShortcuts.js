// ── useKeyboardShortcuts ─────────────────────────────────────────────────────
// v17.3.3: extracted VERBATIM from App.jsx (the first "de-monolith" extraction,
// behind the v17.3.2 test net). Owns the app's two window-level, mount-once
// listeners:
//   1. the global keydown handler (every shortcut in Shortcuts.jsx), and
//   2. the v17.3.1 neutral-space mousedown that clears the List selection
// Both read the SAME latest-values ref, refreshed every render from the `ctx`
// object BookingApp passes in — so the listeners are registered once but always
// see fresh state/handlers without re-subscribing (the original kbRef pattern,
// unchanged). Pure logic, no JSX → .js.
//
// Contract: call once per render from BookingApp with the full context object;
// the hook returns nothing. Adding a shortcut = add the state/handler to the
// ctx object at the call site AND use it here via `K.<name>`.

import { useRef, useEffect } from "react";
import { isTyping } from "../lib/keyboard";
import { validateReminderDraft } from "../lib/reminders";
// v16.0.0 follow-up: the ←/→ Settings tab-cycle derives from SETTINGS_TABS (the
// ONE tab list) so a newly added tab can never be skipped. Never inline ids.
import { SETTINGS_TABS } from "../components/SettingsChrome";
import { todayStr } from "../lib/day";

// v14.6.0: keyboard shortcut for the Summary panel toggle — "S" for Summary.
// NB: in List view with a booking focused, S marks it Seated (that check runs
// first); everywhere else S toggles the Summary. Rebind here + the Shortcuts row.
const SUMMARY_KEY="s";
// v14.7.0: shortcut to open the at-a-glance popover (now Week / Month — see
// WeekView). v14.9.0: rebound "K" → "M" to match the renamed "More" button.
// In-popover nav (W/M switch view, ←/→ period, ↑/↓ day, T this-period, Enter
// open) lives in WeekView. Change here + the Shortcuts "M" row to rebind.
const WEEK_KEY="m";

// ── v17.14.0: the modal keyboard tables ──────────────────────────────────────
// Escape acts on ONE modal — the visually topmost, which App derives from
// MODAL_Z (useModalStack.js). This maps that id to what closing it means.
//
// Six of these are GUARDED closes (`requestClose*`): the surfaces that hold a
// draft raise the discard confirm when dirty. That is why the mapping lives
// here rather than being read off a mount site's `onClose` — this handler has
// never touched `onClose`, and a surface whose guard is not named here has an
// Esc key that walks straight past it.
function escapeAction(K,id){
  switch(id){
    case "splitmenu":   return function(){K.setSplitMenuFor(null);};
    // The discard confirm is raised BY the surface below it, so Esc dismisses it
    // and returns you to what you were editing — the safe direction.
    case "discard":     return function(){K.setConfirmDiscard(null);};
    case "reminder":    return K.requestCloseReminderEditor;
    case "reminderdel": return function(){K.setConfirmReminderDel(null);};
    // requestCloseSettings owns the tab reset, on both its paths.
    case "settings":    return K.requestCloseSettings;
    case "history":     return function(){K.setShowHistory(false);};
    case "kitchen":     return function(){K.setConfirmKitchen(null);};
    case "reshuffle":   return function(){K.setConfirmReshuffle(false);};
    case "cancel":      return function(){K.setConfirmCancel(null);};
    case "del":         return function(){K.setConfirmDel(null);};
    case "prefpicker":  return function(){K.setShowPrefPicker(false);};
    case "search":      return function(){K.setShowSearch(false);};
    case "block":       return K.requestCloseBlock;
    case "manual":      return K.requestCloseManual;
    case "walkin":      return K.requestCloseWalkin;
    // v17.14.0: new. The waitlist Overlay had no Esc branch, so it was the one
    // modal in the app you could not dismiss from the keyboard.
    case "waitlist":    return function(){K.setShowWaitlist(false);};
    case "week":        return function(){K.setShowWeek(false);};
    case "form":        return K.requestCloseForm;
    default:            return null;
  }
}
// Enter's own order, top-first — see the note at the Enter branch for why it is
// not MODAL_Z reversed. An id absent from this list falls through to the next
// one down, which is what the old `if` chain did by simply not mentioning it.
const MODAL_ENTER_ORDER=["discard","reminder","reminderdel","manual","kitchen",
  "reshuffle","del","prefpicker","walkin","form"];
// /code-review: a `switch`, like escapeAction above. These two solve the same
// dispatch problem ten lines apart and were written in two different shapes,
// which leaves the next person adding a modal choosing which to copy.
function enterAction(K,id,e){
  switch(id){
    case "discard":     e.preventDefault();K.doDiscard();return;
    case "reminder":
      // Save only a valid draft; an invalid one swallows the key rather than
      // letting it reach the surface underneath.
      if(!validateReminderDraft(K.reminderEditor.draft)){e.preventDefault();K.saveReminderFromEditor();}
      return;
    case "reminderdel": e.preventDefault();K.doDeleteReminder(K.confirmReminderDel);return;
    // ManualModal handles its own Enter — this SWALLOWS the key rather than
    // falling through. Quick-status popup is ambiguous, so it has no entry.
    case "manual":      return;
    case "kitchen": {
      const isW=K.confirmKitchen==="walkin";
      e.preventDefault();
      K.setConfirmKitchen(null);
      if(isW) K.doSaveWalkin(); else K.doSave();
      return;
    }
    case "reshuffle":   e.preventDefault();K.setConfirmReshuffle(false);K.forceReshuffle();return;
    case "del":         e.preventDefault();K.delBooking(K.confirmDel);return;
    case "prefpicker":  e.preventDefault();K.setShowPrefPicker(false);return;
    case "walkin":      e.preventDefault();K.saveWalkin();return;
    case "form":
      // Save is disabled when the date is empty → mirror that, and swallow.
      if(K.form&&K.form.date){e.preventDefault();K.save();}
      return;
    // An id absent from MODAL_ENTER_ORDER never reaches here; one present with
    // no case would swallow the key, which is why the two lists sit together.
    default:            return;
  }
}

export function useKeyboardShortcuts(ctx){
  // v14 preview 3: Global keyboard shortcuts. Uses a ref to capture the latest
  // state and action callbacks on every render so the window-level keydown
  // listener (mounted once) always sees fresh values without re-subscribing.
  //
  // Precedence rules:
  //   1. Modifier keys (Ctrl / Meta / Alt) — always pass through so browser/OS
  //      shortcuts (Cmd+F, Ctrl+R, etc.) keep working.
  //   2. Escape — closes the topmost open modal (matches visual z-order).
  //   3. Enter — triggers the primary action of the topmost modal. In a
  //      <textarea> Enter still inserts a newline. The Manual Table Assignment
  //      modal handles its own Enter internally; globally we skip it.
  //   4. Letter / symbol / arrow shortcuts — suppressed when focus is on an
  //      input / textarea / select / contenteditable so typing is never hijacked.
  //      Suppressed as well while any modal is open, except for A/P/B/H which
  //      fire only when the Edit Booking modal is the top layer.
  const kbRef=useRef({});
  // v17.3.3 (lint-clean change vs the App.jsx original, which assigned during
  // render): refresh the ref in a dep-less effect — it runs after EVERY commit,
  // so the window listeners still always read the latest state/handlers, but
  // the write no longer happens mid-render (react-hooks/refs). Keydown/mousedown
  // events can only fire between commits, after this effect has run.
  useEffect(function(){kbRef.current=ctx;});
  useEffect(function(){
    function handler(e){
      if(e.ctrlKey||e.metaKey||e.altKey) return;
      const K=kbRef.current;const k=e.key;const typing=isTyping(e.target);
      // ── Escape: close the topmost modal ──
      // v17.14.0: this was a seventeen-branch chain written in descending
      // z-order by hand. The order is now DATA (MODAL_Z in useModalStack.js) and
      // `K.topModalId` is derived from it, so the chain is a table lookup.
      //
      // Two things that were wrong here and are now structurally impossible:
      // the waitlist Overlay had no branch at all, so Esc did not close it; and
      // a modal added without one was silently un-escapable, which is half of
      // "adding a new drafting surface = three wirings, not one".
      //
      // The guarded closes are still the point: this handler never touches a
      // modal's `onClose` prop, so a surface holding a draft has to name its
      // requestClose* HERE or Esc is a silent back door past the unsaved-changes
      // guard.
      if(k==="Escape"){
        const close=K.topModalId?escapeAction(K,K.topModalId):null;
        if(close){e.preventDefault();close();return;}
        // v17.3.1: nothing modal is open — Esc drops the List selection (the
        // keyboard counterpart of clicking neutral space). LAST, so Esc still
        // closes a modal first when one is up.
        if(K.view==="list"&&K.selectedListId){e.preventDefault();K.setSelectedListId(null);return;}
        return;
      }
      // ── Enter: primary action of the topmost modal that HAS one ──
      // v17.14.0: also a table, but deliberately NOT the same order as Escape.
      // The two chains diverged before this refactor — Enter checked the manual
      // picker ABOVE the kitchen confirm while Escape has it far below — and
      // several modals (settings, history, cancel, search, block, week,
      // splitmenu, waitlist) have no Enter branch at all and FALL THROUGH to
      // whatever is under them. Unifying the two orders would have been a
      // keyboard behaviour change smuggled into a refactor, so the divergence is
      // preserved and made visible instead: MODAL_ENTER_ORDER is exactly the old
      // sequence, and an id absent from it falls through exactly as before.
      if(k==="Enter"){
        // In a textarea Enter always inserts a newline — never save.
        if(typing&&e.target.tagName==="TEXTAREA") return;
        for(let i=0;i<MODAL_ENTER_ORDER.length;i++){
          const id=MODAL_ENTER_ORDER[i];
          if(!K.modalOpen[id]) continue;
          enterAction(K,id,e);
          return;
        }
        return;
      }
      // ── Letter / symbol / arrow shortcuts: never hijack typing ──
      if(typing) return;
      // v16.4.0 (Patryk): Shift+D (dark toggle) and ? (Settings/shortcuts help)
      // are GLOBAL — they fire even while a modal is open and NEVER close it.
      // Placed here (above the settings-arrow / prefPicker / form-letter blocks
      // and the anyModal guard) so they always win; no form/pref shortcut uses D
      // or ?, so nothing is shadowed. The `typing` guard above still lets you
      // type "D"/"?" into a field. `?` opens Settings ON TOP of any open modal.
      if((k==="d"||k==="D")&&e.shiftKey){e.preventDefault();K.onToggleDark();return;}
      // v17.1.0: Shift +/− adjusts the per-device app width (±50px, 900–2400) —
      // global like Shift+D, so it works with Settings open (the stepper tracks
      // live). Matches EVERY key value the physical +/− keys produce under
      // Shift across layouts: US Shift+"=" → "+"; ES/DE Shift+the-plus-key →
      // "*" (/code-review fix #2 — without it, width-INCREASE was dead on the
      // restaurant's Spanish keyboards); Shift+"-" → "_" everywhere. Deliberate
      // side effect: Shift+"=" no longer zooms the timeline (unshifted "="/"-"
      // still do).
      if(e.shiftKey&&(k==="+"||k==="="||k==="*")){e.preventDefault();K.onSetAppWidth(K.appWidth+50);return;}
      if(e.shiftKey&&(k==="_"||k==="-")){e.preventDefault();K.onSetAppWidth(K.appWidth-50);return;}
      if(k==="?"){e.preventDefault();K.setShowSettings(true);return;}
      // ── v14 p7: Settings tab-cycle with ←/→ ──
      // Active only when Settings is the top layer. Takes priority over the
      // global ←/→ day-nav shortcut below.
      // v17.14.0: was `showSettings && !reminderEditor && !confirmReminderDel`,
      // a hand-written exclusion list naming the two sub-modals that existed
      // when it was written. It missed the discard confirm (v17.5.0) and the
      // split menu, so arrows cycled Settings tabs behind both. `topModalId`
      // asks the question the comment was already asking.
      if(K.topModalId==="settings"){
        if(k==="ArrowLeft"||k==="ArrowRight"){
          e.preventDefault();
          // v16.0.0 follow-up: derived from SETTINGS_TABS (Settings.jsx — the ONE
          // tab list) so a newly added tab can never be skipped here again. Do
          // NOT inline a literal id list (that's how Customers got skipped).
          const TABS=SETTINGS_TABS.map(function(t){return t.id;});
          let curIdx=TABS.indexOf(K.settingsTab);if(curIdx<0) curIdx=0;
          const newIdx=k==="ArrowLeft"?(curIdx-1+TABS.length)%TABS.length:(curIdx+1)%TABS.length;
          K.setSettingsTab(TABS[newIdx]);
          return;
        }
        // v14.4.0: N → new reminder when the Reminders tab is active.
        if((k==="n"||k==="N")&&K.settingsTab==="reminders"){e.preventDefault();K.openNewReminder();return;}
      }
      // ── Edit Booking modal shortcuts ──
      // Only fire when Edit is the TOP layer (no popup on top of it).
      // ── Preferred-table picker: captures C (= Clear). Sits ABOVE the
      //    form-modal block so A/P/B/H don't fire while the picker is open
      //    (which matches the user-intuitive "only the top modal responds"
      //    precedence).
      if(K.showPrefPicker){
        if(k==="c"||k==="C"){
          const prefs=Array.isArray(K.form&&K.form.preferredTables)?K.form.preferredTables:[];
          if(prefs.length>0){
            e.preventDefault();
            K.setForm(function(f){return Object.assign({},f,{preferredTables:[]});});
          }
        }
        return; // no other letter shortcuts propagate while picker is up
      }
      // ── Edit & New Booking form shortcuts ──
      //   A / P work in BOTH new and edit (request 1). In new mode, A opens
      //   Manual with target "__new__" to match the Assign button.
      //   B / H remain edit-only (new bookings have no history or source).
      //   C clears the tables assignment — logic mirrors the form's 3 Clear
      //   buttons: if the user has set manualTables, clear those; else in
      //   edit mode, if the stored booking has a manual assignment not yet
      //   marked cleared, set _clearManual:true; else no-op.
      // v17.14.0: was a ten-term `topLayer` expression, the third hand-written
      // list of "what is above the form" in this file. It omitted the discard
      // confirm, the pref picker, the search panel and the split menu — so
      // A/P/B/H fired straight through them into the form underneath.
      if(K.topModalId==="form"){
        if(k==="a"||k==="A"){e.preventDefault();K.setManualTarget(K.editId||"__new__");return;}
        if(k==="p"||k==="P"){e.preventDefault();K.setShowPrefPicker(true);return;}
        if(k==="c"||k==="C"){
          const mtLen=Array.isArray(K.form&&K.form.manualTables)?K.form.manualTables.length:0;
          if(mtLen>0){
            e.preventDefault();
            K.setForm(function(f){return Object.assign({},f,{manualTables:[]});});
            K.setSwapAffected(null);
          } else if(K.editId){
            const cur3=K.bookings.find(function(b){return b.id===K.editId;});
            const isManual3=cur3&&(cur3._manual||cur3._locked)&&cur3.tables&&cur3.tables.length>0;
            const alreadyCleared=!!(K.form&&K.form._clearManual);
            if(isManual3&&!alreadyCleared){
              e.preventDefault();
              K.setForm(function(f){return Object.assign({},f,{manualTables:[],_clearManual:true});});
              K.setSwapAffected(null);
            }
          }
          return;
        }
        if(K.editId){
          if(k==="b"||k==="B"){
            const cur=K.bookings.find(function(b){return b.id===K.editId;});
            if(cur&&(cur.status==="seated"||cur.status==="completed")){e.preventDefault();K.bookAgain(cur);}
            return;
          }
          if(k==="h"||k==="H"){
            const c2=K.bookings.find(function(b){return b.id===K.editId;});
            if(c2&&c2.history&&c2.history.length>0){e.preventDefault();K.setShowHistory(true);}
            return;
          }
        }
      }
      // ── Global shortcuts: suppressed while any modal is open ──
      // v17.12.0: ONE derivation, computed in App next to the state it reads.
      // This was the same 17-term expression written out twice in this file, and
      // `inert` would have made it three.
      if(K.anyModal) return;
      // v16.3.0: "/" opens the global booking search (typing guard above keeps it
      // out of form fields; anyModal guard keeps it from re-firing while open).
      if(k==="/"){e.preventDefault();K.setShowSearch(true);return;}
      // ── v14.4.0: List-view per-card shortcuts (act on the focused booking) ──
      // ↑/↓ move the focus ring; A/E/S/C/Shift+C/Delete act on it. Placed before
      // the global letter shortcuts so Delete wins over "jump to today" ONLY while
      // a card is focused — with nothing focused, D still jumps to today. ←/→
      // fall through to the global day-nav below.
      if(K.view==="list"){
        const list=K.listDay||[];
        if(k==="ArrowDown"||k==="ArrowUp"){
          e.preventDefault();
          if(!list.length) return;
          const idx=list.findIndex(function(b){return b.id===K.selectedListId;});
          const ni=idx<0?(k==="ArrowDown"?0:list.length-1):(k==="ArrowDown"?Math.min(list.length-1,idx+1):Math.max(0,idx-1));
          K.setSelectedListId(list[ni].id);
          K.bumpListFocus();
          return;
        }
        const sel=K.selectedListId?list.find(function(b){return b.id===K.selectedListId;}):null;
        if(sel){
          if(k==="a"||k==="A"){e.preventDefault();K.setManualTarget(sel.id);return;}
          if(k==="e"||k==="E"){e.preventDefault();K.openEdit(sel);return;}
          // v17.0.0: a PENDING card can only be confirmed (or cancelled) — S/C
          // are no-ops on it, matching the List/RMB button gating.
          if(k==="s"||k==="S"){e.preventDefault();if(sel.status!=="pending") K.updateStatus(sel.id,"seated");return;}
          if((k==="c"||k==="C")&&e.shiftKey){e.preventDefault();K.updateStatus(sel.id,"cancelled");return;}
          if(k==="c"||k==="C"){e.preventDefault();if(sel.status!=="pending") K.updateStatus(sel.id,"completed");return;}
          if(k==="d"||k==="D"){e.preventDefault();K.setConfirmDel(sel.id);return;}
        }
      }
      // v17.0.0: three views — slide direction follows the view order (T·L·P).
      // v17.5.0: T/L/P delegate to App's pickView (passed as K.goView) — the
      // ONE place that knows the split rules (replace the focused pane, or swap
      // when that view is already in the other one). The local fallback keeps
      // the original single-view behaviour if the ctx ever lacks it.
      const VIEW_ORD=["timeline","list","plan"];
      const goView=K.goView||function(v){if(K.view!==v){K.bumpSlide(VIEW_ORD.indexOf(v)>VIEW_ORD.indexOf(K.view)?"mgt-view-in-right":"mgt-view-in-left");}K.setView(v);};
      if(k==="t"||k==="T"){e.preventDefault();goView("timeline");return;}
      if(k==="l"||k==="L"){e.preventDefault();goView("list");return;}
      if(k==="p"||k==="P"){e.preventDefault();goView("plan");return;}
      if(k==="d"||k==="D"){e.preventDefault();K.goToDate(todayStr());return;}
      if(k==="n"||k==="N"){e.preventDefault();K.openNew();return;}
      if(k==="w"||k==="W"){e.preventDefault();K.openWalkin();return;}
      // v14.6.0: toggle the Summary panel (provisional key — see SUMMARY_KEY).
      if(k===SUMMARY_KEY||k===SUMMARY_KEY.toUpperCase()){e.preventDefault();K.setSummaryOpen(function(o){return !o;});return;}
      if(k===WEEK_KEY||k===WEEK_KEY.toUpperCase()){e.preventDefault();K.setShowWeek(true);return;}
      if(k==="ArrowLeft"){e.preventDefault();const d1=new Date(K.viewDate);d1.setDate(d1.getDate()-1);K.goToDate(d1.toISOString().slice(0,10));return;}
      if(k==="ArrowRight"){e.preventDefault();const d2=new Date(K.viewDate);d2.setDate(d2.getDate()+1);K.goToDate(d2.toISOString().slice(0,10));return;}
      // ── Timeline-only shortcuts ──
      if(K.view==="timeline"){
        const today=todayStr();
        const isToday=K.viewDate===today;
        if(k==="f"||k==="F"){
          if(isToday){
            e.preventDefault();
            if(!K.followNow){K.setFollowNow(true);if(K.timelineZoom<K.tlFollowZoom) K.setTimelineZoom(K.tlFollowZoom);}
            else{K.setFollowNow(false);}
          }
          return;
        }
        if(k==="+"||k==="="){e.preventDefault();K.setTimelineZoom(function(z){return Math.min(K.tlMaxZoom,z+0.5);});return;}
        if(k==="-"){e.preventDefault();K.setTimelineZoom(function(z){return Math.max(1,z-0.5);});return;}
        if(k==="0"){e.preventDefault();K.setTimelineZoom(1);K.setFollowNow(false);return;}
        if(k==="o"||k==="O"){
          if(isToday){e.preventDefault();K.setAutoOptimizer(function(p){return !p;});}
          return;
        }
        if(k==="r"||k==="R"){
          if(isToday&&!K.autoOptimizer){e.preventDefault();K.setConfirmReshuffle(true);}
          return;
        }
      }
    }
    window.addEventListener("keydown",handler);
    return function(){window.removeEventListener("keydown",handler);};
  },[]);

  // v17.3.1: click on neutral space (anywhere outside a booking card) clears the
  // List selection — the focus ring is a keyboard/search target, so leaving it
  // stuck after the user has moved on is confusing. Reads the same kbRef as the
  // keyboard handler so the listener can be registered ONCE (mount-only).
  // Guards: List view only, and never while a modal is open (a card's Edit /
  // Tables modal must not drop the selection its own actions act on).
  useEffect(function(){
    function onDown(e){
      const K=kbRef.current;
      if(K.view!=="list"||!K.selectedListId) return;
      // v17.12.0: ONE derivation, computed in App next to the state it reads.
      // This was the same 17-term expression written out twice in this file, and
      // `inert` would have made it three.
      if(K.anyModal) return;
      const t=e.target;
      if(t&&t.closest&&t.closest("[data-flip-id]")) return; // inside a card (incl. its buttons)
      K.setSelectedListId(null);
    }
    // MOUSEDOWN ONLY — deliberately no touchstart. A tap on a touchscreen still
    // fires the compatibility mousedown, so taps are covered; a swipe-SCROLL
    // does not, so scrolling the list no longer wipes the selection (the
    // v17.3.0 autocomplete lesson: a touchstart-driven action can't tell a tap
    // from the first frame of a scroll).
    window.addEventListener("mousedown",onDown);
    return function(){window.removeEventListener("mousedown",onDown);};
  },[]);
}
