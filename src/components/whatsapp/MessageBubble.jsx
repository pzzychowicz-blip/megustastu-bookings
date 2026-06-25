// src/components/whatsapp/MessageBubble.jsx
// One chat bubble in a conversation thread. Incoming = left/light; outgoing =
// right/accent-blue with a delivery-status caption. The "auto" tag marks the
// language-matched auto-acknowledgment. Translucent white/black overlays on the
// saturated blue bubble are theme-invariant (same convention as the atoms).

import { formatClockTime } from "../../lib/whatsapp";

export function MessageBubble({ msg }) {
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

  return (
    <div style={{ display: "flex", justifyContent: align, marginBottom: 8 }}>
      <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", alignItems: align }}>
        <div style={{ background: bg, color, border, borderRadius: 14, padding: "8px 12px", fontSize: 14, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", opacity: msg.status === "sending" ? 0.7 : 1 }}>{msg.text}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, padding: "0 4px", display: "flex", alignItems: "center" }}>
          {formatClockTime(msg.ts)}{ackTag}{statusEl}
        </div>
      </div>
    </div>
  );
}
