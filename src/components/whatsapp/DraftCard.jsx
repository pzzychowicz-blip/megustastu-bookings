// src/components/whatsapp/DraftCard.jsx
// The sepia "Draft booking — parsed from message" card with Accept & open /
// Dismiss, shown for a new_booking intent. For an accepted conversation it
// becomes the big dismissable "Booking confirmed" banner; for a dismissed one,
// a quiet "not a booking request" note. Non-new_booking intents render nothing
// here — the IntentBanner in ConversationView takes over.

export function DraftCard({ conv, onAccept, onDismiss, onDismissAcceptedBadge }) {
  if (conv.draftStatus === "accepted") {
    // Dismissable via the ✕; hidden once acceptedBadgeDismissedAt is set, and
    // re-shown when a new inbound message clears that stamp.
    if (conv.acceptedBadgeDismissedAt) return null;
    return (
      <div style={{ padding: "12px 14px", borderRadius: 14, background: "var(--wa-accept-bg)", border: "2px solid var(--wa-accept-border)", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", position: "relative" }}>
        <button
          onClick={() => { if (onDismissAcceptedBadge) onDismissAcceptedBadge(conv.phoneKey); }}
          title="Dismiss"
          style={{ position: "absolute", top: 6, right: 8, background: "transparent", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "var(--wa-accept-text)", padding: "4px 6px", lineHeight: 1, opacity: 0.6, borderRadius: 6 }}
        >✕</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 20 }}>
          <span style={{ fontSize: 18 }}>✓</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--wa-accept-text)" }}>Booking confirmed</div>
            <div style={{ fontSize: 12, color: "var(--wa-accept-text)", marginTop: 2 }}>This request has been added to the bookings list.</div>
          </div>
        </div>
      </div>
    );
  }
  if (conv.draftStatus === "dismissed") {
    return (
      <div style={{ padding: "10px 14px", borderRadius: 14, background: "var(--bg-soft)", border: "1px solid var(--border-soft)", marginBottom: 12, fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
        Marked as not a booking request.
      </div>
    );
  }
  if (!conv.draftData) return null;
  const d = conv.draftData;
  // Treat a missing intent as new_booking (back-compat). Other intents defer to
  // the IntentBanner, so DraftCard renders nothing for them.
  const intent = d.intent || "new_booking";
  if (intent !== "new_booking") return null;

  const confColor = d.confidence === "low" ? "var(--danger-text)" : d.confidence === "medium" ? "var(--warn-text)" : "var(--success-text)";
  const confBg = d.confidence === "low" ? "var(--danger-bg)" : d.confidence === "medium" ? "var(--warn-bg)" : "var(--suggest-bg)";
  const confLbl = d.confidence || "high";

  return (
    <div style={{ padding: "14px 16px", borderRadius: 14, background: "var(--wa-draft-bg)", border: "2px solid var(--wa-draft-border)", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>📋</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--wa-draft-text)" }}>Draft booking — parsed from message</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8, background: confBg, color: confColor, textTransform: "uppercase", letterSpacing: "0.02em" }}>{confLbl + " confidence"}</span>
      </div>
      <div style={{ fontSize: 14, color: "var(--wa-draft-text-dim)", lineHeight: 1.6, marginBottom: d.ambiguity ? 8 : 12 }}>
        <span style={{ fontWeight: 700 }}>{(d.size != null ? d.size + " pax" : "? pax") + " · " + (d.date || "? date") + " · " + (d.time || "? time")}</span>
        {d.notes ? <div style={{ fontSize: 13, marginTop: 4 }}>{"Notes: " + d.notes}</div> : null}
      </div>
      {d.ambiguity ? (
        <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--danger-bg)", border: "1px solid var(--danger-border)", fontSize: 12, color: "var(--danger-text)", marginBottom: 10 }}>{"⚠ " + d.ambiguity}</div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={onAccept}
          className="mgt-hover-scale"
          style={{ background: "var(--wa-btn-open)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--text-on-accent)", minHeight: 40, boxShadow: "0 2px 6px rgba(0,122,255,0.22), inset 0 1px 1px rgba(255,255,255,0.2)" }}
        >Accept &amp; open</button>
        <button
          onClick={onDismiss}
          className="mgt-hover-scale"
          style={{ background: "var(--btn-default)", border: "1px solid var(--border-glass)", borderRadius: 12, padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--text-on-accent)", minHeight: 40, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
        >Dismiss</button>
      </div>
    </div>
  );
}
