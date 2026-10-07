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
// the hook returns nothing. Adding a shortcut = a row in lib/shortcuts.js, plus
// the state/handler it reads as `K.<name>` in the ctx object at the call site.

import { useRef, useEffect } from "react";
import { isTyping, activatesItself } from "../lib/keyboard";
import { validateReminderDraft } from "../lib/reminders";
// v16.0.0 follow-up: the ←/→ Settings tab-cycle derives from SETTINGS_TABS (the
// ONE tab list) so a newly added tab can never be skipped. Never inline ids.
import { visibleTabs } from "../components/SettingsChrome";
import { todayStr } from "../lib/day";
// v18.4.4: the letter, symbol and arrow shortcuts are a table in lib/shortcuts.js
// (`resolveShortcut`), which decides; this hook only carries the decision out.
// SUMMARY_KEY ("s") and WEEK_KEY ("m") moved there with their rows.
import { resolveShortcut } from "../lib/shortcuts";
// WA sandbox: gates the X (simulator) key. It is a build constant, so it is
// handed to `resolveShortcut` rather than read there — and the I (inbox) key is
// gated on the whatsapp MODULE, like the toolbar button. Both gates are pinned
// in tests/wa-sandbox-integrity.test.js, after a merge once silently dropped
// the two keys (17.15.0).
import { WA_SANDBOX } from "../lib/waSandbox";

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
    // v18.0.0 phase 3: closes the capability grid and returns you to the Admin
    // tab underneath — the safe direction, and it holds no draft of its own
    // (every tick is written as it is made), so there is nothing to guard.
    case "roles":       return function(){K.setRolesFor(null);};
    // v18.0.0 session 8: Escape closes the activity log and returns you to the
    // Admin tab you opened it from. There is no decision in a log to lose.
    case "activity":    return function(){K.setActivityOpen(null);};
    case "settings":    return K.requestCloseSettings;
    case "history":     return function(){K.setShowHistory(false);};
    case "kitchen":     return function(){K.setConfirmKitchen(null);};
    // v18.0.0: Escape means the completion did not happen. It must NOT quietly
    // complete the booking without the voucher — that is what the modal's own
    // "Complete without using it" button is for, as a choice somebody made.
    case "voucher":     return function(){K.setVoucherAsk(null);};
    // Escape leaves the redemption exactly as it is and abandons the status
    // change — the same shape as its twin above, and the safe direction for a
    // prompt about money: dismissing it moves nothing.
    case "voucherback": return function(){K.setVoucherBack(null);};
    // v18.0.0 session 8: Escape is "Not now" — the voucher stays where it is,
    // open and attachable by hand. Nothing about the money moves.
    case "vouchercarry": return function(){K.setVoucherCarry(null);};
    // v18.0.0 session 7: Escape is "Done" — there is no decision in a note.
    case "seatnote":    return function(){K.setSeatNote(null);};
    // v18.0.0 session 8 (C3): Escape is "Back" — the seat does NOT happen. The
    // safe direction for a prompt whose other two answers both change a table.
    case "seatclash":   return function(){K.setSeatClash(null);};
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
    // WA sandbox. The inbox's own close CLEARS the filter state and the
    // return-to-inbox key, so Esc must go through it rather than the raw setter
    // — the same reason `form`/`walkin`/`manual` name a requestClose* here.
    case "wadelete":    return function(){K.setConfirmDeleteConv(null);};
    case "waarchive":   return function(){K.setConfirmArchive(null);};
    case "sim":         return function(){K.setShowSim(false);};
    case "inbox":       return K.closeInbox;
    case "week":        return function(){K.setShowWeek(false);};
    // v18.4.0: Escape is Cancel. The chooser stores nothing.
    case "print":       return function(){K.setPrintAsk(null);};
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
  //      Their own precedence is the layer order in lib/shortcuts.js.
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
        // v18.2.0: a focused control keeps its own Enter — Back goes back, − / +
        // steps — instead of the modal's primary action (lib/keyboard.js).
        if(activatesItself(e.target)) return;
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
      // v18.4.4: a table (lib/shortcuts.js). `resolveShortcut` reads K and
      // answers what the key means; the two things a shortcut can do are done
      // here. The Settings tab cycle's tab list is passed as a function because
      // `visibleTabs` lives in a component file: it runs over the VISIBLE tabs,
      // with BOTH gates (capability, then module), never the raw list.
      const found=resolveShortcut({key:k,shiftKey:e.shiftKey},K,{
        sandbox:WA_SANDBOX,
        today:todayStr(),
        settingsTabs:function(){return visibleTabs(K.can,K.hasModule).map(function(t){return t.id;});}
      });
      if(!found) return;
      if(found.prevent) e.preventDefault();
      if(found.act) found.act(K);
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
