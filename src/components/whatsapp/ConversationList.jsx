// src/components/whatsapp/ConversationList.jsx
// Left pane: filters conversations by the active tab (inbox vs archived) and
// sorts them — archived by archivedAt desc, inbox by lastMessageAt desc.

import { sortConversations } from "../../lib/whatsapp";
import { useFlip } from "../atoms";
import { ConversationRow } from "./ConversationRow";

export function ConversationList({ conversations, activeKey, onSelect, bookings, archivedView, emptyLabel, selectMode, selected, onToggleSelect }) {
  // Shared with InboxPanel's keyboard-nav so the rendered order and the ↑/↓
  // order are guaranteed identical (see lib/whatsapp.js → sortConversations).
  const sorted = sortConversations(conversations, archivedView);
  // FLIP: when a new message bumps a conversation to the top, the rows ease to
  // their new spots instead of jumping. Keyed on the rendered order signature so
  // it fires only on a reorder/add/remove — not on every unrelated re-render.
  const orderSig = sorted.map((c) => c.phoneKey).join("|");
  const flipRef = useFlip([orderSig]);
  if (!sorted.length) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
        {emptyLabel || (archivedView ? "No archived conversations." : "No conversations yet.")}
      </div>
    );
  }
  return (
    <div ref={flipRef} style={{ padding: "10px 10px 20px", height: "100%", overflowY: "auto", boxSizing: "border-box" }}>
      {sorted.map((c) => (
        <ConversationRow
          key={c.phoneKey}
          flipId={c.phoneKey}
          conv={c}
          active={c.phoneKey === activeKey}
          onClick={() => (selectMode ? onToggleSelect(c.phoneKey) : onSelect(c.phoneKey))}
          bookings={bookings}
          selectMode={selectMode}
          checked={!!(selected && selected.has(c.phoneKey))}
        />
      ))}
    </div>
  );
}
