// ── useSettingsUndo ──────────────────────────────────────────────────────────
// v18.19.1 (Patryk): Undo for Settings → Layout. Every save the tab makes goes
// through `saveLayoutStep`, which records it; the pill above the Settings
// dialog names the step an Undo press would take back, and each press takes
// back one, back to when Settings opened. The pill is drawn in the dialog's
// footer (SettingsUndoToast). WHAT is recorded, merged, named and
// refused is `lib/settings-undo.js`; this keeps the stack, the pill and the key.
//
// Four things here are load-bearing:
//  • **The history is forgotten when Settings closes**, by any door (Close, Esc,
//    a booking opened from the activity log): `open` going false empties it,
//    adjusted during render, so no door has to remember to.
//  • **A step is recorded only for a save `saveLayout` WROTE** (it returns the
//    sanitized config, or null when its guards refused). `before` is the stored
//    layout, so both sides of every comparison went through `sanitizeLayout`.
//  • **An Undo writes through `saveLayout` too**, never around it: the load and
//    empty-layout guards, the rev CAS and the activity entry all apply, and the
//    restore is not itself recorded.
//  • **The pill stays while there is a step to take back** (no timer, Patryk);
//    a refusal says why for 3.5s and fades, keeping its text as it goes.
//
// Ctrl+Z / ⌘Z does the same as the pill's button while Settings is open, so a
// keyboard can take a step back without walking Tab to the footer. Not while
// typing (a text box's own undo is the browser's), not while a modal sits over
// Settings, and only with a step to take back.
import { useEffect, useRef, useState } from "react";
import { recordStep, undoStep } from "../lib/settings-undo";
import { isTyping } from "../lib/keyboard";

const NOTICE_MS = 3500;
const IDLE = { stack: [], text: "", undo: false, show: false };

export function useSettingsUndo({ open, onTop, layout, saveLayout }) {
  const [u, setU] = useState(IDLE);
  const timer = useRef(null);

  // Settings closed: the steps go with it. The pill fades where it was.
  if (!open && (u.stack.length || u.show)) setU({ ...u, stack: [], show: false, undo: false });

  function saveLayoutStep(next) {
    const before = layout;
    const cfg = saveLayout(next);
    if (!cfg) return;
    const stack = recordStep(u.stack, before, cfg);
    if (stack === u.stack) return;
    clearTimeout(timer.current);
    const top = stack[stack.length - 1];
    setU(top
      ? { stack: stack, text: top.label, undo: true, show: true }
      : { ...u, stack: stack, undo: false, show: false });
  }

  function undo() {
    const plan = undoStep(u.stack, layout);
    if (!plan) return;
    clearTimeout(timer.current);
    if (plan.refuse) {
      setU({ stack: [], text: plan.refuse, undo: false, show: true });
      timer.current = setTimeout(function () { setU(function (s) { return { ...s, show: false }; }); }, NOTICE_MS);
      return;
    }
    if (!saveLayout(plan.restore)) return;
    const rest = plan.rest;
    const top = rest[rest.length - 1];
    setU(top ? { ...u, stack: rest, text: top.label } : { ...u, stack: rest, undo: false, show: false });
  }

  // The keyboard's way to the pill. Re-added each render, so it always calls
  // this render's `undo` (the src/CLAUDE.md row on an effect kept fresh by a
  // parent's props: list nothing rather than something stale).
  // `onTop`: Settings is the top of the modal stack, so a key pressed in a
  // confirm raised over it (the discard confirm) does not change the layout
  // behind that confirm.
  const canUndo = open && onTop && u.stack.length > 0;
  useEffect(function () {
    if (!canUndo) return undefined;
    function onKey(e) {
      if (e.key !== "z" && e.key !== "Z") return;
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      undo();
    }
    window.addEventListener("keydown", onKey);
    return function () { window.removeEventListener("keydown", onKey); };
  });
  useEffect(function () { return function () { clearTimeout(timer.current); }; }, []);

  return { saveLayoutStep, undo, pill: { text: u.text, undo: u.undo, show: u.show } };
}
