// src/components/whatsapp/ConversationView.jsx
// Right pane: header (name + WA badge + Regular chip + window state + archive/
// restore/delete), an optional LinkedBookingCard, an optional IntentBanner, the
// scrolling message thread, the DraftCard, and the ReplyComposer. The composer
// is disabled when the 24h service window has expired.

import { useState, useRef, useEffect } from "react";
import { matchCustomerByPhone, formatPhone, formatWindow, intentBannerVisible } from "../../lib/whatsapp";
import { Reveal } from "../atoms";
import { MessageBubble } from "./MessageBubble";
import { DraftCard } from "./DraftCard";
import { ReplyComposer } from "./ReplyComposer";
import { LinkedBookingCard } from "./LinkedBookingCard";
import { IntentBanner } from "./IntentBanner";

export function ConversationView({
  conv, messages, onBack, onSend, onAccept, onDismiss, templates, bookings, showBack,
  onArchive, onUnarchive, onDelete, onCancelLinkedBooking, onOpenLinkedBooking,
  onDismissAcceptedBadge, onMarkIntentHandled, onResend, onApplyModify, compact,
}) {
  // Pass acceptedBookingId so the linked booking is excluded from the regular count.
  const match = matchCustomerByPhone(conv.phoneKey, bookings, conv.acceptedBookingId);
  const displayName = match ? match.name : (conv.phone || conv.phoneKey);
  const phoneDisplay = formatPhone(conv.phone || conv.phoneKey);
  const [histOpen, setHistOpen] = useState(false);
  const win = formatWindow(conv.windowExpiresAt);
  const threadRef = useRef(null);
  const msgsForConv = messages || [];
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [msgsForConv.length, conv.phoneKey]);

  // Bubble entrance: animate ONLY a genuinely new message that arrives while the
  // conversation is open — never on a conversation switch/open (the prior
  // index-based "last bubble always animates" looked wrong when switching).
  const [animateId, setAnimateId] = useState(null);
  const prevConvRef = useRef(conv.phoneKey);
  const lastId = msgsForConv.length ? msgsForConv[msgsForConv.length - 1].id : null;
  const prevLastIdRef = useRef(lastId);
  useEffect(() => {
    if (prevConvRef.current !== conv.phoneKey) {
      prevConvRef.current = conv.phoneKey;     // switched threads — reset baseline, no animation
      prevLastIdRef.current = lastId;
      setAnimateId(null);
      return;
    }
    if (lastId && lastId !== prevLastIdRef.current) {
      prevLastIdRef.current = lastId;
      setAnimateId(lastId);                     // a new message landed in the open thread
    }
  }, [conv.phoneKey, msgsForConv.length]);

  const linkedBooking = conv.acceptedBookingId ? bookings.find((b) => b.id === conv.acceptedBookingId) : null;
  const intent = (conv.draftData && conv.draftData.intent) || null;

  // "Booking confirmed" header chip — non-dismissable (the big DraftCard banner
  // is the dismissable element instead).
  const acceptedBadge = conv.draftStatus === "accepted"
    ? <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8, background: "var(--wa-accept-bg)", color: "var(--wa-accept-text)", border: "1px solid var(--wa-accept-border)" }}>✓ Booking confirmed</span>
    : null;
  // Regular chip — only when the customer has ≥1 completed booking that isn't the
  // currently linked one.
  const regularChip = match && match.regularCount >= 1
    ? <button className="mgt-hover-scale mgt-press" onClick={() => setHistOpen(!histOpen)} style={{ background: "var(--wa-teal-bg)", border: "1px solid var(--wa-teal-border)", borderRadius: 10, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "var(--wa-teal-text)", cursor: "pointer" }}>{"Regular · " + match.regularCount + " past visit" + (match.regularCount !== 1 ? "s" : "") + (histOpen ? " ▾" : " ▸")}</button>
    : null;
  // Body rendered whenever the customer has past visits; Reveal (below) eases it
  // open/closed off histOpen so the disclosure doesn't snap.
  const hasRegulars = !!(match && match.regularCount >= 1);
  const pastListBody = hasRegulars ? (
    <div style={{ padding: "8px 12px", background: "var(--wa-teal-bg)", border: "1px solid var(--wa-teal-border)", borderRadius: 10, marginBottom: 10, fontSize: 12, color: "var(--text-primary)" }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--wa-teal-text)" }}>Past bookings</div>
      {match.regularBookings.slice(0, 5).map((b) => (
        <div key={b.id} style={{ padding: "3px 0", borderTop: "1px solid var(--wa-teal-border)" }}>{(b.date || "?") + " · " + b.time + " · " + b.size + " pax · " + b.status}</div>
      ))}
    </div>
  ) : null;
  const windowEl = win
    ? <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 8, background: win.expired ? "var(--danger-bg)" : "var(--suggest-bg)", color: win.expired ? "var(--danger-text)" : "var(--success-text)", border: "1px solid " + (win.expired ? "var(--danger-border)" : "var(--suggest-border)") }}>{win.label}</span>
    : null;

  let headerActionBtns;
  if (conv.archived) {
    headerActionBtns = (
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button onClick={() => { if (onUnarchive) onUnarchive(conv.phoneKey); }} title="Restore conversation" className="mgt-hover-scale mgt-press" style={{ background: "var(--wa-btn-handled)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "var(--text-on-accent)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>↺ Restore</button>
        <button onClick={() => { if (onDelete) onDelete(conv.phoneKey); }} title="Delete conversation" className="mgt-hover-scale mgt-press" style={{ background: "var(--wa-btn-cancel)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "var(--text-on-accent)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>🗑 Delete</button>
      </div>
    );
  } else {
    headerActionBtns = (
      <button onClick={() => { if (onArchive) onArchive(conv.phoneKey); }} title="Archive conversation" className="mgt-hover-scale mgt-press" style={{ background: "var(--btn-default)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "var(--text-on-accent)", flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>📦 Archive</button>
    );
  }
  const disabled = !!(win && win.expired);

  // Intent banner gating: hidden once handled, until a newer INBOUND message
  // arrives (lastInboundAt — a staff reply must not resurrect it). Shared rule
  // in lib/whatsapp.js, also used by useWhatsApp.autoHandleCancelIntent.
  const showIntentBanner = intentBannerVisible(conv);
  // Mirrors DraftCard's "renders something" decision so the Reveal wrapper can
  // ease the card in (after parsing) and out — DraftCard still owns the actual
  // content for each state.
  const draftCardShows = conv.draftStatus === "accepted"
    ? !conv.acceptedBadgeDismissedAt
    : conv.draftStatus === "dismissed"
      ? true
      : !!(conv.draftData && (conv.draftData.intent || "new_booking") === "new_booking");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0, background: "var(--wa-list-bg)" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--wa-divider)", background: "var(--wa-header-bg)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          {showBack ? <button onClick={onBack} className="mgt-hover-scale mgt-press" style={{ background: "var(--btn-default)", border: "1px solid var(--border-glass)", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "var(--text-on-accent)", minHeight: 36, minWidth: 36 }} title="Back">‹</button> : null}
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: "var(--wa-green)", color: "var(--text-on-accent)", flexShrink: 0 }}>WA</span>
          {headerActionBtns}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "-apple-system, BlinkMacSystemFont, monospace" }}>{phoneDisplay}</span>
          {regularChip}
          {acceptedBadge}
          {conv.archived ? <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 8, background: "var(--bg-soft)", color: "var(--text-muted)", border: "1px solid var(--border-soft)" }}>📦 Archived</span> : null}
          {windowEl}
        </div>
      </div>
      <Reveal show={histOpen && hasRegulars} style={{ padding: "0 14px" }}><div style={{ paddingTop: 8 }}>{pastListBody}</div></Reveal>
      {linkedBooking ? (
        <div style={{ padding: "8px 14px 0" }}>
          <LinkedBookingCard booking={linkedBooking} phoneKey={conv.phoneKey} defaultCollapsed={!(intent === "cancel" || intent === "modify")} onOpen={() => { if (onOpenLinkedBooking) onOpenLinkedBooking(conv); }} onCancel={() => { if (onCancelLinkedBooking) onCancelLinkedBooking(conv); }} />
        </div>
      ) : null}
      {showIntentBanner ? (
        <div style={{ padding: "0 14px" }}>
          {/* key=phoneKey: the fade's `leaving` state must die with the conversation —
              without it, switching threads mid-fade leaves the next banner invisible */}
          <IntentBanner key={conv.phoneKey} intent={intent} linkedBooking={linkedBooking} phoneKey={conv.phoneKey} draftData={conv.draftData} onMarkHandled={() => { if (onMarkIntentHandled) onMarkIntentHandled(conv.phoneKey); }} onApplyChanges={() => { if (onApplyModify) onApplyModify(conv); }} />
        </div>
      ) : null}
      <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
        {msgsForConv.map((m) => <MessageBubble key={m.id} msg={m} isLast={m.id === animateId} onRetry={onResend} />)}
      </div>
      {/* Parsing/typing indicator — eased in while the inbound is being parsed
          (conv.parsing, set by the sandbox inbound path; cleared when the draft
          lands). The real DraftCard Reveals in as this Reveals out. */}
      <Reveal show={!!conv.parsing} style={{ padding: "0 14px" }}>
        <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 14, background: "var(--wa-draft-bg)", border: "2px solid var(--wa-draft-border)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>📋</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--wa-draft-text)", marginBottom: 6 }}>Reading the message…</div>
            <div className="mgt-shimmer" style={{ height: 8, borderRadius: 4, background: "var(--wa-draft-border)" }} />
          </div>
        </div>
      </Reveal>
      <Reveal show={draftCardShows} style={{ padding: "0 14px" }}>
        <DraftCard conv={conv} onAccept={onAccept} onDismiss={onDismiss} onDismissAcceptedBadge={onDismissAcceptedBadge} compact={compact} />
      </Reveal>
      <ReplyComposer onSend={onSend} disabled={disabled} templates={templates} convLang={conv.language} compact={compact} />
    </div>
  );
}
