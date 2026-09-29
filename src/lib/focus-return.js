// src/lib/focus-return.js — v18.3.1 (ROADMAP: focus return after a modal)
//
// Which element a dialog hands focus back to when it closes. `useDialog`
// (atoms) used to take `document.activeElement` in its mount effect, which is
// right only when the opener still HOLDS focus by then — and measured from the
// keyboard with StrictMode off (the production shape), three kinds of opener
// do not:
//
//   - Settings: the modal is a lazy chunk, so its Overlay first renders after
//     the commit that made the page behind it `inert`, which blurred the cog.
//     activeElement is <body>.
//   - Find a booking: the panel auto-focuses its search box at commit, before
//     the effect, so activeElement is INSIDE the dialog, and on close it is
//     detached.
//   - The List card's ⋯ → Delete / Cancelled: the pick unmounts the menu
//     holding focus, and the confirm's page-inert commit blurs whatever the
//     menu handed focus back to. activeElement is <body>.
//
// All three blurred their opener a moment before the dialog's effect ran, so
// the answer is a short record of recent `focusout`s: when activeElement is
// <body> or inside the dialog, fall back to the latest blur that is outside
// the dialog, still in the document and recent. `+ New` and Walk-in were
// already right and take the first branch unchanged.
//
// Two limits, both about not moving focus somewhere nobody asked for:
//   - RECENT_MS: a blur from before this interaction is not its opener.
//   - never a TEXT field: on iOS a tap on a button does not focus it, so the
//     latest blur can be the search box somebody left a minute ago; focusing it
//     on close would pop the on-screen keyboard. `isTyping`'s own list.

import { isTyping } from "./keyboard";

export const RECENT_MS = 1500;   // a cold lazy chunk has to load in between
const KEEP = 6;

const recent = [];               // [{ el, t }], newest last
let tracking = false;

// A capture listener on the document sees every blur, including the one
// `inert` causes. Installed when this module LOADS (bottom of the file), not by
// the first dialog: the first dialog's own opener blurs before that dialog
// mounts, and the first version, installed from useDialog, missed exactly that
// blur (Find a booking, opened first, measured).
export function trackBlurs() {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  document.addEventListener("focusout", function (e) {
    recent.push({ el: e.target, t: performance.now() });
    if (recent.length > KEEP) recent.shift();
  }, true);
}

// The pure decision, so it can be tested without a DOM. `active` is
// document.activeElement at the dialog's mount, `inDialog(el)` / `usable(el)`
// answer for one element, `blurs` is the record, `now` the clock.
export function pickOpener(active, isBody, inDialog, usable, blurs, now) {
  if (active && !isBody(active) && !inDialog(active)) return active;
  for (let i = blurs.length - 1; i >= 0; i--) {
    const b = blurs[i];
    if (now - b.t > RECENT_MS) break;
    if (!isBody(b.el) && !inDialog(b.el) && usable(b.el)) return b.el;
  }
  return null;
}

// The DOM half: what `useDialog` calls in its mount effect.
export function openerFor(dialogEl) {
  return pickOpener(
    document.activeElement,
    function (el) { return el === document.body || el === document.documentElement; },
    function (el) { return !!dialogEl && dialogEl.contains(el); },
    function (el) { return el.isConnected && typeof el.focus === "function" && !isTyping(el); },
    recent,
    performance.now()
  );
}

trackBlurs();
