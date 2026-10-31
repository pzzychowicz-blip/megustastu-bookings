// src/lib/haptics.js — v18.14.0 (L7)
//
// A short pulse when a dragged block lifts and when it lands. A finger on the
// tablet covers the block it is dragging, so the hand gets told.
//
// Per device, like Larger text, because the motor is this device's. On by
// default, so only "off" is ever stored. The pulse reads the switch at the moment
// it fires, which is why no prop has to reach a block.
//
// Silent wherever it cannot work, and it never throws into a drag. Safari has no
// `navigator.vibrate`, so Settings hides the switch there (`canVibrate`). Chrome
// refuses before the page's first tap and returns false. A device with no motor
// accepts the call and does nothing, which nothing here can detect, so whether the
// tablet buzzes is a question for the tablet.
const OFF_KEY = "mgt-tl-vibrate-off";
const PULSE_MS = 25;

export function canVibrate() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function readVibrate() {
  try { return localStorage.getItem(OFF_KEY) !== "1"; } catch { return true; }
}

export function setVibrate(on) {
  try {
    if (on) localStorage.removeItem(OFF_KEY); else localStorage.setItem(OFF_KEY, "1");
  } catch { /* ignore */ }
}

export function pulse() {
  if (!canVibrate() || !readVibrate()) return false;
  try { return navigator.vibrate(PULSE_MS); } catch { return false; }
}
