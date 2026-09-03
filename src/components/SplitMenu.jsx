// src/components/SplitMenu.jsx
//
// v17.5.0 — the two-step popup that builds a Split View, opened by
// right-clicking (desktop) or pressing-and-holding (touch) one of the
// Timeline / List / Plan buttons.
//
//   1. "How should it split?"   — side by side / top and bottom
//   2. "Add which view?"        — the two REMAINING views, never the invoking
//                                 one, so the same view can't appear twice
//                                 (which would collide on the singleton
//                                 timelineZoom / selectedListId state)
//
// v17.5.0 correction: the original step 1 was a bare "Add to split view"
// confirm. Opening the popup IS the intent — re-confirming it just added a tap
// to every single use, so the gesture now lands straight on the direction
// choice. The Cancel button went with it: the scrim click already closes, and
// Esc closes too (handled in useKeyboardShortcuts' chain, above every other
// branch — this sits at z=300, over everything).
//
// Shell is QuickStatusPopup's, deliberately: same body portal, same z=300
// scrim, same tokens, radius, min/max width and 44px buttons. Long-press
// opening a centred card is already a gesture staff know from the timeline —
// this should feel like the same thing, not a new dialect.
//
// The body portal is load-bearing for the same reason it is there: a
// position:fixed scrim mounted inside a transformed ancestor resolves against
// that ancestor, not the viewport.

import { useState } from "react";
import { createPortal } from "react-dom";
import { S, R, T, FW, IC } from "../lib/constants";
import { useArmAfterRelease } from "../hooks/useArmAfterRelease";
import { mkBtn } from "./atoms";
import { SplitSideIcon, SplitStackIcon } from "./Icons";

const LABEL = { timeline: "Timeline", list: "List", plan: "Plan" };
const ORDER = ["timeline", "list", "plan"];

// v17.11.0: `sideBySideOk` — is the shell wide enough that a Timeline would get
// a usable pane side by side? (App owns the arithmetic; see MIN_TL_PANE there.)
// When it is false the menu does not silently drop the option, it shows it
// refused with the reason: a control that vanishes teaches nothing, and the
// answer here depends on a setting the user can change.
export function SplitMenu({ view, onConfirm, onClose, sideBySideOk = true }) {
  const [step, setStep] = useState(1);   // 1 = direction, 2 = second view
  const [dir, setDir] = useState(null);
  // v17.16.12: opened by a 450ms press-and-hold on a view button, as a centred
  // card — so the finger that opened it is on the card, and its release would
  // otherwise pick a direction or dismiss the menu. Inert until that release.
  // Same defect and same fix as QuickStatusPopup, which this shell is copied
  // from; the two share the mechanism rather than each carrying a copy of it.
  const armed = useArmAfterRelease();
  if (!view) return null;

  const others = ORDER.filter((v) => v !== view);
  const title = step === 1 ? "How should it split?" : "Which view goes alongside?";
  const sub = step === 1 ? LABEL[view] + " plus one more." : LABEL[view] + " and…";
  // A Timeline halved horizontally can show the whole day or readable blocks,
  // never both. Refused at whichever step the Timeline actually appears: step 1
  // when it is the view you opened the menu on, step 2 when it would be the
  // partner you are choosing.
  const noSide = !sideBySideOk && view === "timeline";
  const tlBlocked = (v) => !sideBySideOk && dir === "v" && v === "timeline";
  const showWhy = noSide || (step === 2 && others.some(tlBlocked));

  const row = { display: "flex", gap: 8, flexWrap: "wrap" };
  const btn = (extra) => mkBtn(Object.assign({ minHeight: 44, padding: "10px 16px", flex: "1 1 auto" }, extra));
  // v17.8.0: the direction buttons carry a glyph now, so they lay out as a row.
  const dirBtn = (extra) => btn(Object.assign({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }, extra));

  return createPortal(
    <div
      onClick={() => { if (armed) onClose(); }}
      className="mgt-scrim-in"
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--tl-popup-scrim)",
        WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none"
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mgt-card-in"
        style={{
          background: "var(--tl-popup-bg)", borderRadius: R.sheet,
          border: "1px solid " + S.border,
          boxShadow: "var(--shadow-popover)",
          padding: "18px 24px",
          minWidth: 240, maxWidth: 320, zIndex: 301,
        }}
      >
        <div style={{ fontSize: T.title, fontWeight: FW.bold, color: S.text, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: T.body, color: "var(--text-faint)", marginBottom: 14 }}>{sub}</div>

        {step === 1 ? (
          <div style={row}>
            <button className={noSide ? "mgt-nopress" : "mgt-hover-scale"} disabled={noSide}
              style={dirBtn({ background: "var(--app-btn-grey)", ...(noSide ? { opacity: 0.45, cursor: "default" } : null) })}
              onClick={() => { if (armed && !noSide) { setDir("v"); setStep(2); } }}><SplitSideIcon size={IC.chrome} />Side by side</button>
            <button className="mgt-hover-scale" style={dirBtn({ background: "var(--app-btn-grey)" })}
              onClick={() => { if (armed) { setDir("h"); setStep(2); } }}><SplitStackIcon size={IC.chrome} />Top and bottom</button>
          </div>
        ) : (
          <div style={row}>
            {others.map((v) => (
              <button key={v} className={tlBlocked(v) ? "mgt-nopress" : "mgt-hover-scale"} disabled={tlBlocked(v)}
                style={btn({ background: S.accent, ...(tlBlocked(v) ? { opacity: 0.45, cursor: "default" } : null) })}
                onClick={() => { if (armed && !tlBlocked(v)) onConfirm({ a: view, b: v, dir: dir, ratio: 0.5 }); }}>{LABEL[v]}</button>
            ))}
          </div>
        )}

        {showWhy ? (
          <div style={{ fontSize: T.small, color: "var(--warn-text)", marginTop: 10 }}>
            This screen is too narrow to put the timeline beside another view — it
            would show about two hours of the day. Top and bottom keeps its full
            width. (Settings → App width.)
          </div>
        ) : null}

        <div style={{ fontSize: T.small, color: "var(--text-faint)", marginTop: 12, textAlign: "center" }}>
          tap outside or press Esc to close
        </div>
      </div>
    </div>,
    document.body
  );
}
