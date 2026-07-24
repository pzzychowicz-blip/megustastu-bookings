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
import { validateReminderDraft } from "../lib/reminders";
// v16.0.0 follow-up: the ←/→ Settings tab-cycle derives from SETTINGS_TABS (the
// ONE tab list) so a newly added tab can never be skipped. Never inline ids.
import { SETTINGS_TABS } from "../components/SettingsChrome";

// v14.6.0: keyboard shortcut for the Summary panel toggle — "S" for Summary.
// NB: in List view with a booking focused, S marks it Seated (that check runs
// first); everywhere else S toggles the Summary. Rebind here + the Shortcuts row.
const SUMMARY_KEY="s";
// v14.7.0: shortcut to open the at-a-glance popover (now Week / Month — see
// WeekView). v14.9.0: rebound "K" → "M" to match the renamed "More" button.
// In-popover nav (W/M switch view, ←/→ period, ↑/↓ day, T this-period, Enter
// open) lives in WeekView. Change here + the Shortcuts "M" row to rebind.
const WEEK_KEY="m";

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
    function isTyping(el){if(!el) return false;const t=el.tagName;return t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||el.isContentEditable;}
    function handler(e){
      if(e.ctrlKey||e.metaKey||e.altKey) return;
      const K=kbRef.current;const k=e.key;const typing=isTyping(e.target);
      // ── Escape: close topmost modal (checked in visual z-order) ──
      if(k==="Escape"){
        // v14 p7: reminderEditor sits above Settings (z=250). Close it first.
        if(K.reminderEditor){e.preventDefault();K.setReminderEditor(null);return;}
        // v14 p7 fix: delete-confirm renders above Settings in DOM order.
        if(K.confirmReminderDel){e.preventDefault();K.setConfirmReminderDel(null);return;}
        // v14 p7 fix: reset tab to 'general' on Esc close — matches the
        // Close button and backdrop-click onClose behavior.
        if(K.showSettings){e.preventDefault();K.setShowSettings(false);K.setSettingsTab("general");return;}
        if(K.showHistory){e.preventDefault();K.setShowHistory(false);return;}
        if(K.confirmKitchen){e.preventDefault();K.setConfirmKitchen(null);return;}
        if(K.confirmReshuffle){e.preventDefault();K.setConfirmReshuffle(false);return;}
        if(K.confirmCancel){e.preventDefault();K.setConfirmCancel(null);return;}
        if(K.confirmDel){e.preventDefault();K.setConfirmDel(null);return;}
        if(K.showPrefPicker){e.preventDefault();K.setShowPrefPicker(false);return;}
        // v16.3.0 correction: Esc dismisses the search panel (its "Done" button).
        if(K.showSearch){e.preventDefault();K.setShowSearch(false);return;}
        if(K.blockTarget){e.preventDefault();K.setBlockTarget(null);return;}
        if(K.manualTarget){e.preventDefault();K.setManualTarget(null);return;}
        if(K.showWalkin){e.preventDefault();K.setShowWalkin(false);return;}
        if(K.showWeek){e.preventDefault();K.setShowWeek(false);return;}
        if(K.showForm){e.preventDefault();K.setShowForm(false);return;}
        // v17.3.1: nothing modal is open — Esc drops the List selection (the
        // keyboard counterpart of clicking neutral space). LAST in the chain, so
        // Esc still closes a modal first when one is up.
        if(K.view==="list"&&K.selectedListId){e.preventDefault();K.setSelectedListId(null);return;}
        return;
      }
      // ── Enter: primary action of topmost modal ──
      if(k==="Enter"){
        // In a textarea Enter always inserts a newline — never save.
        if(typing&&e.target.tagName==="TEXTAREA") return;
        // v14 p7: reminderEditor is topmost when open — save if draft is valid.
        if(K.reminderEditor){
          if(!validateReminderDraft(K.reminderEditor.draft)){
            e.preventDefault();K.saveReminderFromEditor();
          }
          return;
        }
        // v14 p7 fix: delete-confirm Enter → confirm deletion.
        if(K.confirmReminderDel){e.preventDefault();K.doDeleteReminder(K.confirmReminderDel);return;}
        // Manual Modal handles its own Enter. Quick-status popup is ambiguous.
        if(K.manualTarget) return;
        if(K.confirmKitchen){
          const isW=K.confirmKitchen==="walkin";
          e.preventDefault();
          K.setConfirmKitchen(null);
          if(isW) K.doSaveWalkin(); else K.doSave();
          return;
        }
        if(K.confirmReshuffle){e.preventDefault();K.setConfirmReshuffle(false);K.forceReshuffle();return;}
        if(K.confirmDel){e.preventDefault();K.delBooking(K.confirmDel);return;}
        if(K.showPrefPicker){e.preventDefault();K.setShowPrefPicker(false);return;}
        if(K.showWalkin){e.preventDefault();K.saveWalkin();return;}
        if(K.showForm){
          // Save button is disabled when date is empty → mirror that here.
          if(K.form&&K.form.date){e.preventDefault();K.save();}
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
      // Active only when Settings is the top layer (reminderEditor and
      // confirmReminderDel are sub-modals on top of Settings — when they're
      // open, arrows should flow to their default behavior or be no-ops).
      // Takes priority over the global ←/→ day-nav shortcut below.
      if(K.showSettings&&!K.reminderEditor&&!K.confirmReminderDel){
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
      //   Manual with target "__new__" to match the "= Assign" button.
      //   B / H remain edit-only (new bookings have no history or source).
      //   C clears the tables assignment — logic mirrors the form's 3 Clear
      //   buttons: if the user has set manualTables, clear those; else in
      //   edit mode, if the stored booking has a manual assignment not yet
      //   marked cleared, set _clearManual:true; else no-op.
      const topLayer=K.showSettings||K.showHistory||K.confirmKitchen||K.confirmReshuffle||K.confirmCancel||K.confirmDel||K.blockTarget||K.manualTarget||K.reminderEditor||K.confirmReminderDel;
      if(K.showForm&&!topLayer){
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
      const anyModal=K.showForm||K.showWalkin||K.showWeek||K.showHistory||K.confirmDel||K.confirmReshuffle||K.confirmCancel||K.confirmKitchen||K.manualTarget||K.blockTarget||K.showPrefPicker||K.showSettings||K.showSearch||K.reminderEditor||K.confirmReminderDel;
      if(anyModal) return;
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
      const VIEW_ORD=["timeline","list","plan"];
      const goView=function(v){if(K.view!==v){K.bumpSlide(VIEW_ORD.indexOf(v)>VIEW_ORD.indexOf(K.view)?"mgt-view-in-right":"mgt-view-in-left");}K.setView(v);};
      if(k==="t"||k==="T"){e.preventDefault();goView("timeline");return;}
      if(k==="l"||k==="L"){e.preventDefault();goView("list");return;}
      if(k==="p"||k==="P"){e.preventDefault();goView("plan");return;}
      if(k==="d"||k==="D"){e.preventDefault();K.goToDate(new Date().toISOString().slice(0,10));return;}
      if(k==="n"||k==="N"){e.preventDefault();K.openNew();return;}
      if(k==="w"||k==="W"){e.preventDefault();K.openWalkin();return;}
      // v14.6.0: toggle the Summary panel (provisional key — see SUMMARY_KEY).
      if(k===SUMMARY_KEY||k===SUMMARY_KEY.toUpperCase()){e.preventDefault();K.setSummaryOpen(function(o){return !o;});return;}
      if(k===WEEK_KEY||k===WEEK_KEY.toUpperCase()){e.preventDefault();K.setShowWeek(true);return;}
      if(k==="ArrowLeft"){e.preventDefault();const d1=new Date(K.viewDate);d1.setDate(d1.getDate()-1);K.goToDate(d1.toISOString().slice(0,10));return;}
      if(k==="ArrowRight"){e.preventDefault();const d2=new Date(K.viewDate);d2.setDate(d2.getDate()+1);K.goToDate(d2.toISOString().slice(0,10));return;}
      // ── Timeline-only shortcuts ──
      if(K.view==="timeline"){
        const today=new Date().toISOString().slice(0,10);
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
      const anyModal=K.showForm||K.showWalkin||K.showWeek||K.showHistory||K.confirmDel||K.confirmReshuffle||K.confirmCancel||K.confirmKitchen||K.manualTarget||K.blockTarget||K.showPrefPicker||K.showSettings||K.showSearch||K.reminderEditor||K.confirmReminderDel;
      if(anyModal) return;
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
