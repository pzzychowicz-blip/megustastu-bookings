// src/lib/modal-keys.js
//
// v18.13.0 (#31): what Escape and Enter do to the topmost modal, moved verbatim out
// of useKeyboardShortcuts.js. They decide whether a draft is guarded and whether a
// booking is deleted, and nothing could run them there, so tests/modal-stack.test.js
// read the source for a `case` instead. The hook keeps the listener and the order it
// asks in; `K` is the ctx object App hands it, and tests hand in a recorder.

import { validateReminderDraft } from "./reminders.js";

// ── v17.14.0: the modal keyboard tables ──────────────────────────────────────
// Escape acts on ONE modal — the visually topmost, which App derives from
// MODAL_Z (useModalStack.js). This maps that id to what closing it means.
//
// Six of these are GUARDED closes (`requestClose*`): the surfaces that hold a
// draft raise the discard confirm when dirty. That is why the mapping lives
// here rather than being read off a mount site's `onClose` — this handler has
// never touched `onClose`, and a surface whose guard is not named here has an
// Esc key that walks straight past it.
export function escapeAction(K,id){
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
    case "specialday":  return K.requestCloseSpecialDay;
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
    // v18.8.0: Escape is Done. A photo has nothing to decide.
    case "waphoto":     return function(){K.setWaPhoto(null);};
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
export const MODAL_ENTER_ORDER=["discard","reminder","reminderdel","manual","kitchen",
  "reshuffle","del","prefpicker","walkin","form"];
// /code-review: a `switch`, like escapeAction above. These two solve the same
// dispatch problem ten lines apart and were written in two different shapes,
// which leaves the next person adding a modal choosing which to copy.
export function enterAction(K,id,e){
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
