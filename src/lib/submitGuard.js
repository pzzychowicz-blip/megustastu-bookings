// src/lib/submitGuard.js
//
// v17.16.0 — the commit-once guard behind the booking form and the walk-in form.
// One rule, stated once so both surfaces cannot drift apart:
//
//     ONE OPEN OF A FORM PRODUCES AT MOST ONE CREATE.
//
// WHY THIS EXISTS. Tapping Save twice creates two bookings. Measured in the
// v17.15.7 crash test: two clicks 200 ms apart produced two confirmed
// reservations on two different tables, and three synchronous clicks produced
// three. Nothing was broken on the way — each click is a fresh `doSave` minting
// a fresh `genId()`, so the per-`$id` CAS, the write guards, the capacity check
// and the optimiser all did exactly what they should. The app was not defending
// against this because it had no reason to think the two writes were related.
//
// WHY `disabled` ON THE BUTTON IS NOT THE FIX. The obvious answer is to disable
// Save while a save is in flight. It does not work here, and the reason is worth
// keeping: `doSaveNew`/`doSaveEdit` dispatch and then call `setShowForm(false)`,
// but the modal does not leave immediately — `Overlay` self-animates its close
// through `ModalPresence`, which holds the subtree mounted for `EXIT_MS`
// (`M.dur.move` 240 + `EXIT_PAD` 20 = 260 ms, lib/constants.js). For that
// quarter of a second the form is fading out and its Save button is still in the
// DOM, still hit-testable, and still wired to the same handler. A 200 ms second
// tap lands on a live button inside a modal that is already closing. Any fix
// that depends on React having re-rendered is racing the exit animation; this
// one is a synchronous check at the top of the dispatch path, so it cannot.
//
// THE THREE SEQUENCING RULES, which are the whole of the correctness here:
//
//   1. CHECK FIRST, at the top of the submit handler, before any validation.
//   2. ARM ONLY AFTER A DISPATCH ACTUALLY HAPPENED — never on a validation
//      return, or the user cannot correct a field and press Save again; and
//      never BEFORE the write call, or a throw inside it leaves the form open
//      and permanently unable to save. Arm on the line that closes the form.
//   3. RESET ON OPEN, not on close and not on a timer. `openForm` (App.jsx) and
//      `openWalkin` (useWalkin.js) are each the single door to their surface —
//      which is not a coincidence to lean on quietly: both are already the ONE
//      place that snapshots the unsaved-changes baseline, and CLAUDE.md records
//      that every open path must go through them for exactly that reason. This
//      guard rides a mechanism the repo already keeps in step.
//
// There is deliberately NO time window. A window would have to be longer than
// the exit animation and shorter than a plausible second booking, and picking
// that number would mean the guard silently stops guarding on a device having a
// slow frame. "Until this surface is opened again" is the exact statement of the
// bug, and it needs no clock.

// A surface that has just been opened, and may dispatch. Also the correct value
// for a ref that has never been touched — see `mayDispatch`.
export const READY = "ready";

// A surface whose submit has already been dispatched for this open.
export const DISPATCHED = "dispatched";

// May a submit proceed?
//
// Written as `!== DISPATCHED` rather than `=== READY` on purpose: it FAILS OPEN.
// An uninitialised ref, a `null` left by some future call site, or a state this
// module does not recognise all answer "yes, go ahead" — which costs at worst
// the duplicate this guard exists to prevent, in a case that should not arise.
// The inverse spelling would fail CLOSED, and a Save button that silently does
// nothing is a far worse failure than one that does its job twice: the first is
// invisible and unrecoverable without a reload, the second is at least on screen
// where somebody can delete the extra booking.
export function mayDispatch(state) {
  return state !== DISPATCHED;
}
