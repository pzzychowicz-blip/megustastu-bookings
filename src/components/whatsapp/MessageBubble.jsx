// src/components/whatsapp/MessageBubble.jsx
// One chat bubble in a conversation thread. Incoming = left/light; outgoing =
// right/accent-blue with a delivery-status caption. The "auto" tag marks the
// language-matched auto-acknowledgment. Translucent white/black overlays on the
// saturated blue bubble are theme-invariant (same convention as the atoms).

import { formatClockTime } from "../../lib/whatsapp";

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
    <span style={{ fontSize: 10, fontWeight: 600, color: incoming ? "var(--text-muted)" : "rgba(255,255,255,0.75)", marginLeft: 6, padding: "1px 6px", borderRadius: 6, background: incoming ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.18)" }}>auto</span>
  ) : null;

  let statusEl = null;
  if (!incoming && msg.status) {
    const map = { sending: "· sending", delivered: "· delivered", read: "· read", failed: "· failed" };
    const statColor = msg.status === "failed" ? "rgba(254,202,202,0.95)" : "rgba(255,255,255,0.75)";
    statusEl = <span style={{ fontSize: 10, color: statColor, marginLeft: 4 }}>{map[msg.status] || ""}</span>;
  }

  // Retry affordance for a failed outgoing send (client mock path — see
  // useWhatsApp.handleResend). Only shown when a resend handler is wired.
  const retryEl = (!incoming && msg.status === "failed" && onRetry) ? (
    <button
      onClick={() => onRetry(msg.id)}
      className="mgt-hover-scale mgt-press"
      title="Resend this message"
      style={{ marginLeft: 6, background: "var(--danger-bg)", border: "1px solid var(--danger-border)", borderRadius: 7, padding: "1px 7px", cursor: "pointer", fontSize: 10, fontWeight: 700, color: "var(--danger-text)" }}
    >↻ Retry</button>
  ) : null;

  return (
    <div className={isLast ? "mgt-bubble-in" : undefined} style={{ display: "flex", justifyContent: align, marginBottom: 8 }}>
      <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", alignItems: align }}>
        <div style={{ background: bg, color, border, borderRadius: 14, padding: "8px 12px", fontSize: 14, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", opacity: msg.status === "sending" ? 0.7 : 1 }}>{msg.text}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, padding: "0 4px", display: "flex", alignItems: "center" }}>
          {formatClockTime(msg.ts)}{ackTag}{statusEl}{retryEl}
        </div>
      </div>
    </div>
  );
}
