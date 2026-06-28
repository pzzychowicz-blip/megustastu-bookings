// src/components/whatsapp/DraftCard.jsx
// The sepia "Draft booking — parsed from message" card with Accept & open /
// Dismiss, shown for a new_booking intent. For an accepted conversation it
// becomes the big dismissable "Booking confirmed" banner; for a dismissed one,
// a quiet "not a booking request" note. Non-new_booking intents render nothing
// here — the IntentBanner in ConversationView takes over.

import { useState } from "react";
import { Reveal } from "../atoms";
import { clampConfidence } from "../../lib/whatsapp";

export function DraftCard({ conv, onAccept, onDismiss, onDismissAcceptedBadge, compact }) {
  // Compact-mode disclosure for the new_booking bar (notes / warning / confidence).
  // Declared before the early returns so the hook order stays stable.
  const [expanded, setExpanded] = useState(false);
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

  // Clamp at display time too: confidence can NEVER read higher than the draft's
  // own fields warrant (any missing crucial field / ambiguity caps it). The write
  // paths already clamp, so this is idempotent for fresh drafts — it only corrects
  // legacy/stale drafts stored before the clamp rule (e.g. a "? time" draft that
  // was saved as "high").
  const conf = clampConfidence(d.confidence, d);
  const confColor = conf === "low" ? "var(--danger-text)" : conf === "medium" ? "var(--warn-text)" : "var(--success-text)";
  const confBg = conf === "low" ? "var(--danger-bg)" : conf === "medium" ? "var(--warn-bg)" : "var(--suggest-bg)";
  const confLbl = conf;
  const summary = (d.size != null ? d.size + " pax" : "? pax") + " · " + (d.date || "? date") + " · " + (d.time || "? time");
  // Confidence is shown inline in the compact bar (always), so only notes /
  // ambiguity are "revealable" content behind the toggle.
  const hasDetail = !!(d.notes || d.ambiguity);

  // Compact (short-screen) bar: one line — 📋 summary · ▸ · [conf] [Accept] [Dismiss].
  // Tapping the summary section toggles a Reveal of the notes / ambiguity detail;
  // the confidence badge sits inline (left of Accept), always visible. Saves
  // ~120px so the message thread stays readable.
  if (compact) {
    const smallBtn = (bg, fw, border) => ({ background: bg, border, borderRadius: 10, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: fw, color: "var(--text-on-accent)", minHeight: 32, flexShrink: 0 });
    return (
      <div style={{ borderRadius: 14, background: "var(--wa-draft-bg)", border: "2px solid var(--wa-draft-border)", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", flexWrap: "wrap" }}>
          {/* The draft section itself is the toggle (when there's detail to show). */}
          <div
            onClick={hasDetail ? () => setExpanded((v) => !v) : undefined}
            title={hasDetail ? (expanded ? "Hide details" : "Show details") : undefined}
            style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, cursor: hasDetail ? "pointer" : "default" }}
          >
            <span style={{ fontSize: 15 }}>📋</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--wa-draft-text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
            {hasDetail ? <span style={{ fontSize: 13, fontWeight: 700, color: "var(--wa-draft-text)", flexShrink: 0 }}>{expanded ? "▾" : "▸"}</span> : null}
          </div>
          {/* Confidence level — always shown, immediately left of Accept. */}
          <span title={confLbl + " confidence"} style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8, background: confBg, color: confColor, textTransform: "uppercase", letterSpacing: "0.02em", flexShrink: 0 }}>{confLbl}</span>
          <button onClick={onAccept} className="mgt-hover-scale mgt-press" style={smallBtn("var(--wa-btn-open)", 700, "1px solid rgba(255,255,255,0.2)")}>Accept</button>
          <button onClick={onDismiss} className="mgt-hover-scale mgt-press" style={smallBtn("var(--btn-default)", 600, "1px solid var(--border-glass)")}>Dismiss</button>
        </div>
        {hasDetail ? (
          <Reveal show={expanded} style={{ padding: "0 10px" }}>
            <div style={{ paddingBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {d.notes ? <div style={{ fontSize: 13, color: "var(--wa-draft-text-dim)" }}>{"Notes: " + d.notes}</div> : null}
              {d.ambiguity ? <div style={{ padding: "8px 10px", borderRadius: 10, background: "var(--danger-bg)", border: "1px solid var(--danger-border)", fontSize: 12, color: "var(--danger-text)" }}>{"⚠ " + d.ambiguity}</div> : null}
            </div>
          </Reveal>
        ) : null}
      </div>
    );
  }

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
          className="mgt-hover-scale mgt-press"
          style={{ background: "var(--wa-btn-open)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--text-on-accent)", minHeight: 40, boxShadow: "0 2px 6px rgba(0,122,255,0.22), inset 0 1px 1px rgba(255,255,255,0.2)" }}
        >Accept &amp; open</button>
        <button
          onClick={onDismiss}
          className="mgt-hover-scale mgt-press"
          style={{ background: "var(--btn-default)", border: "1px solid var(--border-glass)", borderRadius: 12, padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--text-on-accent)", minHeight: 40, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
        >Dismiss</button>
      </div>
    </div>
  );
}
