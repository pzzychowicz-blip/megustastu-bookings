// src/components/whatsapp/LinkedBookingCard.jsx
// Compact teal card shown in the conversation header when the conversation is
// linked to a booking (acceptedBookingId). Collapsible per-conversation; when
// collapsed it shrinks to a one-line strip. Holds the single source of truth for
// the two booking actions — Open booking (blue) and Cancel booking (red).

import { Reveal } from "../atoms";
import { useCollapseState } from "../../hooks/useCollapseState";
import { BLOCK_BG, R, T, FW, M } from "../../lib/constants";
import { LinkIcon } from "./WaIcons";

export function LinkedBookingCard({ booking, onOpen, onCancel, phoneKey, defaultCollapsed }) {
  const [collapsed, toggle] = useCollapseState(phoneKey, "linked", !!defaultCollapsed);
  if (!booking) return null;
  const statusColor = BLOCK_BG[booking.status] || BLOCK_BG.confirmed;
  const canCancel = booking.status !== "cancelled" && booking.status !== "completed";
  const summary = (booking.name || "(no name)") + " · " + (booking.date || "?") + " · " + booking.time + " · " + booking.size + " pax";

  // v15.8.2-wa-sandbox: the two booking actions moved up onto the header row
  // (before the chevron) instead of stacking vertically in the body, to reclaim
  // space. The group stops click-propagation so a button press never toggles the
  // collapse; the chevron stays last + flexShrink:0 so they can't collide.
  const actionBtns = (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      <button
        onClick={onOpen}
        className="mgt-hover-scale mgt-press"
        style={{ background: "var(--wa-btn-open)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: R.pill, padding: "8px 14px", minHeight: 36, cursor: "pointer", fontSize: T.body, fontWeight: FW.semi, color: "var(--text-on-accent)", boxShadow: "var(--shadow-btn)", whiteSpace: "nowrap" }}
      >Open booking</button>
      {/* Secondary = OUTLINE in its own hue. A solid red pill next to a solid
          blue one made the destructive action compete with the safe one for the
          eye, and on the quietened green pane the pair read as two primaries
          bolted onto a background. Red outline still says danger — the hue is
          intact, only the fill is gone — while "Open booking" keeps the single
          saturated fill the accent rule reserves for the primary action. */}
      {canCancel ? (
        <button
          onClick={onCancel}
          className="mgt-hover-scale mgt-press"
          style={{ background: "transparent", border: "2px solid var(--danger-border)", borderRadius: R.pill, padding: "8px 14px", minHeight: 36, cursor: "pointer", fontSize: T.body, fontWeight: FW.semi, color: "var(--danger-text)", whiteSpace: "nowrap" }}
        >Cancel booking</button>
      ) : null}
    </div>
  );

  // Unified header + Reveal body (the app's Collapsible pattern) so the
  // collapse/expand eases instead of the strip ⇄ card swap snapping.
  // v17.8.0-wa-sandbox: the notification-pane idiom, in the WAITLIST palette.
  // This card was the module's last teal surface — a 0.10-alpha teal wash in a
  // teal rim, a hue the booking app does not otherwise use, sitting one line
  // under a green "Past bookings" panel and a green "Booking confirmed" notice.
  // The --wa-teal-* family is deleted: teal was a fourth green nobody had
  // registered, and a token whose NAME disagrees with its value is exactly how
  // a surface stays outside its own family's audit.
  return (
    <div style={{ padding: "10px 12px", borderRadius: R.card, background: "var(--suggest-bg-soft)", border: "1px solid var(--border-card)", marginBottom: 8, boxShadow: "var(--shadow-soft)" }}>
      <div onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexWrap: "wrap" }}>
        <span style={{ fontSize: T.small, fontWeight: FW.semi, color: "var(--success-text)", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }}><LinkIcon size={13} />Linked booking</span>
        <span style={{ fontSize: T.micro, padding: "2px 8px", borderRadius: R.pill, background: statusColor, color: "var(--text-on-accent)", fontWeight: FW.bold, textTransform: "capitalize", flexShrink: 0 }}>{booking.status}</span>
        {collapsed ? <span style={{ fontSize: T.body, color: "var(--text-primary)", fontWeight: FW.regular, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span> : <span style={{ flex: 1 }} />}
        {actionBtns}
        <span style={{ fontSize: T.lead, color: "var(--success-text)", fontWeight: FW.semi, flexShrink: 0, display: "inline-block", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform " + M.tap }}>▸</span>
      </div>
      <Reveal show={!collapsed}>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: T.body, color: "var(--text-primary)", fontWeight: FW.semi, marginBottom: 2 }}>{booking.name || "(no name)"}</div>
          <div style={{ fontSize: T.body, color: "var(--text-muted)" }}>{(booking.date || "?") + " · " + booking.time + " · " + booking.size + " pax" + (booking.tables && booking.tables.length ? " · tables " + booking.tables.join(", ") : "")}</div>
        </div>
      </Reveal>
    </div>
  );
}
