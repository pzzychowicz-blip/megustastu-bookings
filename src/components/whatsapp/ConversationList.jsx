// src/components/whatsapp/ConversationList.jsx
// Left pane: filters conversations by the active tab (inbox vs archived) and
// sorts them — archived by archivedAt desc, inbox by lastMessageAt desc.

import { useRef } from "react";
import { sortConversations, conversationOrder } from "../../lib/whatsapp";
import { useFlip, Reveal } from "../atoms";
import { useRevealRows } from "../../hooks/useRevealRows";
import { ConversationRow } from "./ConversationRow";

// Per-row collapse speed. 365 = the house 280ms Reveal + 30% (Patryk, on the
// "Needs action" toggle reading as a snap in the Inbox tab where it removes many
// rows at once). ROW_PRUNE_MS scales the useRevealRows prune window by the same
// factor — it MUST stay above ROW_MS or a departing row is unmounted mid-collapse
// and vanishes, which is the exact behaviour this replaces.
const ROW_MS = 365;
const ROW_PRUNE_MS = Math.round((350 / 280) * ROW_MS); // 456

export function ConversationList({ conversations, activeKey, onSelect, bookings, archivedView, emptyLabel, selectMode, selected, onToggleSelect }) {
  // Shared with InboxPanel's keyboard-nav so the rendered order and the ↑/↓
  // order are guaranteed identical (see lib/whatsapp.js → sortConversations).
  const sorted = sortConversations(conversations, archivedView);

  // ── Rows ease out instead of disappearing ───────────────────────────────────
  // Toggling "Needs action" (or typing in the search box, or archiving a thread)
  // used to drop rows from the DOM instantly: the survivors slid up via FLIP,
  // but the removed rows just blinked out, which read as a jump whenever more
  // than one or two went at once. Now every row lives in a <Reveal>, so a
  // departing row collapses its own height and the rows below follow it up —
  // the "stack of cards" fold, identical in both tabs because it is one code
  // path with no per-tab branch.
  const { renderIds, openIds } = useRevealRows(sorted.map((c) => c.phoneKey), ROW_PRUNE_MS);
  // A departing row is no longer in `conversations`, so its object has to come
  // from somewhere: cache every conversation we have rendered, keyed by
  // phoneKey. Bounded by the number of conversations that have been on screen,
  // and refreshed each render so a still-visible row never shows stale data.
  const cache = useRef({});
  sorted.forEach((c) => { cache.current[c.phoneKey] = c; });
  // Sort the UNION (visible + still-collapsing) with the shared comparator, NOT
  // sortConversations: its tab filter would drop a row that departed *because*
  // it was archived, and that row would vanish instead of easing out — the very
  // case this is here to animate.
  const rows = renderIds
    .map((id) => cache.current[id])
    .filter(Boolean)
    .sort(conversationOrder(archivedView));

  // FLIP: when a new message bumps a conversation to the top, the rows ease to
  // their new spots instead of jumping. Keyed on the rendered order signature so
  // it fires only on a reorder/add/remove — not on every unrelated re-render.
  // It composes with the collapse rather than fighting it: on a filter change
  // the union order is unchanged (so FLIP no-ops and the heights do the work),
  // and a newcomer mounts at zero height (so FLIP measures no movement and the
  // expansion does it instead).
  const orderSig = rows.map((c) => c.phoneKey).join("|");
  const flipRef = useFlip([orderSig]);
  if (!rows.length) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
        {emptyLabel || (archivedView ? "No archived conversations." : "No conversations yet.")}
      </div>
    );
  }
  return (
    <div ref={flipRef} style={{ padding: "10px 10px 20px", height: "100%", overflowY: "auto", boxSizing: "border-box" }}>
      {rows.map((c) => (
        <Reveal key={c.phoneKey} show={openIds.has(c.phoneKey)} ms={ROW_MS}>
          <ConversationRow
            flipId={c.phoneKey}
            conv={c}
            active={c.phoneKey === activeKey}
            onClick={() => (selectMode ? onToggleSelect(c.phoneKey) : onSelect(c.phoneKey))}
            bookings={bookings}
            selectMode={selectMode}
            checked={!!(selected && selected.has(c.phoneKey))}
          />
        </Reveal>
      ))}
    </div>
  );
}
