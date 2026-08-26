// src/components/whatsapp/DraftCard.jsx
// The sepia "Draft booking — parsed from message" card with Accept & open /
// Dismiss, shown for a new_booking intent. For an accepted conversation it
// becomes the big dismissable "Booking confirmed" banner; for a dismissed one,
// a quiet "not a booking request" note. Non-new_booking intents render nothing
// here — the IntentBanner in ConversationView takes over.

import { useState } from "react";
import { Reveal, mkSolidBtn, OutlineChip, InlineAlert } from "../atoms";
import { clampConfidence } from "../../lib/whatsapp";
import { R, T, FW, IC, M, H, RIM_SOLID } from "../../lib/constants";
import { DraftIcon, WarnIcon } from "./WaIcons";
import { CloseIcon, CheckIcon, ChevronRightIcon } from "../Icons";

export function DraftCard({ conv, onAccept, onDismiss, onDismissAcceptedBadge, compact }) {
  // Compact-mode disclosure for the new_booking bar (notes / warning / confidence).
  // Declared before the early returns so the hook order stays stable.
  const [expanded, setExpanded] = useState(false);
  if (conv.draftStatus === "accepted") {
    // Dismissable via the ✕; hidden once acceptedBadgeDismissedAt is set, and
    // re-shown when a new inbound message clears that stamp.
    if (conv.acceptedBadgeDismissedAt) return null;
    // v17.8.0-wa-sandbox: the notification-pane idiom, in the WAITLIST palette.
    // This is an OPPORTUNITY resolved, not a warning, and the app already has a
    // green for exactly that — the "table free" banner's --suggest-* family. It
    // used to be a --wa-accept-* card: a 0.7-alpha green wash inside a 2px green
    // rim, which is the fill-plus-matching-border-plus-third-shade shape the
    // v17.8.0 sweep banned, and at pane size it shouted louder than the running-
    // late amber above it. Now: a whisper of tint, a 1px NEUTRAL --border-card,
    // and the green carried by the ✓ mark and the text.
    //
    // The mark was a text ✓ for one version, on the v17.8.0 grounds that ✓ is
    // monochrome with universal font coverage and therefore exempt. v17.9.0
    // retired that whole list: an icon set covering only the glyphs with a
    // RENDERING BUG is a patch, not a set, and this ✓ sat two lines from a
    // hand-drawn DraftIcon on the same surface. CheckIcon now — the same mark
    // the notification strip's sections wear, which is what this pane is.
    //
    // The ✕ moved out of `position:absolute` into the flex row: every other
    // dismiss in the notification system is the last item of its row, and the
    // absolute version needed a paddingRight fudge on the sibling to avoid it.
    return (
      <div style={{ padding: "10px 14px", borderRadius: R.card, background: "var(--suggest-bg-soft)", border: "1px solid var(--border-card)", marginBottom: 12, boxShadow: "var(--shadow-soft)", display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", height: 18, flexShrink: 0, color: "var(--success-text)" }}><CheckIcon size={IC.control} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: T.body, fontWeight: FW.bold, color: "var(--success-text)" }}>Booking confirmed</div>
          <div style={{ fontSize: T.body, fontWeight: FW.regular, color: "var(--success-text)", opacity: 0.85, marginTop: 2 }}>This request has been added to the bookings list.</div>
        </div>
        {/* 32×32, the size every other banner dismiss in the app already is
            (LateBanner / OverlapBanner / WaitAvailBanner all sit at minHeight
            32). What this replaced was `padding:"2px 4px"` on a 12px glyph — a
            ~16px hit area, on a device that is only ever touched, for the only
            control on the notice. `--r-pill` clamps to half the SHORTER side,
            so equal width/height with padding:0 is what makes it an actual
            circle rather than a vertical egg. */}
        <button
          onClick={() => { if (onDismissAcceptedBadge) onDismissAcceptedBadge(conv.phoneKey); }}
          title="Dismiss"
          aria-label="Dismiss this notice"
          className="mgt-hover-scale mgt-press"
          style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: T.body, fontWeight: FW.semi, color: "var(--success-text)", width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, opacity: 0.6, borderRadius: R.pill, flexShrink: 0 }}
        ><CloseIcon size={IC.control} /></button>
      </div>
    );
  }
  if (conv.draftStatus === "dismissed") {
    return (
      <div style={{ padding: "10px 14px", borderRadius: R.card, background: "var(--bg-soft)", border: "1px solid var(--border-soft)", marginBottom: 12, fontSize: T.body, color: "var(--text-muted)", fontStyle: "italic" }}>
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
  // 17.15.0-wa-sandbox: ONE tone, not a colour and a border chosen separately.
  // These were two parallel ternaries — `confColor` from the --*-text family and
  // `confBorder` from --danger-border/--warn-border/--suggest-border — which is
  // exactly the pairing `OutlineChip` was written to end: families never
  // required to agree, so light rendered a pale ring around dark text while dark
  // nearly converged. A tone is one decision and the border is derived from the
  // ink; "suggest" for high confidence was the odd one out and is now "success",
  // which is what it always meant.
  const confTone = conf === "low" ? "danger" : conf === "medium" ? "warn" : "success";
  // v17.8.0 label treatments: OUTLINE, not a pale fill. This chip lives
  // INSIDE the draft card, which already has its own fill and 2px rim — a
  // filled chip in a filled container is the card-inside-a-card shape the
  // sweep bans. The border hue carries the confidence on its own.
  const confLbl = conf;
  // Seating preference suffix — only shown when the customer stated an area
  // (indoor/outdoor); "auto"/unset adds nothing (it's the default).
  const prefSuffix = (d.preference === "indoor" || d.preference === "outdoor")
    ? " · " + (d.preference === "indoor" ? "Indoor" : "Outdoor")
    : "";
  const summary = (d.size != null ? d.size + " pax" : "? pax") + " · " + (d.date || "? date") + " · " + (d.time || "? time") + prefSuffix;
  // Confidence is shown inline in the compact bar (always), so only notes /
  // ambiguity are "revealable" content behind the toggle.
  const hasDetail = !!(d.notes || d.ambiguity);

  // Compact (short-screen) bar: one line — icon + summary · ▸ · [conf] [Accept] [Dismiss].
  // Tapping the summary section toggles a Reveal of the notes / ambiguity detail;
  // the confidence badge sits inline (left of Accept), always visible. Saves
  // ~120px so the message thread stays readable.
  if (compact) {
    // One caller left (the solid Accept) now that Dismiss is an OutlineChip, so
    // the factory takes the one thing that still varies. Four parameters for
    // fill + weight + border + ink was six values where there are two
    // decisions — the confColor/confBorder shape, one component over.
    const smallBtn = (bg) => ({ background: bg, border: RIM_SOLID, borderRadius: R.pill, padding: "6px 12px", cursor: "pointer", fontSize: T.body, fontWeight: FW.bold, color: "var(--text-on-accent)", minHeight: H.chrome, flexShrink: 0 });
    return (
      <div style={{ borderRadius: R.card, background: "var(--wa-draft-bg)", border: "1px solid var(--border-card)", marginBottom: 12, boxShadow: "var(--shadow-soft)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", flexWrap: "wrap" }}>
          {/* The draft section itself is the toggle (when there's detail to show). */}
          <div
            onClick={hasDetail ? () => setExpanded((v) => !v) : undefined}
            title={hasDetail ? (expanded ? "Hide details" : "Show details") : undefined}
            style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, cursor: hasDetail ? "pointer" : "default" }}
          >
            <span style={{ color: "var(--wa-draft-text)", display: "inline-flex", flexShrink: 0 }}><DraftIcon size={IC.control} /></span>
            <span style={{ fontSize: T.body, fontWeight: FW.semi, color: "var(--wa-draft-text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
            {hasDetail ? <span style={{ color: "var(--wa-draft-text)", flexShrink: 0, display: "inline-flex", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform " + M.tap }}><ChevronRightIcon size={IC.inline} /></span> : null}
          </div>
          {/* Confidence level — always shown, immediately left of Accept. */}
          <OutlineChip title={confLbl + " confidence"} tone={confTone} size="small" style={{ textTransform: "uppercase", letterSpacing: "0.02em" }}>{confLbl}</OutlineChip>
          <button onClick={onAccept} className="mgt-hover-scale mgt-press" style={smallBtn("var(--wa-btn-open)")}>Accept</button>
          {/* Secondary = OUTLINE (see the full card's note): one saturated pill
              per pane, so the eye can find the primary without reading. */}
          {/* v17.15.3: the neutral twin of the linked-booking card's fix — the
              outline-chip shape typed by hand, taking its border from
              `--border-soft` while its ink is `--text-secondary`. `OutlineChip`
              derives one from the other, so they are one decision.
              It also carried a bare `600` where the scale says `FW.semi`, and
              `check:style` could not see it: the weight was an ARGUMENT to this
              local factory, not a `fontWeight:` property, and the gate reads
              properties. A shape hides from it; only reading does not. */}
          <OutlineChip as="button" tone="neutral" onClick={onDismiss} className="mgt-hover-scale mgt-press" style={{ padding: "6px 12px", fontSize: T.body, fontWeight: FW.semi, minHeight: H.chrome }}>Dismiss</OutlineChip>
        </div>
        {hasDetail ? (
          <Reveal show={expanded} style={{ padding: "0 10px" }}>
            <div style={{ paddingBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {d.notes ? <div style={{ fontSize: T.body, color: "var(--wa-draft-text-dim)" }}>{"Notes: " + d.notes}</div> : null}
              {d.ambiguity ? <InlineAlert icon={WarnIcon}>{d.ambiguity}</InlineAlert> : null}
            </div>
          </Reveal>
        ) : null}
      </div>
    );
  }

  // v17.8.0-wa-sandbox: the notification-pane idiom. The draft stays AMBER —
  // only the green surfaces moved to the waitlist palette — but the pane is now
  // a wash inside a 1px NEUTRAL rim instead of a 0.8-alpha yellow inside a 2px
  // yellow one. The hue is carried by the DraftIcon and the text, exactly as
  // NotificationStrip carries a section's tone.
  return (
    <div style={{ padding: "12px 14px", borderRadius: R.card, background: "var(--wa-draft-bg)", border: "1px solid var(--border-card)", marginBottom: 12, boxShadow: "var(--shadow-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--wa-draft-text)", display: "inline-flex", flexShrink: 0 }}><DraftIcon size={IC.control} /></span>
          <span style={{ fontSize: T.body, fontWeight: FW.semi, color: "var(--wa-draft-text)" }}>Draft booking — parsed from message</span>
        </div>
        <OutlineChip tone={confTone} size="small" style={{ textTransform: "uppercase", letterSpacing: "0.02em" }}>{confLbl + " confidence"}</OutlineChip>
      </div>
      <div style={{ fontSize: T.lead, color: "var(--wa-draft-text-dim)", lineHeight: 1.6, marginBottom: d.ambiguity ? 8 : 12 }}>
        <span style={{ fontWeight: FW.semi }}>{(d.size != null ? d.size + " pax" : "? pax") + " · " + (d.date || "? date") + " · " + (d.time || "? time") + prefSuffix}</span>
        {d.notes ? <div style={{ fontSize: T.body, marginTop: 4 }}>{"Notes: " + d.notes}</div> : null}
      </div>
      {/* v17.15.3: --danger-bg + a MATCHING --danger-border + --danger-text was
          the banned shape itself — one signal encoded three times, the stock
          badge every framework ships — and the module carried it twice, here
          and in the compact bar above, byte-identical but for a margin.
          `InlineAlert` is the strip's section shape, so a parse ambiguity now
          looks like every other fault in the app whether it fires in the inbox
          or in a booking form. */}
      {d.ambiguity ? <InlineAlert icon={WarnIcon} style={{ marginBottom: 10 }}>{d.ambiguity}</InlineAlert> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={onAccept}
          className="mgt-hover-scale mgt-press"
          style={mkSolidBtn("var(--wa-btn-open)", { minHeight: H.touch, boxShadow: "var(--shadow-btn)" })}
        >Accept &amp; open</button>
        {/* Secondary = OUTLINE, not a second filled pill. Two saturated buttons
            side by side meant neither read as the primary — and once the pane
            went quiet they were the loudest things in the thread. The size is
            deliberately UNCHANGED at 44: accepting or discarding a parsed draft
            is a decision surface where a mis-tap costs something, which is the
            documented reason a control earns 44 over mkBtn's 40. Dropping the
            fill also drops --shadow-btn: that token is for RAISED controls, and
            an outline button is not one. */}
        <button
          onClick={onDismiss}
          className="mgt-hover-scale mgt-press"
          style={{ background: "transparent", border: "2px solid var(--border-soft)", borderRadius: R.pill, padding: "10px 18px", cursor: "pointer", fontSize: T.lead, fontWeight: FW.semi, color: "var(--text-secondary)", minHeight: 44 }}
        >Dismiss</button>
      </div>
    </div>
  );
}
