// src/components/whatsapp/ConversationList.jsx
// Left pane: filters conversations by the active tab (inbox vs archived) and
// sorts them — archived by archivedAt desc, inbox by lastMessageAt desc.

import { useRef, useEffect } from "react";
import { sortConversations, conversationOrder } from "../../lib/whatsapp";
import { useFlip, Reveal } from "../atoms";
import { useRevealRows } from "../../hooks/useRevealRows";
import { ConversationRow } from "./ConversationRow";
import { T } from "../../lib/constants";

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
  //
  // ASYMMETRIC on purpose (`instantIn`): only the way OUT folds. A returning row
  // appears at full height straight away and the rows below slide down to it via
  // the FLIP below. Easing it open as well meant two motions stacked on one row —
  // the row growing AND the rows under it travelling — which read as too much
  // movement for what is just a filter toggle.
  const { renderIds, openIds } = useRevealRows(sorted.map((c) => c.phoneKey), ROW_PRUNE_MS, true);
  // A departing row is no longer in `conversations`, so its object has to come
  // from somewhere: cache every conversation we have rendered, keyed by
  // phoneKey. Bounded by the number of conversations that have been on screen.
  //
  // Filled in a dep-less EFFECT, not during render — the house pattern, per
  // CLAUDE.md on useKeyboardShortcuts: "the hook refreshes a ref from it in a
  // dep-less effect (lint-clean vs the old in-render write)". It still holds
  // what is needed when it is needed: a row only falls back to the cache on the
  // render where it has just LEFT `sorted`, and the previous COMMITTED render's
  // effect already stored it.
  const cache = useRef({});
  useEffect(() => { sorted.forEach((c) => { cache.current[c.phoneKey] = c; }); });
  // Live data wins over the cache for anything still visible, so a row on
  // screen can never paint from a stale copy.
  const live = {};
  sorted.forEach((c) => { live[c.phoneKey] = c; });
  // Sort the UNION (visible + still-collapsing) with the shared comparator, NOT
  // sortConversations: its tab filter would drop a row that departed *because*
  // it was archived, and that row would vanish instead of easing out — the very
  // case this is here to animate.
  const rows = renderIds
    .map((id) => live[id] || cache.current[id])
    .filter(Boolean)
    .sort(conversationOrder(archivedView));

  // FLIP: when a new message bumps a conversation to the top, the rows ease to
  // their new spots instead of jumping. Keyed on the rendered order signature so
  // it fires only on a reorder/add/remove — not on every unrelated re-render.
  // It composes with the collapse rather than fighting it, and the two directions
  // divide the work cleanly: on the way OUT the shrinking heights carry the rows
  // below and FLIP stays silent; on the way IN the row is there at full height
  // immediately, so FLIP is the ONLY thing that animates — the rows below slide
  // down into their new spots.
  //
  // The quiet predicate is what keeps the OUT direction silent, and it is not
  // optional. FLIP's stored tops last refreshed before the collapse began; the
  // rows then eased upward under a CSS height transition, which React never
  // re-rendered through. So at the prune — the next commit that changes the order
  // signature — FLIP would measure the entire collapse as one unseen jump and
  // replay it: a second slide starting ~90ms after the fold visibly finished,
  // repeating its last stage. Going quiet whenever a row is, or has just been,
  // collapsing resyncs the tops instead.
  //
  // `wasCollapsing` is written in a plain effect, so during the PRUNE commit's
  // layout effect it still holds the previous render's answer (true) — which is
  // exactly the question being asked. A genuine reorder landing inside that window
  // loses its FLIP for one pass; a new message arriving during a 365ms fold is
  // rare enough to accept.
  const collapsing = renderIds.some((id) => !live[id]);
  const wasCollapsing = useRef(false);
  useEffect(() => { wasCollapsing.current = collapsing; });
  const orderSig = rows.map((c) => c.phoneKey).join("|");
  const flipRef = useFlip([orderSig], () => collapsing || wasCollapsing.current);
  if (!rows.length) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: T.lead }}>
        {emptyLabel || (archivedView ? "No archived conversations." : "No conversations yet.")}
      </div>
    );
  }
  return (
    <div ref={flipRef} style={{ padding: "10px 10px 20px", height: "100%", overflowY: "auto", boxSizing: "border-box" }}>
      {/* A collapsing row stays mounted for the whole prune window, so it is
          made inert: without this you can click a row on its way out and select
          a conversation no longer in this tab, which the leaves-the-tab effect
          then immediately clears — the click reads as the app ignoring it. */}
      {rows.map((c) => (
        <Reveal
          key={c.phoneKey}
          show={openIds.has(c.phoneKey)}
          ms={ROW_MS}
          style={openIds.has(c.phoneKey) ? undefined : { pointerEvents: "none" }}
        >
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
