// src/components/whatsapp/IntentBanner.jsx
// Alert banner above the thread when the latest message is classified cancel
// (red/danger) or modify (orange/warn). Alert-only — the booking actions live in
// LinkedBookingCard. Collapsible (defaults expanded, since it's an alert); the
// "✓ Mark as handled" button (teal) dismisses it until a new request arrives —
// with a 300ms fade (§7 decision 2026-06-13) so the dismissal reads as a
// deliberate action, not a glitch. The fade is click-local: the auto-handled
// path (cancelling the linked booking) unmounts the banner from the parent,
// which is fine — the conversation isn't on screen during that flow.

import { useState } from "react";
import { useCollapseState } from "../../hooks/useCollapseState";

export function IntentBanner({ intent, linkedBooking, phoneKey, onMarkHandled }) {
  const [collapsed, toggle] = useCollapseState(phoneKey, "intent", false);
  const [leaving, setLeaving] = useState(false); // fade-out in progress
  if (intent !== "cancel" && intent !== "modify") return null;
  const isCancel = intent === "cancel";
  const bg = isCancel ? "var(--danger-bg)" : "var(--warn-bg)";
  const border = isCancel ? "2px solid var(--danger-border)" : "2px solid var(--warn-border)";
  const color = isCancel ? "var(--danger-text)" : "var(--warn-text)";
  const icon = isCancel ? "⚠" : "✎";
  const title = isCancel ? "Customer is requesting to cancel" : "Customer is requesting changes";
  const subtitle = linkedBooking ? ("Linked to: " + (linkedBooking.date || "?") + " · " + linkedBooking.time + " · " + linkedBooking.size + " pax") : "No linked booking found";

  if (collapsed) {
    return (
      <div onClick={toggle} style={{ padding: "6px 12px", borderRadius: 10, background: bg, border: isCancel ? "1px solid var(--danger-border)" : "1px solid var(--warn-border)", marginBottom: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ fontSize: 13, color, fontWeight: 700, flexShrink: 0 }}>▸</span>
      </div>
    );
  }
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, background: bg, border, marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", display: "flex", gap: 10, alignItems: "flex-start", opacity: leaving ? 0 : 1, transition: "opacity 300ms ease" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, cursor: "pointer" }} onClick={toggle}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color, flex: 1, minWidth: 0 }}>{title}</span>
          <span style={{ fontSize: 14, color, fontWeight: 700, flexShrink: 0 }}>▾</span>
        </div>
        <div style={{ fontSize: 12, color, opacity: 0.85 }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, alignSelf: "center" }}>
        <button
          onClick={() => {
            if (leaving) return; // ignore re-clicks during the fade
            setLeaving(true);
            setTimeout(() => { if (onMarkHandled) onMarkHandled(); }, 300);
          }}
          title="Mark this request as handled"
          className="mgt-hover-scale"
          style={{ background: "var(--wa-btn-handled)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "7px 14px", cursor: leaving ? "default" : "pointer", fontSize: 12, fontWeight: 700, color: "var(--text-on-accent)", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", whiteSpace: "nowrap" }}
        >✓ Mark as handled</button>
      </div>
    </div>
  );
}
