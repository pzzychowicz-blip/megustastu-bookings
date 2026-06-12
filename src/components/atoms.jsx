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

import { useEffect, useRef, useState } from "react";
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
    background: "var(--bg-input)",
    border: "1px solid var(--border-input)",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 16,
    color: S.text,
    fontWeight: 500,
    boxShadow: "var(--shadow-input)"
  };
}

export function mkBtn(extra) {
  return {
    border: "1px solid var(--border-glass)",
    background: "var(--btn-default)",
    borderRadius: 12,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-on-accent)",
    fontWeight: 600,
    minHeight: 40,
    boxShadow: "var(--shadow-btn)",
    letterSpacing: "0.01em",
    ...(extra || {})
  };
}

// ── Modal overlay (mobile = full-screen sheet, desktop = centered card) ──────
// Optional `footer` (v14.4.1): when provided, the action buttons render PINNED
// to the modal bottom while `children` scroll above them — so Save/Cancel stay
// reachable on tall forms without scrolling to the end. When omitted, behaviour
// is byte-identical to before (one scroll region), keeping back-compat for
// read-only popups (e.g. HistoryPopup) that have no action row.
// Blur budget unchanged: exactly one card renders (ternary), so a footer modal
// is still scrim blur(8px) + card blur(20px) = 2 instances (≤4 rule holds).
export function Overlay({ onClose, children, footer }) {
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
    // Footer pinned to the viewport bottom; body scrolls between top and footer.
    // (minHeight:0 lets the flex body actually scroll instead of growing the column.)
    if (footer) {
      return (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, background: "var(--bg-sheet-mobile)", display: "flex", flexDirection: "column" }}>
          <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "scroll", WebkitOverflowScrolling: "touch", padding: "16px 18px", paddingTop: "max(16px, env(safe-area-inset-top))", boxSizing: "border-box" }}>
            {children}
          </div>
          <div style={{ flexShrink: 0, padding: "12px 18px", paddingBottom: "max(12px, env(safe-area-inset-bottom))", borderTop: "1px solid var(--border-sheet)", background: "var(--bg-sheet-mobile)", boxSizing: "border-box" }}>
            {footer}
          </div>
        </div>
      );
    }
    return (
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 200 }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "var(--bg-sheet-mobile)", overflowY: "scroll", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minHeight: "100%", padding: "16px 18px", paddingTop: "max(16px, env(safe-area-inset-top))", paddingBottom: "max(80px, calc(40px + env(safe-area-inset-bottom)))", boxSizing: "border-box" }}>
            {children}
          </div>
        </div>
      </div>
    );
  }

  // Desktop centered card. With a footer, the card is a flex column: body
  // scrolls (minHeight:0), footer stays pinned. Without, the whole card scrolls
  // (exactly as before).
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "var(--scrim)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 12 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {footer ? (
        <div style={{ background: "var(--bg-sheet)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: 20, border: "1px solid var(--border-sheet)", width: "100%", maxWidth: 580, maxHeight: "90dvh", display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box", boxShadow: "var(--shadow-sheet)" }}>
          <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "24px", boxSizing: "border-box" }}>
            {children}
          </div>
          <div style={{ flexShrink: 0, padding: "16px 24px", borderTop: "1px solid var(--border-sheet)", boxSizing: "border-box" }}>
            {footer}
          </div>
        </div>
      ) : (
        <div style={{ background: "var(--bg-sheet)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: 20, border: "1px solid var(--border-sheet)", padding: "24px", width: "100%", maxWidth: 580, maxHeight: "90dvh", overflowY: "auto", boxSizing: "border-box", boxShadow: "var(--shadow-sheet)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Form field (label + child input) ─────────────────────────────────────────
export function Fld({ label, req, style, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...(style || {}) }}>
      <label style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600, letterSpacing: "0.01em" }}>
        {label}
        {req ? <span style={{ color: "var(--text-required)" }}>*</span> : null}
      </label>
      {children}
    </div>
  );
}

// ── Card-like content section ─────────────────────────────────────────────────
export function Section({ style, children }) {
  return (
    <div style={{
      background: "var(--bg-soft)",
      border: "1px solid var(--border-soft)",
      borderRadius: 16,
      padding: "14px",
      marginBottom: 14,
      boxShadow: "var(--shadow-soft)",
      ...(style || {})
    }}>
      {children}
    </div>
  );
}

// ── Collapsible disclosure section (card header + expandable body) ────────────
// v15.0.0: a Section whose title row is a tap-to-toggle disclosure. Used to keep
// long Settings lists (opening hours, tables) compact — collapsed by default
// (`defaultOpen`), with an optional one-line `summary` shown on the right while
// collapsed so the section stays scannable without expanding. The `subtitle` only
// shows when open, keeping the collapsed header a single line. Uncontrolled (owns
// its open state) — settings disclosures don't need the state lifted to a parent.
//
// v15.1.0: optional CONTROLLED mode — pass a boolean `open` + `onToggle` and the
// parent owns the state (the internal useState is ignored). Needed by ListView's
// "Completed & cancelled" disclosure, whose open state must live in BookingApp so
// the List keyboard model (↑/↓ over listDaySorted) can exclude hidden cards.
// Omitting `open` keeps the original uncontrolled behaviour (all Settings call
// sites unchanged).
//
// No `.mgt-hover-scale` on the header: it's a full-width row and the Settings
// modal card is overflow:hidden, so a 1.08 scale would clip at the card edge.
// The rotating chevron + pointer cursor carry the affordance instead.
export function Collapsible({ title, subtitle, summary, defaultOpen = false, open: openProp, onToggle, children, style }) {
  const [openState, setOpen] = useState(defaultOpen === true);
  const controlled = typeof openProp === "boolean";
  const open = controlled ? openProp : openState;
  return (
    <Section style={{ marginBottom: 18, ...(style || {}) }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => { if (controlled) { if (onToggle) onToggle(!open); } else { setOpen((o) => !o); } }}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, background: "transparent", border: "none", padding: 0, margin: 0,
          cursor: "pointer", textAlign: "left", color: "inherit"
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
          {open && subtitle ? (
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>{subtitle}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {!open && summary ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{summary}</span>
          ) : null}
          <span style={{
            fontSize: 18, fontWeight: 700, color: "var(--text-muted)", lineHeight: 1,
            display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease"
          }}>›</span>
        </div>
      </button>
      {open ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </Section>
  );
}

// ── Status badge (colour-coded by booking status) ────────────────────────────
export function SBadge({ status }) {
  return (
    <span style={{
      fontSize: 12, padding: "4px 10px", borderRadius: 10,
      background: BLOCK_BG[status] || BLOCK_BG.confirmed,
      color: "var(--text-on-accent)", border: "1px solid rgba(255,255,255,0.2)",
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
      className="mgt-hover-scale"
      style={{
        width: 48, height: 26, borderRadius: 13,
        border: "1px solid var(--border-glass)",
        cursor: "pointer",
        background: on ? "var(--toggle-on)" : "var(--toggle-off)",
        position: "relative", flexShrink: 0,
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.08)"
      }}
    >
      <div style={{
        position: "absolute",
        top: 3,
        left: on ? 24 : 3,
        width: 20, height: 20, borderRadius: 10,
        background: "var(--text-on-accent)",
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
      background: "var(--bg-kbd)",
      border: "1px solid var(--border-kbd)",
      fontFamily: "-apple-system, 'SF Mono', Menlo, monospace",
      fontSize: 12,
      fontWeight: 600,
      color: "var(--text-primary)",
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
  const bgClr = warn ? "var(--warn-bg)" : "var(--danger-bg)";
  const brdClr = warn ? "var(--warn-border)" : "var(--danger-border)";
  const txtClr = warn ? "var(--warn-text)" : "var(--danger-text)";
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
            className="mgt-hover-scale"
            onClick={() => onTapTime(t)}
            style={{
              cursor: "pointer", padding: "3px 8px", borderRadius: 8,
              fontWeight: 600, fontSize: 12,
              background: "var(--suggest-bg)",
              color: "var(--success-text)",
              border: "1px solid var(--suggest-border)",
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
