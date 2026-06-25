// src/components/whatsapp/ConversationRow.jsx
// One row in the conversation list: unread dot, customer display name (resolved
// from bookings by phone, else the number), an intent/draft/accepted tag, the
// relative time, and the last-message snippet. Archived rows render dimmed.

import { useState, useRef, useEffect } from "react";
import { matchCustomerByPhone, formatPhone, formatRelativeTime } from "../../lib/whatsapp";

export function ConversationRow({ conv, active, onClick, bookings }) {
  const match = matchCustomerByPhone(conv.phoneKey, bookings);
  const displayName = match ? match.name : (conv.phone || conv.phoneKey);
  const phoneLine = match ? formatPhone(conv.phone || conv.phoneKey) : null;
  const hasDraft = conv.draftStatus === "parsed" && conv.draftData;
  const hasAccepted = conv.draftStatus === "accepted";
  const intent = (conv.draftData && conv.draftData.intent) || null;

  let tagEl = null;
  if (intent === "cancel") tagEl = <span title="Cancellation request" style={{ fontSize: 12, marginLeft: 6, color: "var(--danger-text)", fontWeight: 700 }}>⚠</span>;
  else if (intent === "modify") tagEl = <span title="Modification request" style={{ fontSize: 12, marginLeft: 6, color: "var(--warn-text)", fontWeight: 700 }}>✎</span>;
  else if (hasDraft) tagEl = <span title="Draft booking parsed" style={{ fontSize: 12, marginLeft: 6 }}>📋</span>;
  else if (hasAccepted) tagEl = <span title="Booking confirmed" style={{ fontSize: 12, marginLeft: 6, color: "var(--success-text)", fontWeight: 700 }}>✓</span>;

  const archivedDimming = conv.archived ? 0.65 : 1;
  const bg = active ? "var(--wa-row-active-bg)" : "var(--wa-row-bg)";
  const bgHover = active ? "var(--wa-row-active-bg)" : "var(--wa-row-bg-hover)";
  const border = active ? "2px solid var(--wa-row-active-border)" : "1px solid var(--wa-bubble-in-border)";
  const [hover, setHover] = useState(false);
  const rowRef = useRef(null);
  // InboxPanel's ↑/↓ keyboard nav can move the selection to an off-screen row —
  // bring it into view. `block:"nearest"` is a no-op when the row is already
  // visible, so mouse clicks and the initial mount never cause surprise scroll.
  useEffect(() => {
    if (active && rowRef.current) rowRef.current.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={rowRef}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ cursor: "pointer", padding: "12px 14px", borderRadius: 12, background: hover && !active ? bgHover : bg, border, marginBottom: 6, transition: "background 0.12s", boxShadow: active ? "0 2px 8px rgba(0,122,255,0.12)" : "0 1px 3px rgba(0,0,0,0.04)", opacity: archivedDimming }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
          {conv.unread
            ? <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--wa-unread-dot)", flexShrink: 0, boxShadow: "0 0 0 1px rgba(220,38,38,0.25)" }} />
            : <span style={{ width: 8, height: 8, borderRadius: 4, background: "transparent", border: "1px solid var(--wa-bubble-in-border)", flexShrink: 0, boxSizing: "border-box" }} />}
          <span style={{ fontSize: 14, fontWeight: conv.unread ? 700 : 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
          {tagEl}
          {conv.archived ? <span title="Archived" style={{ fontSize: 11, marginLeft: 4 }}>📦</span> : null}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, fontWeight: 500 }}>{formatRelativeTime(conv.lastMessageAt)}</span>
      </div>
      {phoneLine ? <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3, marginLeft: 14 }}>{phoneLine}</div> : null}
      <div style={{ fontSize: 13, color: conv.unread ? "var(--text-primary)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 14, fontWeight: conv.unread ? 500 : 400 }}>{conv.lastMessageSnippet || ""}</div>
    </div>
  );
}
