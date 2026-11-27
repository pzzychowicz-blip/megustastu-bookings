// ── useSettingsUndo ──────────────────────────────────────────────────────────
// v18.19.1 (Patryk): Undo for Settings → Layout. v18.20.0 (Patryk): for every
// tab, as ONE history for the whole dialog. Every save Settings makes goes
// through a saver the hook wraps (`savers` → `save.<name>`, by `track`), which records it; the pill in
// the dialog's footer (SettingsUndoToast) names the step an Undo press would
// take back, and each press takes back one, back to when Settings opened. WHAT
// is recorded, merged and refused is `lib/settings-undo.js`, what a step is
// called `lib/settings-undo-labels.js`; this keeps the stack, the pill and the
// key.
//
// `nodes` maps a node FAMILY to its adapter (`lib/settings-undo.js` says what
// a node id is: "settings/general", or a family and a key, "voucher:1234"):
//   value(key)                  → the node as stored now, sanitized
//   restore(key, before, after) → write `before` back through the node's own
//                                 writer; truthy when it was dispatched
//   after(key, ret, before, args) (optional) → the value the save wrote, from
//                                 the save's return; null when it refused. By
//                                 default the return itself when it is an
//                                 object (the v18.19.1 contract: a writer
//                                 returns the sanitized value it stored, or
//                                 null when its guards refused).
//   context(key, args) (optional) → what the pill's sentence needs that the
//                                 node does not hold (a guest's name).
//
// Five things here are load-bearing:
//  • **The history is forgotten when Settings closes**, by any door (Close, Esc,
//    a booking opened from the activity log): `open` going false empties it,
//    adjusted during render, so no door has to remember to.
//  • **A step is recorded only for a save that WROTE**, with the stored node as
//    `before`, so both sides of every comparison went through the node's own
//    sanitizer.
//  • **An Undo writes through the node's own writer too**, never around it: the
//    load and empty guards, the rev or per-child CAS and the activity entry all
//    apply, and the restore is not itself recorded.
//  • **A save records through a state UPDATER** (`recordStep` is pure), so two
//    saves in one handler both land on the stack.
//  • **The pill stays while there is a step to take back** (no timer, Patryk);
//    a refusal says why for 3.5s, then the pill names the next step if a step
//    of another node is left (v18.20.0, Patryk), or fades keeping its text.
//    **`undo` is how the pill LOOKS** (the Undo button, the neutral dot), and
//    only a refusal sets it false. So a pill that goes off after the last
//    Undo, a tap taking the only step back, or Close fades as it looked; with
//    `undo: false` it turned amber and lost its button for the length of the
//    exit, the refusal's look (/code-review, measured on DEV). Whether a press
//    can act is `u.stack.length`, which Ctrl+Z asks too.
//
// Ctrl+Z / ⌘Z does the same as the pill's button while Settings is open, so a
// keyboard can take a step back without walking Tab to the footer. Not while
// typing (a text box's own undo is the browser's), not while a modal sits over
// Settings, and only with a step to take back.
import { useEffect, useState } from "react";
import { recordStep, undoStep, undoRefused, pillText } from "../lib/settings-undo";
import { describeStep } from "../lib/settings-undo-labels";
import { isTyping } from "../lib/keyboard";
import { SETTINGS_TABS } from "../components/SettingsChrome";

const NOTICE_MS = 3500;
const IDLE = { stack: [], text: "", undo: false, show: false, notice: 0 };
// Each refusal's notice gets its own number, and its timer acts only while the
// state still carries it: a save or an Undo in between moves `notice` on, so
// a late timer changes nothing. No timer ref, so a saver `track` returns reads
// no ref, and calling `track` in render is not reading one (React Compiler).
let noticeSeq = 0;

function familyOf(id) { const i = id.indexOf(":"); return i > 0 ? id.slice(0, i) : id; }
function keyOf(id) { const i = id.indexOf(":"); return i > 0 ? id.slice(i + 1) : null; }
function tabLabel(id) {
  const t = SETTINGS_TABS.find(function (x) { return x.id === id; });
  return t ? t.label : "";
}

export function useSettingsUndo({ open, onTop, tab, nodes, savers }) {
  const [u, setU] = useState(IDLE);
  const top = u.stack.length ? u.stack[u.stack.length - 1] : null;

  // Settings closed: the steps go with it. The pill fades where it was, saying
  // what it said: `u.text` is only the sentence of a pill that names no step
  // (a refusal, or one fading), so it is set here from the step on top
  // (/code-review: it faded saying an older step, measured on DEV).
  if (!open && (u.stack.length || u.show)) setU({ ...u, stack: [], text: u.undo && top ? pillText(top, tab, tabLabel) : u.text, show: false });

  // `node` is a node id, or a function of the save's arguments that returns one
  // (a voucher's code, a guest's identity); null records nothing. `via` is the
  // saver's name, so only taps on one control merge (lib/settings-undo.js).
  function track(node, save, via) {
    return function () {
      const args = arguments;
      const id = typeof node === "function" ? node.apply(null, args) : node;
      // Not while Settings is closed: the special-day editor also opens from
      // the day itself, and a step recorded there would only be forgotten.
      const ad = open && id ? nodes[familyOf(id)] : null;
      if (!ad) return save.apply(null, args);
      const key = keyOf(id);
      const before = ad.value(key);
      const ret = save.apply(null, args);
      const after = ad.after ? ad.after(key, ret, before, args) : (ret && typeof ret === "object" ? ret : null);
      if (after == null) return ret;
      const step = { node: id, tab: tab, via: via, before: before, after: after, ctx: ad.context ? ad.context(key, args) : undefined };
      setU(function (s) {
        const stack = recordStep(s.stack, step, describeStep);
        if (stack === s.stack) return s;
        if (stack.length) return { stack: stack, text: s.text, undo: true, show: true, notice: 0 };
        // A tap that took the only step back (a switch flipped back): the pill
        // fades saying that step, or the refusal it was saying.
        const gone = s.stack[s.stack.length - 1];
        return { ...s, stack: stack, text: s.undo && gone ? pillText(gone, tab, tabLabel) : s.text, show: false, notice: 0 };
      });
      return ret;
    };
  }

  // A refusal (`{refuse, rest}`): said in the warning tone for NOTICE_MS, then
  // the pill names the next step left, or fades.
  function sayRefusal(r) {
    const n = ++noticeSeq;
    setU({ stack: r.rest, text: r.refuse, undo: false, show: true, notice: n });
    setTimeout(function () {
      setU(function (s) {
        if (s.notice !== n) return s;
        return s.stack.length ? { ...s, undo: true, show: true, notice: 0 } : { ...s, show: false, notice: 0 };
      });
    }, NOTICE_MS);
  }

  function undo() {
    const plan = undoStep(u.stack, function (id) {
      const ad = nodes[familyOf(id)];
      return ad ? ad.value(keyOf(id)) : undefined;
    });
    if (!plan) return;
    if (plan.refuse) { sayRefusal(plan); return; }
    const ad = nodes[familyOf(plan.node)];
    if (!ad || !ad.restore(keyOf(plan.node), plan.restore, top.after)) { sayRefusal(undoRefused(u.stack, plan.node)); return; }
    const rest = plan.rest;
    // Emptied, the pill fades still saying the step it just took back.
    setU(rest.length
      ? { ...u, stack: rest, undo: true, show: true, notice: 0 }
      : { ...u, stack: rest, text: pillText(top, tab, tabLabel), show: false, notice: 0 });
  }

  // The keyboard's way to the pill. Re-added each render, so it always calls
  // this render's `undo` (the src/CLAUDE.md row on an effect kept fresh by a
  // parent's props: list nothing rather than something stale).
  // `onTop`: Settings is the top of the modal stack, so a key pressed in a
  // confirm raised over it (the discard confirm) does not change what is behind
  // that confirm. `u.undo`: not while a refusal is being said.
  const canUndo = open && onTop && u.undo && u.stack.length > 0;
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

  // `savers` maps a name to `[node, save]`, and `save.<name>` is that save
  // wrapped by `track`. Wrapped HERE rather than by a `track(...)` call in
  // App's JSX: a save closing over App's refs, handed to a function called
  // during render, is a React Compiler `react-hooks/refs` advisory per call
  // site (seven, measured), where handing it to a hook is not.
  const save = {};
  Object.keys(savers || {}).forEach(function (name) { save[name] = track(savers[name][0], savers[name][1], name); });

  // The pill's sentence is read at render, so a tab switch re-words it: the tab
  // is named only while you are on another (Patryk, v18.20.0).
  const text = u.undo && top ? pillText(top, tab, tabLabel) : u.text;
  return { save, undo, pill: { text: text, undo: u.undo, show: u.show } };
}
