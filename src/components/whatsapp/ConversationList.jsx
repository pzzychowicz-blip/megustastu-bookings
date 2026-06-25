// src/components/whatsapp/ConversationList.jsx
// Left pane: filters conversations by the active tab (inbox vs archived) and
// sorts them — archived by archivedAt desc, inbox by lastMessageAt desc.

import { sortConversations } from "../../lib/whatsapp";
import { ConversationRow } from "./ConversationRow";

export function ConversationList({ conversations, activeKey, onSelect, bookings, archivedView }) {
  // Shared with InboxPanel's keyboard-nav so the rendered order and the ↑/↓
  // order are guaranteed identical (see lib/whatsapp.js → sortConversations).
  const sorted = sortConversations(conversations, archivedView);
  if (!sorted.length) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
        {archivedView ? "No archived conversations." : "No conversations yet."}
      </div>
    );
  }
  return (
    <div style={{ padding: "10px 10px 20px", height: "100%", overflowY: "auto", boxSizing: "border-box" }}>
      {sorted.map((c) => (
        <ConversationRow key={c.phoneKey} conv={c} active={c.phoneKey === activeKey} onClick={() => onSelect(c.phoneKey)} bookings={bookings} />
      ))}
    </div>
  );
}
