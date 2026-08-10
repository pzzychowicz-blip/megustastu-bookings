// src/components/whatsapp/MessageBubble.jsx
// One chat bubble in a conversation thread. Incoming = left/light; outgoing =
// right/accent-blue with a delivery-status caption. The "auto" tag marks the
// language-matched auto-acknowledgment. Translucent white/black overlays on the
// saturated blue bubble are theme-invariant (same convention as the atoms).

import { formatClockTime } from "../../lib/whatsapp";
import { R, T, FW } from "../../lib/constants";

// `isLast` (set by ConversationView for the newest message only) opts the bubble
// into the `mgt-bubble-in` ease — so a freshly-arrived/sent message rises in, but
// opening a thread doesn't cascade-animate the whole history.
export function MessageBubble({ msg, isLast, onRetry }) {
  const incoming = msg.direction === "in";
  const bg = incoming ? "var(--wa-bubble-in)" : "var(--wa-bubble-out)";
  const color = incoming ? "var(--text-primary)" : "var(--text-on-accent)";
  const border = incoming ? "1px solid var(--wa-bubble-in-border)" : "1px solid var(--wa-bubble-out-border)";
  const align = incoming ? "flex-start" : "flex-end";

  const ackTag = msg.isAutoAck ? (
    <span style={{ fontSize: T.micro, fontWeight: FW.regular, color: incoming ? "var(--text-muted)" : "rgba(255,255,255,0.75)", marginLeft: 6, padding: "1px 6px", borderRadius: R.pill, background: incoming ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.18)" }}>auto</span>
  ) : null;

  let statusEl = null;
  if (!incoming && msg.status) {
    const map = { sending: "· sending", delivered: "· delivered", read: "· read", failed: "· failed" };
    const statColor = msg.status === "failed" ? "rgba(254,202,202,0.95)" : "rgba(255,255,255,0.75)";
    statusEl = <span style={{ fontSize: T.micro, color: statColor, marginLeft: 4 }}>{map[msg.status] || ""}</span>;
  }

  // Retry affordance for a failed outgoing send (client mock path — see
  // useWhatsApp.handleResend). Only shown when a resend handler is wired.
  const retryEl = (!incoming && msg.status === "failed" && onRetry) ? (
    <button
      onClick={() => onRetry(msg.id)}
      className="mgt-hover-scale mgt-press"
      title="Resend this message"
      style={{ marginLeft: 6, background: "var(--danger-bg)", border: "1px solid var(--danger-border)", borderRadius: R.pill, padding: "1px 7px", cursor: "pointer", fontSize: T.micro, fontWeight: FW.semi, color: "var(--danger-text)" }}
    >↻ Retry</button>
  ) : null;

  return (
    <div className={isLast ? "mgt-bubble-in" : undefined} style={{ display: "flex", justifyContent: align, marginBottom: 8 }}>
      <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", alignItems: align }}>
        {/* The one DELIBERATE radius literal left in the WA module (v17.7.0
            token sweep). The chat bubble's corner is the module's visual
            identity, not a card: it must not follow --r-card if that token is
            ever retuned, and it cannot be a pill — the bubble wraps to any
            height, and on --r-pill a multi-line bubble's corner curve eats the
            first and last characters (the same trap that produced mkArea). */}
        <div style={{ background: bg, color, border, borderRadius: 14, padding: "8px 12px", fontSize: T.lead, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", opacity: msg.status === "sending" ? 0.7 : 1 }}>{msg.text}</div>
        <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginTop: 3, padding: "0 4px", display: "flex", alignItems: "center" }}>
          {formatClockTime(msg.ts)}{ackTag}{statusEl}{retryEl}
        </div>
      </div>
    </div>
  );
}
