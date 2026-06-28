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
import { Reveal } from "../atoms";
import { useCollapseState } from "../../hooks/useCollapseState";

export function IntentBanner({ intent, linkedBooking, phoneKey, draftData, onMarkHandled, onApplyChanges }) {
  const [collapsed, toggle] = useCollapseState(phoneKey, "intent", false);
  const [leaving, setLeaving] = useState(false); // fade-out in progress
  if (intent !== "cancel" && intent !== "modify") return null;
  const isCancel = intent === "cancel";
  const isModify = intent === "modify";
  // Parsed requested changes (modify) — same draftData the new-booking flow uses,
  // so the staff can apply them in one click (onApplyChanges).
  const reqParts = [];
  if (isModify && draftData) {
    if (draftData.size != null) reqParts.push(draftData.size + " pax");
    if (draftData.date) reqParts.push(draftData.date);
    if (draftData.time) reqParts.push(draftData.time);
    if (draftData.preference === "indoor" || draftData.preference === "outdoor") reqParts.push(draftData.preference === "indoor" ? "Indoor" : "Outdoor");
  }
  const showApply = isModify && linkedBooking && onApplyChanges && reqParts.length > 0;
  const bg = isCancel ? "var(--danger-bg)" : "var(--warn-bg)";
  const border = isCancel ? "2px solid var(--danger-border)" : "2px solid var(--warn-border)";
  const color = isCancel ? "var(--danger-text)" : "var(--warn-text)";
  const icon = isCancel ? "⚠" : "✎";
  const title = isCancel ? "Customer is requesting to cancel" : "Customer is requesting changes";
  const subtitle = linkedBooking ? ("Linked to: " + (linkedBooking.date || "?") + " · " + linkedBooking.time + " · " + linkedBooking.size + " pax") : "No linked booking found";

  // v15.8.2-wa-sandbox: action buttons moved up onto the header row (between the
  // title and the chevron) to reclaim the vertical space they took as their own
  // line. The button group stops click-propagation so pressing a button never
  // toggles the collapse; the chevron stays last and flexShrink:0 so the buttons
  // can't collide with it (they wrap under the title on narrow widths).
  const actionBtns = (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      {showApply ? (
        <button
          onClick={() => { if (onApplyChanges) onApplyChanges(); }}
          title="Open the booking pre-filled with the requested changes"
          className="mgt-hover-scale mgt-press"
          style={{ background: "var(--wa-btn-open)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--text-on-accent)", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", whiteSpace: "nowrap" }}
        >✎ Apply changes</button>
      ) : null}
      <button
        onClick={() => {
          if (leaving) return; // ignore re-clicks during the fade
          setLeaving(true);
          setTimeout(() => { if (onMarkHandled) onMarkHandled(); }, 300);
        }}
        title="Mark this request as handled"
        className="mgt-hover-scale mgt-press"
        style={{ background: "var(--wa-btn-handled)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", cursor: leaving ? "default" : "pointer", fontSize: 12, fontWeight: 700, color: "var(--text-on-accent)", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", whiteSpace: "nowrap" }}
      >✓ Mark as handled</button>
    </div>
  );

  // Unified header + Reveal body (the app's Collapsible pattern): the alert
  // header stays put and the details ease open/closed instead of the
  // collapsed-strip ⇄ full-card swap snapping the layout.
  return (
    <div style={{ padding: "10px 14px", borderRadius: 12, background: bg, border, marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", opacity: leaving ? 0 : 1, transition: "opacity 300ms ease" }}>
      <div onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        {actionBtns}
        <span style={{ fontSize: 14, color, fontWeight: 700, flexShrink: 0, display: "inline-block", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.18s ease" }}>▸</span>
      </div>
      <Reveal show={!collapsed}>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color, opacity: 0.85 }}>{subtitle}</div>
          {showApply ? <div style={{ fontSize: 12, color, fontWeight: 700, marginTop: 4 }}>{"Requested: " + reqParts.join(" · ")}</div> : null}
        </div>
      </Reveal>
    </div>
  );
}
