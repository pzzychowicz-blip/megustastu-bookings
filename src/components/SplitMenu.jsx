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
import { S } from "../lib/constants";
import { mkBtn } from "./atoms";

const LABEL = { timeline: "Timeline", list: "List", plan: "Plan" };
const ORDER = ["timeline", "list", "plan"];

export function SplitMenu({ view, onConfirm, onClose }) {
  const [step, setStep] = useState(1);   // 1 = direction, 2 = second view
  const [dir, setDir] = useState(null);
  if (!view) return null;

  const others = ORDER.filter((v) => v !== view);
  const title = step === 1 ? "How should it split?" : "Which view goes alongside?";
  const sub = step === 1 ? LABEL[view] + " plus one more." : LABEL[view] + " and…";

  const row = { display: "flex", gap: 8, flexWrap: "wrap" };
  const btn = (extra) => mkBtn(Object.assign({ minHeight: 44, padding: "10px 16px", flex: "1 1 auto" }, extra));

  return createPortal(
    <div
      onClick={onClose}
      className="mgt-scrim-in"
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--tl-popup-scrim)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mgt-card-in"
        style={{
          background: "var(--tl-popup-bg)", borderRadius: 20,
          border: "1px solid " + S.border,
          boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
          padding: "20px 24px",
          minWidth: 240, maxWidth: 320, zIndex: 301,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: S.text, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 14 }}>{sub}</div>

        {step === 1 ? (
          <div style={row}>
            <button className="mgt-hover-scale" style={btn({ background: "var(--app-btn-grey)" })}
              onClick={() => { setDir("v"); setStep(2); }}>◧ Side by side</button>
            <button className="mgt-hover-scale" style={btn({ background: "var(--app-btn-grey)" })}
              onClick={() => { setDir("h"); setStep(2); }}>⬓ Top and bottom</button>
          </div>
        ) : (
          <div style={row}>
            {others.map((v) => (
              <button key={v} className="mgt-hover-scale" style={btn({ background: S.accent })}
                onClick={() => onConfirm({ a: view, b: v, dir: dir, ratio: 0.5 })}>{LABEL[v]}</button>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 12, textAlign: "center" }}>
          tap outside or press Esc to close
        </div>
      </div>
    </div>,
    document.body
  );
}
