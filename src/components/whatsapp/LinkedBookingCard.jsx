// src/components/whatsapp/LinkedBookingCard.jsx
// Compact teal card shown in the conversation header when the conversation is
// linked to a booking (acceptedBookingId). Collapsible per-conversation; when
// collapsed it shrinks to a one-line strip. Holds the single source of truth for
// the two booking actions — Open booking (blue) and Cancel booking (red).

import { Reveal } from "../atoms";
import { useCollapseState } from "../../hooks/useCollapseState";
import { BLOCK_BG } from "../../lib/constants";

export function LinkedBookingCard({ booking, onOpen, onCancel, phoneKey, defaultCollapsed }) {
  const [collapsed, toggle] = useCollapseState(phoneKey, "linked", !!defaultCollapsed);
  if (!booking) return null;
  const statusColor = BLOCK_BG[booking.status] || BLOCK_BG.confirmed;
  const canCancel = booking.status !== "cancelled" && booking.status !== "completed";
  const summary = (booking.name || "(no name)") + " · " + (booking.date || "?") + " · " + booking.time + " · " + booking.size + " pax";

  // Unified header + Reveal body (the app's Collapsible pattern) so the
  // collapse/expand eases instead of the strip ⇄ card swap snapping.
  return (
    <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--wa-teal-bg)", border: "1px solid var(--wa-teal-border)", marginBottom: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--wa-teal-text)", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>🔗 Linked booking</span>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: statusColor, color: "var(--text-on-accent)", fontWeight: 700, textTransform: "capitalize", flexShrink: 0 }}>{booking.status}</span>
        {collapsed ? <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span> : <span style={{ flex: 1 }} />}
        <span style={{ fontSize: 14, color: "var(--wa-teal-text)", fontWeight: 700, flexShrink: 0, display: "inline-block", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.18s ease" }}>▸</span>
      </div>
      <Reveal show={!collapsed}>
        <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600, marginBottom: 2 }}>{booking.name || "(no name)"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{(booking.date || "?") + " · " + booking.time + " · " + booking.size + " pax" + (booking.tables && booking.tables.length ? " · tables " + booking.tables.join(", ") : "")}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
            <button
              onClick={onOpen}
              className="mgt-hover-scale mgt-press"
              style={{ background: "var(--wa-btn-open)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--text-on-accent)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", whiteSpace: "nowrap" }}
            >Open booking</button>
            {canCancel ? (
              <button
                onClick={onCancel}
                className="mgt-hover-scale mgt-press"
                style={{ background: "var(--wa-btn-cancel)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--text-on-accent)", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", whiteSpace: "nowrap" }}
              >Cancel booking</button>
            ) : null}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
