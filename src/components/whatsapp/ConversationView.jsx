// src/components/whatsapp/ConversationView.jsx
// Right pane: header (name + WA badge + Regular chip + window state + archive/
// restore/delete), an optional LinkedBookingCard, an optional IntentBanner, the
// scrolling message thread, the DraftCard, and the ReplyComposer. The composer
// is disabled when the 24h service window has expired.

import { useState, useRef, useEffect } from "react";
import { matchCustomerByPhone, regularChipLabel, formatPhone, formatWindow, intentBannerVisible, isParsing, WA_ACCEPTED_BANNER_MS } from "../../lib/whatsapp";
import { Reveal } from "../atoms";
import { RecheckIcon } from "./WaIcons";
import { MessageBubble } from "./MessageBubble";
import { DraftCard } from "./DraftCard";
import { ReplyComposer } from "./ReplyComposer";
import { LinkedBookingCard } from "./LinkedBookingCard";
import { IntentBanner } from "./IntentBanner";
import { R, T, FW } from "../../lib/constants";

export function ConversationView({
  conv, messages, onBack, onSend, onAccept, onDismiss, templates, bookings, showBack,
  onArchive, onUnarchive, onDelete, onCancelLinkedBooking, onOpenLinkedBooking,
  onDismissAcceptedBadge, onMarkIntentHandled, onResend, onApplyModify, compact,
  onRecheck, regularMin,
}) {
  // NO excludeBookingId. This used to pass conv.acceptedBookingId, which made the
  // header chip disagree with the booking form's for the same customer (Patryk:
  // the Inbox said 2 past visits where a new booking said 3). That argument exists
  // for the booking being EDITED — its own row must not count as one of its own
  // past visits — and a conversation is not a booking: the linked booking is a
  // separate visit which, once completed, genuinely IS a past one. While it is
  // pending/confirmed it isn't `completed`, so it never counted anyway — the
  // argument could only ever subtract a real past visit.
  const match = matchCustomerByPhone(conv.phoneKey, bookings);
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

  // ── "Booking confirmed" banner auto-dismiss ─────────────────────────────────
  // The big accepted banner used to sit in the thread until someone hit its ✕.
  // It stamps the SAME acceptedBadgeDismissedAt the ✕ does, so the existing
  // re-show rule is untouched: a new inbound message clears the stamp and the
  // banner comes back. The header's small "✓ Booking confirmed" chip is
  // deliberately NOT on this timer — that one is the persistent status, and the
  // LinkedBookingCard below it keeps showing the booking itself.
  //
  // Gated on the banner actually being on screen, and keyed by phoneKey, so
  // switching threads restarts the clock rather than dismissing the next
  // conversation's banner early. onDismissAcceptedBadge is deliberately NOT a
  // dep — useWhatsApp hands back a fresh closure every render, which would
  // restart the timer on every render and never fire.
  const acceptedBannerShowing = conv.draftStatus === "accepted" && !conv.acceptedBadgeDismissedAt;
  useEffect(() => {
    if (!acceptedBannerShowing) return;
    const t = setTimeout(() => {
      if (onDismissAcceptedBadge) onDismissAcceptedBadge(conv.phoneKey);
    }, WA_ACCEPTED_BANNER_MS);
    return () => clearTimeout(t);
  }, [acceptedBannerShowing, conv.phoneKey]);

  // ── Manual re-check state ───────────────────────────────────────────────────
  // null | "running" | { ok, msg }. The result line is transient (it clears
  // itself) because the real answer is the draft / intent banner appearing —
  // this only has to cover the "nothing found" case, which is otherwise
  // indistinguishable from the button doing nothing at all.
  const [recheck, setRecheck] = useState(null);
  // Request token. InboxPanel renders ONE ConversationView and swaps its `conv`
  // prop, so this component is NOT remounted when you switch threads — an
  // in-flight re-check would otherwise resolve and paint its result onto
  // whichever conversation happens to be open when it returns. Every start
  // takes a token; a resolution whose token is stale is dropped. The switch
  // effect bumps the token, so switching away also cancels.
  const recheckReqRef = useRef(0);
  useEffect(() => { recheckReqRef.current++; setRecheck(null); }, [conv.phoneKey]);
  useEffect(() => {
    if (!recheck || recheck === "running") return;
    const t = setTimeout(() => setRecheck(null), 6000);
    return () => clearTimeout(t);
  }, [recheck]);
  function runRecheck() {
    if (recheck === "running" || !onRecheck) return;
    const token = ++recheckReqRef.current;
    const fresh = () => recheckReqRef.current === token;
    setRecheck("running");
    Promise.resolve(onRecheck(conv.phoneKey)).then(
      (r) => {
        if (!fresh()) return;
        const intentFound = r && r.intent;
        setRecheck(r && r.updated
          ? { ok: true, msg: intentFound === "cancel" ? "Cancellation request found." : intentFound === "modify" ? "Change request found." : "Booking request found." }
          : { ok: true, msg: "Nothing outstanding — no changes requested." });
      },
      (e) => { if (fresh()) setRecheck({ ok: false, msg: "Re-check failed: " + (e && e.message ? e.message : "unknown error") }); }
    );
  }

  const linkedBooking = conv.acceptedBookingId ? bookings.find((b) => b.id === conv.acceptedBookingId) : null;
  const intent = (conv.draftData && conv.draftData.intent) || null;

  // "Booking confirmed" header chip — non-dismissable (the big DraftCard banner
  // is the dismissable element instead).
  const acceptedBadge = conv.draftStatus === "accepted"
    ? <span style={{ fontSize: T.small, fontWeight: FW.semi, padding: "3px 10px", borderRadius: R.pill, background: "transparent", color: "var(--wa-accept-text)", border: "2px solid var(--wa-accept-border)" }}>✓ Booking confirmed</span>
    : null;
  // The disclosure lists the customer's OTHER visits. The linked booking is
  // already rendered in full by LinkedBookingCard a few lines below, and now the
  // COUNT no longer excludes it (see `match` above) it would otherwise appear
  // twice on the same screen. Filtered here and not in the count on purpose: the
  // count is the number that has to agree with the booking form's chip, so it
  // stays the true total — a list shorter than the count is already normal, the
  // slice(0, 5) cap does the same thing.
  const pastList = match ? match.regularBookings.filter((b) => b.id !== conv.acceptedBookingId) : [];
  // Regular chip — only when the customer has ≥1 completed booking. Same count
  // AND same label as the booking form's chip: regularChipLabel is the one
  // implementation, so the settings/general `regularMin` threshold applies here
  // too (this copy used to print "Regular · " at any count, including 1).
  // It is only a BUTTON when there is something to disclose: a customer whose
  // single completed visit is the linked one still earns the chip, but tapping
  // it would open an empty "Past bookings" box.
  const chipStyle = { background: "transparent", border: "2px solid var(--wa-teal-border)", borderRadius: R.pill, padding: "3px 10px", fontSize: T.small, fontWeight: FW.semi, color: "var(--wa-teal-text)" };
  const regularChip = match && match.regularCount >= 1
    ? (pastList.length
      ? <button className="mgt-hover-scale mgt-press" onClick={() => setHistOpen(!histOpen)} style={Object.assign({}, chipStyle, { cursor: "pointer" })}>{regularChipLabel(match.regularCount, regularMin) + (histOpen ? " ▾" : " ▸")}</button>
      : <span style={chipStyle}>{regularChipLabel(match.regularCount, regularMin)}</span>)
    : null;
  // Body rendered whenever there are other visits to show; Reveal (below) eases
  // it open/closed off histOpen so the disclosure doesn't snap.
  const hasRegulars = pastList.length > 0;
  const pastListBody = hasRegulars ? (
    <div style={{ padding: "8px 12px", background: "var(--wa-teal-bg)", border: "1px solid var(--wa-teal-border)", borderRadius: R.card, marginBottom: 10, fontSize: T.body, color: "var(--text-primary)" }}>
      <div style={{ fontWeight: FW.semi, marginBottom: 4, color: "var(--wa-teal-text)" }}>Past bookings</div>
      {pastList.slice(0, 5).map((b) => (
        <div key={b.id} style={{ padding: "3px 0", borderTop: "1px solid var(--wa-teal-border)" }}>{(b.date || "?") + " · " + b.time + " · " + b.size + " pax · " + b.status}</div>
      ))}
    </div>
  ) : null;
  const windowEl = win
    ? <span style={{ fontSize: T.small, fontWeight: FW.semi, padding: "3px 10px", borderRadius: R.pill, background: "transparent", color: win.expired ? "var(--danger-text)" : "var(--success-text)", border: "2px solid " + (win.expired ? "var(--danger-border)" : "var(--suggest-border)") }}>{win.label}</span>
    : null;

  // Manual LLM re-check — leftmost of the header actions in BOTH states (an
  // archived thread can be re-checked too; that's often exactly why you opened
  // it). Icon-only to match the panel header's Templates/🧪 buttons, and it
  // spins while the round-trip is in flight.
  const running = recheck === "running";
  const recheckBtn = onRecheck ? (
    <button
      onClick={runRecheck}
      disabled={running}
      title={running ? "Checking…" : "Re-check this conversation for requested changes"}
      className={running ? undefined : "mgt-hover-scale mgt-press"}
      style={{ background: "var(--btn-default)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: R.pill, width: 36, height: 36, padding: 0, cursor: running ? "default" : "pointer", color: "var(--text-on-accent)", flexShrink: 0, boxShadow: "var(--shadow-btn)", display: "flex", alignItems: "center", justifyContent: "center", opacity: running ? 0.6 : 1 }}
    >
      {/* The spin is a LOOP — nothing arrives and nothing leaves, so neither
          direction curve describes it and it keeps `linear`. Documented
          exception, alongside .mgt-shimmer and .mgt-dot-pulse. */}
      <span style={running ? { display: "block", animation: "mgt-spin 900ms linear infinite" } : { display: "block" }}><RecheckIcon size={15} /></span>
    </button>
  ) : null;

  let headerActionBtns;
  if (conv.archived) {
    headerActionBtns = (
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {recheckBtn}
        <button onClick={() => { if (onUnarchive) onUnarchive(conv.phoneKey); }} title="Restore conversation" className="mgt-hover-scale mgt-press" style={{ background: "var(--wa-btn-handled)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: R.pill, padding: "8px 12px", minHeight: 36, cursor: "pointer", fontSize: T.small, fontWeight: FW.semi, color: "var(--text-on-accent)", boxShadow: "var(--shadow-btn)" }}>↺ Restore</button>
        <button onClick={() => { if (onDelete) onDelete(conv.phoneKey); }} title="Delete conversation" className="mgt-hover-scale mgt-press" style={{ background: "var(--wa-btn-cancel)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: R.pill, padding: "8px 12px", minHeight: 36, cursor: "pointer", fontSize: T.small, fontWeight: FW.semi, color: "var(--text-on-accent)", boxShadow: "var(--shadow-btn)" }}>🗑 Delete</button>
      </div>
    );
  } else {
    headerActionBtns = (
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {recheckBtn}
        <button onClick={() => { if (onArchive) onArchive(conv.phoneKey); }} title="Archive conversation" className="mgt-hover-scale mgt-press" style={{ background: "var(--btn-default)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: R.pill, padding: "8px 12px", minHeight: 36, cursor: "pointer", fontSize: T.small, fontWeight: FW.semi, color: "var(--text-on-accent)", flexShrink: 0, boxShadow: "var(--shadow-btn)" }}>📦 Archive</button>
      </div>
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
      {/* Single-row header (v15.8.2-wa-sandbox): name + phone + status pills + the
          action buttons all on one level to reclaim vertical space. The pill
          cluster wraps under the name on narrow widths; the action buttons stay
          pinned right via marginLeft:auto. The old "WA" badge was removed. */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--wa-divider)", background: "var(--wa-header-bg)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {showBack ? <button onClick={onBack} className="mgt-hover-scale mgt-press" style={{ background: "var(--btn-default)", border: "1px solid var(--border-glass)", borderRadius: R.pill, width: 36, height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: T.lead, fontWeight: FW.semi, color: "var(--text-on-accent)", flexShrink: 0, lineHeight: 1 }} title="Back">‹</button> : null}
        <span style={{ fontSize: T.title, fontWeight: FW.bold, color: "var(--text-primary)", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
        <span style={{ fontSize: T.body, color: "var(--text-muted)", fontFamily: "-apple-system, BlinkMacSystemFont, monospace" }}>{phoneDisplay}</span>
        {regularChip}
        {acceptedBadge}
        {conv.archived ? <span style={{ fontSize: T.small, fontWeight: FW.semi, padding: "3px 10px", borderRadius: R.pill, background: "transparent", color: "var(--text-muted)", border: "2px solid var(--border-soft)" }}>📦 Archived</span> : null}
        {windowEl}
        <div style={{ marginLeft: "auto", flexShrink: 0 }}>{headerActionBtns}</div>
      </div>
      <Reveal show={histOpen && hasRegulars} style={{ padding: "0 14px" }}><div style={{ paddingTop: 8 }}>{pastListBody}</div></Reveal>
      {/* Manual re-check result. Only needed for the "found nothing" / error
          cases — a positive finding announces itself as a draft card or intent
          banner. Eased in and self-clearing, so it never becomes chrome. */}
      <Reveal show={!!(recheck && recheck !== "running")} style={{ padding: "0 14px" }}>
        <div style={{ paddingTop: 8 }}>
          <div style={{ padding: "8px 12px", borderRadius: R.card, fontSize: T.body, fontWeight: FW.regular, background: recheck && recheck.ok ? "var(--suggest-bg)" : "var(--danger-bg)", border: "1px solid " + (recheck && recheck.ok ? "var(--suggest-border)" : "var(--danger-border)"), color: recheck && recheck.ok ? "var(--success-text)" : "var(--danger-text)" }}>
            {recheck && recheck !== "running" ? recheck.msg : ""}
          </div>
        </div>
      </Reveal>
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
      <Reveal show={isParsing(conv)} style={{ padding: "0 14px" }}>
        <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: R.card, background: "var(--wa-draft-bg)", border: "2px solid var(--wa-draft-border)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: T.lead }}>📋</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: T.body, fontWeight: FW.semi, color: "var(--wa-draft-text)", marginBottom: 6 }}>Reading the message…</div>
            <div className="mgt-shimmer" style={{ height: 8, borderRadius: R.pill, background: "var(--wa-draft-border)" }} />
          </div>
        </div>
      </Reveal>
      <Reveal show={draftCardShows} style={{ padding: "0 14px" }}>
        <DraftCard conv={conv} onAccept={onAccept} onDismiss={onDismiss} onDismissAcceptedBadge={onDismissAcceptedBadge} compact={compact} />
      </Reveal>
      <ReplyComposer onSend={onSend} disabled={disabled} templates={templates} convLang={conv.language} />
    </div>
  );
}
