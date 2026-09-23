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

// v18.2.0 — `activatesItself(el)`: does Enter on this element already DO
// something of its own, so a global Enter handler must leave the key alone?
//
// The Enter chain in `useKeyboardShortcuts.js` maps Enter to the topmost
// modal's primary action — the booking form's Save — whatever held focus, and
// it `preventDefault()`s the keydown, which also cancels the focused button's
// own activation. So Enter on a focused Back, Assign or − / + saved the booking
// instead of pressing the button under the keyboard. A focused control wins now.
//
// It does not change what Enter does on a freshly opened modal: `Overlay`
// focuses the dialog CONTAINER, not a control, precisely so a destructive
// button is never one Enter away — the chain still owns that case, and Enter
// from a text field still saves.
//
// Only elements the browser (or the app's own `role` wiring) ACTIVATES on
// Enter: a <button>, a link with an href, and the widget roles this app gives a
// key handler of their own (the timeline block and the plan table are
// `role="button"`, the Toggle atom is `role="switch"`). Checkbox and radio
// inputs are deliberately not in it — Enter does not toggle them natively.
const SELF_ACTIVATING_ROLES = ["button", "switch", "link", "menuitem", "option", "tab"];
export function activatesItself(el) {
  if (!el || !el.tagName) return false;
  if (el.tagName === "BUTTON") return true;
  if (el.tagName === "A" && el.hasAttribute && el.hasAttribute("href")) return true;
  const role = el.getAttribute ? el.getAttribute("role") : null;
  return !!role && SELF_ACTIVATING_ROLES.includes(role);
}
