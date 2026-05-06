// src/components/atoms.jsx
// Tiny UI primitives used across the app: modal Overlay, form Fld, Section
// container, status / table / small badges, Toggle switch, Kbd keycap, and
// AvailBanner. Plus the style-builder helpers mkInp / mkBtn.
//
// Phase B1 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// First file in the codebase using JSX syntax — proves the build pipeline
// handles JSX cleanly. Subsequent component extractions (B2–B5) follow this
// same modern style: JSX, destructured props, const/spread.
//
// Behaviour, output markup, and all inline styles are byte-identical to the
// original `RC()` versions in v14.1. No visual or behavioural changes.

import { useEffect, useRef } from "react";
import { BLOCK_BG, TBL, S } from "../lib/constants";
import { isIn } from "../lib/booking-logic";

// ── Style-builder helpers ─────────────────────────────────────────────────────
// Return inline-style objects. Used wherever an `<input>` or `<button>` needs
// the standard MGT look. mkBtn accepts an `extra` object that overrides any
// of the base properties.
export function mkInp() {
  return {
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,0.5)",
    border: "1px solid rgba(255,255,255,0.4)",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 16,
    color: S.text,
    fontWeight: 500,
    boxShadow: "inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"
  };
}

export function mkBtn(extra) {
  return {
    border: "1px solid rgba(255,255,255,0.3)",
    background: "rgba(120,130,150,0.55)",
    borderRadius: 12,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: 13,
    color: "#fff",
    fontWeight: 600,
    minHeight: 40,
    boxShadow: "0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.25)",
    letterSpacing: "0.01em",
    ...(extra || {})
  };
}

// ── Modal overlay (mobile = full-screen sheet, desktop = centered card) ──────
export function Overlay({ onClose, children }) {
  const mob = typeof window !== "undefined" && window.innerWidth < 600;
  const lockRef = useRef(false);

  useEffect(() => {
    if (!mob) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    lockRef.current = true;
    return () => {
      document.body.style.overflow = orig;
      lockRef.current = false;
    };
  }, [mob]);

  if (mob) {
    return (
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 200 }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(240,243,248,0.98)", overflowY: "scroll", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minHeight: "100%", padding: "16px 18px", paddingTop: "max(16px, env(safe-area-inset-top))", paddingBottom: "max(80px, calc(40px + env(safe-area-inset-bottom)))", boxSizing: "border-box" }}>
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 12 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "rgba(255,255,255,0.72)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: 20, border: "1px solid rgba(255,255,255,0.5)", padding: "24px", width: "100%", maxWidth: 580, maxHeight: "90dvh", overflowY: "auto", boxSizing: "border-box", boxShadow: "0 8px 40px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.8)" }}>
        {children}
      </div>
    </div>
  );
}

// ── Form field (label + child input) ─────────────────────────────────────────
export function Fld({ label, req, style, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...(style || {}) }}>
      <label style={{ fontSize: 13, color: "#4a5568", fontWeight: 600, letterSpacing: "0.01em" }}>
        {label}
        {req ? <span style={{ color: "#dc2626" }}>*</span> : null}
      </label>
      {children}
    </div>
  );
}

// ── Card-like content section ─────────────────────────────────────────────────
export function Section({ style, children }) {
  return (
    <div style={{
      background: "rgba(248,250,253,0.95)",
      border: "1px solid rgba(210,218,230,0.8)",
      borderRadius: 16,
      padding: "14px",
      marginBottom: 14,
      boxShadow: "0 2px 12px rgba(0,0,0,0.06), inset 0 1px 1px rgba(255,255,255,0.6)",
      ...(style || {})
    }}>
      {children}
    </div>
  );
}

// ── Status badge (colour-coded by booking status) ────────────────────────────
export function SBadge({ status }) {
  return (
    <span style={{
      fontSize: 12, padding: "4px 10px", borderRadius: 10,
      background: BLOCK_BG[status] || BLOCK_BG.confirmed,
      color: "#fff", border: "1px solid rgba(255,255,255,0.2)",
      fontWeight: 600, textTransform: "capitalize",
      display: "inline-block",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
    }}>
      {status}
    </span>
  );
}

// ── Table badge (id, indoor/outdoor coloured) ────────────────────────────────
export function TBadge({ id }) {
  const indoor = isIn(id);
  const t = indoor ? TBL.ind : TBL.out;
  return (
    <span style={{
      fontSize: 12, padding: "4px 10px", borderRadius: 10,
      background: t.bg, color: t.text,
      border: "1px solid " + t.border,
      fontWeight: 600, display: "inline-block",
      boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
    }}>
      {id}
    </span>
  );
}

// ── Generic small chip / inline tag ──────────────────────────────────────────
export function SmallTag({ label, style }) {
  return (
    <span style={{
      fontSize: 11, padding: "3px 8px", borderRadius: 8,
      fontWeight: 600, display: "inline-block",
      ...(style || {})
    }}>
      {label}
    </span>
  );
}

// ── iOS-style toggle switch ───────────────────────────────────────────────────
export function Toggle({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 48, height: 26, borderRadius: 13,
        border: "1px solid rgba(255,255,255,0.3)",
        cursor: "pointer",
        background: on ? "rgba(0,122,255,0.7)" : "rgba(180,180,190,0.4)",
        position: "relative", flexShrink: 0,
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.08)"
      }}
    >
      <div style={{
        position: "absolute",
        top: 3,
        left: on ? 24 : 3,
        width: 20, height: 20, borderRadius: 10,
        background: "#fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)"
      }} />
    </button>
  );
}

// ── Keyboard keycap (for shortcuts cheatsheet) ───────────────────────────────
export function Kbd({ k }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 6,
      background: "rgba(255,255,255,0.75)",
      border: "1px solid rgba(180,190,210,0.55)",
      fontFamily: "-apple-system, 'SF Mono', Menlo, monospace",
      fontSize: 12,
      fontWeight: 600,
      color: "#1a1d24",
      boxShadow: "0 1px 2px rgba(0,0,0,0.06), inset 0 -1px 0 rgba(0,0,0,0.08)",
      minWidth: 22,
      textAlign: "center",
      boxSizing: "border-box",
      lineHeight: "16px"
    }}>
      {k}
    </span>
  );
}

// ── Availability banner shown above booking form ─────────────────────────────
// Renders "no tables available" or warning states with optional time
// suggestions (clickable chips) for nearby alternative slots.
export function AvailBanner({ msg, sugg, style, onTapTime, warn }) {
  const message = msg || "No tables available.";
  const bgClr = warn ? "rgba(255,237,213,0.7)" : "rgba(254,226,226,0.7)";
  const brdClr = warn ? "rgba(253,186,116,0.55)" : "rgba(252,165,165,0.55)";
  const txtClr = warn ? "#9a3412" : "#991b1b";
  const hasEarlier = sugg && sugg.earlier && sugg.earlier.length > 0;
  const hasLater = sugg && sugg.later && sugg.later.length > 0;
  const hasSugg = hasEarlier || hasLater;

  function renderChips(arr) {
    if (!onTapTime) return arr.join(", ");
    return (
      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
        {arr.map((t) => (
          <span
            key={t}
            onClick={() => onTapTime(t)}
            style={{
              cursor: "pointer", padding: "3px 8px", borderRadius: 8,
              fontWeight: 600, fontSize: 12,
              background: "rgba(220,252,231,0.8)",
              color: "#166534",
              border: "1px solid rgba(134,239,172,0.5)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
            }}
          >
            {t}
          </span>
        ))}
      </span>
    );
  }

  return (
    <div style={{
      padding: "10px 14px",
      borderRadius: 14,
      border: "2px solid " + brdClr,
      background: bgClr,
      marginBottom: 14,
      fontSize: 13,
      color: txtClr,
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      ...(style || {})
    }}>
      <div style={{ fontWeight: 700, marginBottom: hasSugg ? 6 : 0 }}>{message}</div>
      {hasEarlier ? (
        <div style={{ marginBottom: hasLater ? 4 : 0 }}>
          <span style={{ fontWeight: 700 }}>Before: </span>
          {renderChips(sugg.earlier)}
        </div>
      ) : null}
      {hasLater ? (
        <div>
          <span style={{ fontWeight: 700 }}>After: </span>
          {renderChips(sugg.later)}
        </div>
      ) : null}
      {!hasSugg && sugg ? (
        <div style={{ marginTop: 4 }}>No availability found.</div>
      ) : null}
    </div>
  );
}
