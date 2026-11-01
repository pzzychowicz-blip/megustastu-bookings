// src/components/whatsapp/ConversationMenu.jsx
// v18.14.0 (correction 6, Patryk): the ⋯ at the far right of a conversation's
// header, and the menu under it. Re-check and Not a customer stood beside Archive,
// and on an archived thread Delete did too, four buttons competing for one glance.
// One action stays out (Archive, or Restore) and the rest are one tap further:
// `[Archive] [⋯]`, the order he chose.
//
// It grows from the button that opened it and nothing dims, because nothing here
// is a decision about the whole screen, which is why it is neither `PopupShell`
// nor the List card's centred card. A tap anywhere else closes it, and that tap
// still does what it does. It is drawn in the tree rather than in a portal: the
// inbox is an `Overlay`, whose focus trap and `aria-modal` hold what is inside it.
//
// ── Keyboard ─────────────────────────────────────────────────────────────────
// A real ARIA menu. Enter or Space on the ⋯ opens it with focus on the first row
// (a tap does not move focus in: see `toggle`), ↑ ↓ Home End move, Tab leaves and
// closes, because the rows are `tabIndex={-1}`, and Escape closes it and hands
// focus back. It is one listener in the capture phase on `window`, for two reasons:
// a tap on iOS leaves focus on nothing, so no element of this component would see
// the key, and `useKeyboardShortcuts` would otherwise close the whole inbox on
// Escape. InboxPanel's own keys are on `window` in the capture phase as well, and
// nothing here can run before them, so they stand down while a menu is in the DOM.

import { useEffect, useRef, useState } from "react";
import { BTN, FW, H, IC, M, R, S, SP, T } from "../../lib/constants";
import { nextMenuIndex } from "../../lib/keyboard";
import { mkBtn, Presence } from "../atoms";
import { MoreIcon } from "../Icons";
import { RecheckIcon } from "./WaIcons";

// The spin is a LOOP: nothing arrives and nothing leaves, so neither direction
// curve describes it and it keeps `linear`. A documented exception, alongside
// .mgt-shimmer and .mgt-dot-pulse, and marked as one so `check:style`'s motion rule
// reads it as a decision.
const TURNING = { animation: "mgt-spin 900ms linear infinite" /* @motion */ };

const ROW = {
  display: "flex", alignItems: "center", gap: SP.mid, width: "100%", minHeight: H.touch,
  padding: "0 12px", border: "none", borderRadius: R.inset, fontSize: T.lead, fontWeight: FW.semi,
  fontFamily: "inherit", textAlign: "left", whiteSpace: "nowrap",
};

// `items`: { id, label, icon, onPick, title, danger, inactive, turning }. `inactive`
// is a row that is showing a state ("Checking…"), `aria-disabled` rather than
// `disabled` because Chrome blurs a focused control that becomes disabled.
// `busy` says the work one of them started is still running: the ⋯ shows it, so the
// answer can be waited for with the menu shut.
export function ConversationMenu({ items, busy = false }) {
  const [open, setOpen] = useState(false);
  const [byKey, setByKey] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  function close(refocus) {
    setOpen(false);
    if (refocus && btnRef.current) btnRef.current.focus({ preventScroll: true });
  }
  function toggle(e) {
    // `detail` is 0 for a click a key made. Focus moves in only then, since a script
    // focus after a tap draws the ring (src/CLAUDE.md, the focus-return row).
    setByKey(e.detail === 0);
    setOpen(!open);
  }
  // Focus goes back in this handler, BEFORE the action: an action that raises a
  // confirm makes the page `inert`, and a focus() after that does nothing.
  function pick(it) {
    if (it.inactive) return;
    close(true);
    it.onPick();
  }

  useEffect(function () {
    if (!open) return undefined;
    // Capture, so a control that stops propagation cannot leave the menu hanging.
    function onDown(e) { if (rootRef.current && !rootRef.current.contains(e.target)) close(false); }
    function onKey(e) {
      if (e.key === "Tab") { close(false); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
      const rows = menuRef.current ? Array.from(menuRef.current.querySelectorAll('[role="menuitem"]')) : [];
      const next = nextMenuIndex(rows.indexOf(document.activeElement), e.key, rows.length);
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      rows[next].focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return function () {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title={busy ? "Checking…" : "More actions"}
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ background: BTN.quiet, width: H.chrome, height: H.chrome, minHeight: H.chrome, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 })}
      >
        {/* Stacked in one grid cell, so the two marks cross-fade in place. The arrow
            stays mounted and paused, which costs nothing at opacity 0, and a fade
            reverses from where it is if the answer comes back quickly. */}
        <span aria-hidden="true" style={{ display: "grid" }}>
          <span style={{ gridArea: "1 / 1", display: "flex", opacity: busy ? 0 : 1, transition: "opacity " + M.move }}><MoreIcon size={IC.chrome} /></span>
          <span style={{ gridArea: "1 / 1", display: "flex", opacity: busy ? 1 : 0, transition: "opacity " + M.move, ...TURNING, animationPlayState: busy ? "running" : "paused" }}><RecheckIcon size={IC.chrome} /></span>
        </span>
      </button>
      {/* v18.3.0 (M9)'s pair for a popover anchored to its trigger, from the corner
          under the ⋯. Presence keeps the last rows on screen for the exit, and
          `pointerEvents` keeps a second tap from landing on one of them. */}
      <Presence
        show={open}
        inClass="mgt-pop-in"
        outClass="mgt-pop-out"
        style={{
          position: "absolute", top: "calc(100% + " + SP.snug + "px)", right: 0, zIndex: 30,
          transformOrigin: "top right", minWidth: 216, padding: SP.snug,
          background: "var(--menu-bg)", border: "1px solid var(--border-soft)", borderRadius: R.sheet,
          boxShadow: "var(--shadow-popover)", pointerEvents: open ? "auto" : "none",
        }}
      >
        {open ? (
          <div ref={menuRef} role="menu" aria-label="More actions">
            {items.map(function (it, i) {
              const Icon = it.icon;
              return (
                <button /* @no-lift a row as wide as the menu: .mgt-ac-row tints it through --row-bg */
                  key={it.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  autoFocus={byKey && i === 0}
                  aria-disabled={it.inactive ? "true" : undefined}
                  title={it.title}
                  onClick={function () { pick(it); }}
                  className="mgt-ac-row mgt-nopress"
                  style={{ ...ROW, cursor: it.inactive ? "default" : "pointer", color: it.danger ? "var(--danger-text)" : it.inactive ? S.muted : S.text }}
                >
                  <span aria-hidden="true" style={{ display: "flex", ...(it.turning ? TURNING : null) }}><Icon size={IC.control} /></span>
                  {it.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </Presence>
    </div>
  );
}
