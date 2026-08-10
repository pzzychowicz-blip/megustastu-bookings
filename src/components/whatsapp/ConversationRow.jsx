// src/components/whatsapp/ConversationRow.jsx
// One row in the conversation list: unread dot, customer display name (resolved
// from bookings by phone, else the number), an intent/draft/accepted tag, the
// relative time, and the last-message snippet. Archived rows render dimmed.

import { useState, useRef, useEffect } from "react";
import { matchCustomerByPhone, formatPhone, formatRelativeTime, isParsing } from "../../lib/whatsapp";
import { R, T, FW, M } from "../../lib/constants";

export function ConversationRow({ conv, active, onClick, bookings, flipId, selectMode, checked }) {
  const match = matchCustomerByPhone(conv.phoneKey, bookings);
  const displayName = match ? match.name : (conv.phone || conv.phoneKey);
  const phoneLine = match ? formatPhone(conv.phone || conv.phoneKey) : null;
  const hasDraft = conv.draftStatus === "parsed" && conv.draftData;
  const hasAccepted = conv.draftStatus === "accepted";
  const intent = (conv.draftData && conv.draftData.intent) || null;

  // Parsing/typing tag (sandbox inbound path) takes visual priority — the
  // message is mid-parse, so the intent/draft tag isn't known yet.
  let tagEl = null;
  // The ink is --text-secondary, not --accent: at 10px bold, accent-on-row
  // measures 4.02:1 light / 3.62 dark, under the 4.5 a small label needs.
  // Nothing is lost — the SHIMMER is what says "in progress", and the
  // accent was decorating a state the animation already announces.
  if (isParsing(conv)) tagEl = <span title="Reading the message…" className="mgt-shimmer" style={{ fontSize: T.micro, fontWeight: FW.semi, marginLeft: 6, padding: "1px 7px", borderRadius: R.pill, color: "var(--text-secondary)", border: "2px solid var(--wa-bubble-in-border)" }}>parsing…</span>;
  else if (intent === "cancel") tagEl = <span title="Cancellation request" style={{ fontSize: T.body, marginLeft: 6, color: "var(--danger-text)", fontWeight: FW.semi }}>⚠</span>;
  else if (intent === "modify") tagEl = <span title="Modification request" style={{ fontSize: T.body, marginLeft: 6, color: "var(--warn-text)", fontWeight: FW.semi }}>✎</span>;
  else if (hasDraft) tagEl = <span title="Draft booking parsed" style={{ fontSize: T.body, marginLeft: 6 }}>📋</span>;
  else if (hasAccepted) tagEl = <span title="Booking confirmed" style={{ fontSize: T.body, marginLeft: 6, color: "var(--success-text)", fontWeight: FW.semi }}>✓</span>;

  const archivedDimming = conv.archived ? 0.65 : 1;
  // In select mode the "active" highlight gives way to the checked highlight so
  // the row reads as selected, not opened.
  const selHi = selectMode && checked;
  const bg = selHi ? "var(--wa-row-active-bg)" : (active && !selectMode ? "var(--wa-row-active-bg)" : "var(--wa-row-bg)");
  const bgHover = bg === "var(--wa-row-active-bg)" ? "var(--wa-row-active-bg)" : "var(--wa-row-bg-hover)";
  const border = selHi ? "2px solid var(--wa-row-active-border)" : (active && !selectMode ? "2px solid var(--wa-row-active-border)" : "1px solid var(--wa-bubble-in-border)");
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
      data-flip-id={flipId}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ cursor: "pointer", padding: "12px 14px", borderRadius: R.card, background: hover ? bgHover : bg, border, marginBottom: 6, transition: "background " + M.tap, boxShadow: (selHi || (active && !selectMode)) ? "var(--wa-row-active-glow)" : "var(--shadow-soft)", opacity: archivedDimming, display: "flex", alignItems: "center", gap: 10 }}
    >
      {selectMode ? (
        <input
          type="checkbox"
          checked={!!checked}
          readOnly
          aria-label="Select conversation"
          style={{ flexShrink: 0, width: 18, height: 18, accentColor: "var(--accent)", pointerEvents: "none", cursor: "pointer" }}
        />
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
          {conv.unread
            ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--wa-unread-dot)", flexShrink: 0, boxShadow: "var(--wa-unread-ring)" }} />
            : <span style={{ width: 8, height: 8, borderRadius: "50%", background: "transparent", border: "1px solid var(--wa-bubble-in-border)", flexShrink: 0, boxSizing: "border-box" }} />}
          <span style={{ fontSize: T.lead, fontWeight: conv.unread ? FW.bold : FW.semi, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
          {tagEl}
          {conv.archived ? <span title="Archived" style={{ fontSize: T.small, marginLeft: 4 }}>📦</span> : null}
        </div>
        <span style={{ fontSize: T.small, color: "var(--text-muted)", flexShrink: 0, fontWeight: FW.regular }}>{formatRelativeTime(conv.lastMessageAt)}</span>
      </div>
      {phoneLine ? <div style={{ fontSize: T.small, color: "var(--text-muted)", marginBottom: 3, marginLeft: 14 }}>{phoneLine}</div> : null}
      <div style={{ fontSize: T.body, color: conv.unread ? "var(--text-primary)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 14, fontWeight: conv.unread ? FW.medium : FW.regular }}>{conv.lastMessageSnippet || ""}</div>
      </div>
    </div>
  );
}
