// src/lib/keyboard.js
//
// v17.10.2 — the shared keyboard guard. `isTyping(el)` answers the one question
// every key handler in this app has to ask first: is focus inside something the
// user is typing into, so should this keystroke be left alone?
//
// It lived twice — `useKeyboardShortcuts.js` (the global shortcuts) and
// `ManualModal.jsx` (its local S / C / Enter handling) — with identical bodies.
// One concern, two implementations, and the failure mode of a drift between them
// is subtle in the way that costs a service: a key that is correctly ignored
// while typing in one place and silently swallows a keystroke in the other.
//
// `SELECT` is in the list although you do not type into it: a `<select>` handles
// its own letter keys for type-ahead, so treating it as a text field is what
// stops the app's single-letter shortcuts from stealing them.
export function isTyping(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
}
