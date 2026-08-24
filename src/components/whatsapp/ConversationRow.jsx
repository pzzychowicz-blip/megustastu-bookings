// src/components/whatsapp/ConversationRow.jsx
// One row in the conversation list: unread dot, customer display name (resolved
// from bookings by phone, else the number), an intent/draft/accepted tag, the
// relative time, and the last-message snippet. Archived rows render dimmed.

import { useRef, useEffect } from "react";
import { matchCustomerByPhone, formatPhone, formatRelativeTime, isParsing, describeConversation } from "../../lib/whatsapp";
import { R, T, FW, IC } from "../../lib/constants";
import { OutlineChip } from "../atoms";
import { WarnIcon, PencilIcon, DraftIcon, ArchiveIcon } from "./WaIcons";
import { CheckIcon } from "../Icons";

export function ConversationRow({ conv, active, onClick, bookings, flipId, selectMode, checked, roving = false, departing = false }) {
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
  if (isParsing(conv)) tagEl = <OutlineChip title="Reading the message…" tone="neutral" className="mgt-shimmer" style={{ marginLeft: 6 }}>parsing…</OutlineChip>;
  else if (intent === "cancel") tagEl = <span title="Cancellation request" style={{ fontSize: T.body, marginLeft: 6, color: "var(--danger-text)", fontWeight: FW.semi, display: "inline-flex", alignItems: "center" }}><WarnIcon size={IC.inline} /></span>;
  else if (intent === "modify") tagEl = <span title="Modification request" style={{ fontSize: T.body, marginLeft: 6, color: "var(--warn-text)", fontWeight: FW.semi, display: "inline-flex", alignItems: "center" }}><PencilIcon size={IC.inline} /></span>;
  else if (hasDraft) tagEl = <span title="Draft booking parsed" style={{ marginLeft: 6, color: "var(--text-secondary)", display: "inline-flex", alignItems: "center" }}><DraftIcon size={IC.inline} /></span>;
  else if (hasAccepted) tagEl = <span title="Booking confirmed" style={{ marginLeft: 6, color: "var(--success-text)", display: "inline-flex", alignItems: "center" }}><CheckIcon size={IC.inline} /></span>;

  const archivedDimming = conv.archived ? 0.65 : 1;
  // In select mode the "active" highlight gives way to the checked highlight so
  // the row reads as selected, not opened.
  const selHi = selectMode && checked;
  const bg = selHi ? "var(--wa-row-active-bg)" : (active && !selectMode ? "var(--wa-row-active-bg)" : "var(--wa-row-bg)");
  const bgHover = bg === "var(--wa-row-active-bg)" ? "var(--wa-row-active-bg)" : "var(--wa-row-bg-hover)";
  const border = selHi ? "2px solid var(--wa-row-active-border)" : (active && !selectMode ? "2px solid var(--wa-row-active-border)" : "1px solid var(--wa-bubble-in-border)");
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
      /* 17.15.0-wa-sandbox — reachable and announced, on prod's ListView
         pattern (v17.12.0).

         `role="listitem"`, NOT `role="button"`: in select mode this row holds a
         checkbox, and a button's children are PRESENTATIONAL in ARIA, so the
         checked state — the only thing select mode is about — would stop being
         announced at exactly the moment it matters. The same trade prod refused
         on the booking card.

         ONE roving tab stop, anchored on `activeKey`, which is what the panel's
         own ↑/↓ already moves. That is the whole reconciliation: the arrows are
         not a second keyboard model competing with this one, they ARE the model
         — they move the selection, and the tab stop follows the selection.

         A DEPARTING row is never the tab stop and is never focusable. It is
         mounted only so its Reveal can finish collapsing, it already carries
         `pointerEvents: none` for the same reason, and a tab stop on a row on
         its way out is a stop that vanishes under the keyboard.

         Enter and Space match the row's own click. The `target ===
         currentTarget` guard keeps a key pressed on the nested checkbox from
         also firing the row — the keyboard twin of the pointer-events guard. */
      role="listitem"
      tabIndex={departing ? -1 : (roving ? 0 : -1)}
      aria-label={describeConversation(conv, { bookings })}
      aria-current={active && !selectMode ? "true" : undefined}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (onClick) onClick();
      }}
      /* The v17.12.0 scroll trap: the browser focuses an element on mousedown
         and scrolling it into view is PART of focusing, so the row moves out
         from under the finger between press and release. `preventDefault` is
         not available here — it would kill selection of the phone number the
         row prints — so the row focuses ITSELF with preventScroll, which makes
         the browser's own focusing steps a no-op with nothing left to scroll. */
      onMouseDown={(e) => {
        if (departing || e.target.closest("button")) return;
        e.currentTarget.focus({ preventScroll: true });
      }}
      // v17.9.1: .mgt-ac-row, the app's one tint-on-hover class for a CONTAINER
      // of controls (the hover LIFT is for the controls themselves). This row
      // hand-rolled the same effect with useState + onMouseEnter/onMouseLeave,
      // which re-rendered every row the pointer crossed. Both colours go in as
      // custom properties because the resting fill is set INLINE here and an
      // inline background beats a stylesheet rule — which is why the class reads
      // --row-bg / --row-bg-hover instead of declaring a background of its own.
      className="mgt-ac-row"
      style={{ "--row-bg": bg, "--row-bg-hover": bgHover, cursor: "pointer", padding: "12px 14px", borderRadius: R.card, border, marginBottom: 6, boxShadow: (selHi || (active && !selectMode)) ? "var(--wa-row-active-glow)" : "var(--shadow-soft)", opacity: archivedDimming, display: "flex", alignItems: "center", gap: 10 }}
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
          {conv.archived ? <span title="Archived" style={{ marginLeft: 4, color: "var(--text-muted)", display: "inline-flex", alignItems: "center" }}><ArchiveIcon size={IC.inline} /></span> : null}
        </div>
        <span style={{ fontSize: T.small, color: "var(--text-muted)", flexShrink: 0, fontWeight: FW.regular }}>{formatRelativeTime(conv.lastMessageAt)}</span>
      </div>
      {phoneLine ? <div style={{ fontSize: T.small, color: "var(--text-muted)", marginBottom: 2, marginLeft: 14 }}>{phoneLine}</div> : null}
      <div style={{ fontSize: T.body, color: conv.unread ? "var(--text-primary)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 14, fontWeight: conv.unread ? FW.medium : FW.regular }}>{conv.lastMessageSnippet || ""}</div>
      </div>
    </div>
  );
}
