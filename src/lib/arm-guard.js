// src/lib/arm-guard.js
//
// v18.14.0 (correction 19, Patryk): a two-tap delete takes two taps somebody
// meant. The first tap turns the button into "Confirm — …" where it stands, and
// it must stay there so the second tap can find it, so a double tap went through
// both: on DEV two taps 120ms apart erased a customer. For half a second after
// arming, a second tap does nothing, on every armed button.
//
// One clock for the app rather than one per button: arming another button only
// restarts the wait, which is the safe direction. Each site is the same two lines
// (`markArmed()` beside the arm, `if (!armSettled()) return;` before the act), and
// tests/arm-guard.test.js fails a two-tap button that leaves either out. The two
// functions take the time only so the test can hand it in.

export const ARM_GUARD_MS = 500;

let armedAt = -Infinity;

export function markArmed(now = performance.now()) {
  armedAt = now;
}

export function armSettled(now = performance.now()) {
  return now - armedAt >= ARM_GUARD_MS;
}

// v18.14.0 (correction 20, Patryk): a confirm is the same thing as an armed button,
// because it opens where the finger may still be. Measured on a phone: the booking
// form's Back sits exactly under the confirm's Discard, so a second tap 220ms or more
// after the first lost the draft. App marks the clock when one of these reaches the
// top of the modal stack, and each action asks `armSettled()` as it is tapped. Inside
// the handler, not through a wrapper called in render: that made the React Compiler
// give up on BookingApp, 21 lint errors for one helper.
export const CONFIRM_MODALS = ["discard", "del", "cancel", "reminderdel", "reshuffle", "wadelete", "waarchive"];
