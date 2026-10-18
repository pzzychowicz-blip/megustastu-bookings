// src/components/whatsapp/DraftCard.jsx
// The sepia "Draft booking — parsed from message" card with Accept & open /
// Dismiss, shown for a new_booking intent. For an accepted conversation it
// becomes the big dismissable "Booking confirmed" banner; for a dismissed one,
// a quiet "not a booking request" note. Non-new_booking intents render nothing
// here — the IntentBanner in ConversationView takes over.

import { useState } from "react";
import { Reveal, mkSolidBtn, OutlineChip, InlineAlert } from "../atoms";
import { AlertPanel, AlertRow } from "../AlertPanel";
import { TimeChip } from "../AvailBanner";
import { clampConfidence, availabilityReply } from "../../lib/whatsapp";
import { draftCheckLine } from "../../lib/draft-check";
import { formatDay } from "../../lib/day";
import { guestsLabel } from "../../lib/booking-logic";
import { tagLabels } from "../../lib/tags";
import { R, T, FW, IC, M, H, SP, RIM_SOLID } from "../../lib/constants";
import { DraftIcon, WarnIcon } from "./WaIcons";
import { CloseIcon, CheckIcon, ChevronRightIcon, AlertIcon, WaitIcon } from "../Icons";

// v18.2.0 phase 72 (W6): what each level of the parser's confidence asks of
// staff. `clampConfidence` caps it by what the draft lacks — a size, date or
// time the app cannot use, or an ambiguity — so "low" means check it closely.
const CONF_SAYS = { high: "Looks right", medium: "Check it", low: "Check carefully" };

// ── v18.8.0 phase 8: does the request fit? ──────────────────────────────────
// The check's result under the draft (`useDraftCheck`, run by ConversationView
// after the paint). Plain text in its tone on the card's own fill, never a
// pane: a pane inside this pane is the card-inside-a-card shape. The inks are
// registered on --wa-draft-bg in tests/contrast.test.js.
const CHECK_INK = { success: "var(--success-text)", warn: "var(--warn-text)", danger: "var(--danger-text)" };
// The same outline button as the compact bar's Dismiss: these are secondary.
const CHECK_BTN = { display: "inline-flex", alignItems: "center", gap: SP.tight, padding: "6px 12px", fontSize: T.body, fontWeight: FW.semi, minHeight: H.chrome };
// Add to waitlist and On the waitlist are ONE button in two states, in one
// box: the wider label's width, measured in CHECK_BTN's type (129.0px against
// 128.6). As a chip of its own the second state was a content-box <span>, 44px
// tall beside 36px buttons, and narrower, so on a tablet the row re-wrapped
// and the control moved 460px from under the finger that pressed it; and the
// press dropped a keyboard user's focus to <body> with the button it was on.
const WAIT_W = 130;

// `reason` is what a suggested reply is about, `availabilityReply`'s word.
function replyReason(r) {
  if (!r || r.closed) return null;
  if (r.outside) return "hours";
  if (!r.fits) return "full";
  return r.kitchenBusy ? "kitchen" : null;
}

function DraftCheck({ conv, check, onAcceptAt, onTheWaitlist, onAddToWaitlist, onSuggest, note, compact }) {
  const d = conv.draftData;
  const r = check ? check.value : null;
  const line = r ? draftCheckLine(d, r) : null;
  const alts = r ? r.alts : [];
  const reason = replyReason(r);
  // The waitlist is for a party with no table, on a day the restaurant is open
  // at an hour it takes bookings.
  const offerWaitlist = !!(r && reason === "full" && onAddToWaitlist);
  const canSuggest = !!(onSuggest && reason && (alts.length || reason === "full"));
  const Mark = line ? (line.tone === "success" ? CheckIcon : AlertIcon) : null;
  function suggest() {
    onSuggest(availabilityReply(conv.language, {
      reason: reason, size: d.size, date: d.date, time: d.time, alts: alts,
      waitlist: reason === "full" ? (onTheWaitlist ? "added" : true) : false,
    }));
  }
  const row = { display: "flex", alignItems: "center", gap: SP.base, flexWrap: "wrap" };
  return (
    <>
      {/* Always mounted, so the answer is announced when it lands (a live
          region that arrives holding its message says nothing). */}
      <div role="status" className="mgt-sr-only">{line ? line.text + (offerWaitlist && onTheWaitlist ? ". On the waitlist." : "") : ""}</div>
      <Reveal show={!!(check && check.pending)}>
        <div style={{ display: "flex", alignItems: "center", gap: SP.base, fontSize: T.body, color: "var(--wa-draft-text-dim)", paddingBottom: compact ? 8 : 10 }}>
          <span aria-hidden="true" className="mgt-dot-pulse" style={{ width: 7, height: 7, borderRadius: R.pill, background: "var(--wa-draft-text-dim)", flexShrink: 0 }} />
          Checking the tables…
        </div>
      </Reveal>
      <Reveal show={!!line}>
        {line ? (
          <div style={Object.assign({}, row, { paddingBottom: compact ? 8 : 12 }, compact ? null : { flexDirection: "column", alignItems: "flex-start" })}>
            <div style={{ display: "flex", alignItems: "center", gap: SP.tight, fontSize: T.body, fontWeight: FW.semi, color: CHECK_INK[line.tone] }}>
              <Mark size={IC.control} />{line.text}
            </div>
            {alts.length ? (
              <div role="group" aria-label="Accept at another time" style={row}>
                <span style={{ fontSize: T.body, color: "var(--wa-draft-text-dim)" }}>Accept at:</span>
                {alts.map((t) => <TimeChip key={t} time={t} onPick={onAcceptAt} />)}
              </div>
            ) : null}
            {offerWaitlist || canSuggest ? (
              <div style={row}>
                {offerWaitlist ? (
                  // `aria-disabled`, never `disabled`: Chrome blurs a focused
                  // control that becomes disabled. `mgt-nopress` is the inert
                  // control's class, so the done state neither lifts nor dips.
                  <OutlineChip as="button" tone={onTheWaitlist ? "success" : "neutral"}
                    aria-disabled={onTheWaitlist ? "true" : undefined}
                    onClick={onTheWaitlist ? undefined : onAddToWaitlist}
                    className={onTheWaitlist ? "mgt-nopress" : "mgt-hover-scale mgt-press"}
                    style={Object.assign({}, CHECK_BTN, { minWidth: WAIT_W, justifyContent: "center" }, onTheWaitlist ? { cursor: "default" } : null)}>
                    {onTheWaitlist ? <CheckIcon size={IC.inline} /> : <WaitIcon size={IC.inline} />}
                    {onTheWaitlist ? "On the waitlist" : "Add to waitlist"}
                  </OutlineChip>
                ) : null}
                {canSuggest ? <OutlineChip as="button" tone="neutral" onClick={suggest} className="mgt-hover-scale mgt-press" style={CHECK_BTN} title="Put a reply in the box below, to read before sending">{alts.length ? "Suggest these" : "Suggest a reply"}</OutlineChip> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Reveal>
      <Reveal show={!!note}>
        <InlineAlert icon={WarnIcon} style={{ marginBottom: compact ? 8 : 12 }}>{note}</InlineAlert>
      </Reveal>
    </>
  );
}

export function DraftCard({ conv, onAccept, onDismiss, onDismissAcceptedBadge, compact, check, onAddToWaitlist, onTheWaitlist, onSuggest, tagList }) {
  // Compact-mode disclosure for the new_booking bar (notes / warning / confidence).
  // Declared before the early returns so the hook order stays stable.
  const [expanded, setExpanded] = useState(false);
  // v18.8.0 phase 8: a waitlist refusal (the phone), keyed to the conversation
  // it was for: this card is not remounted when the thread changes.
  const [noteState, setNoteState] = useState(null);
  const note = noteState && noteState.key === conv.phoneKey ? noteState.text : "";
  function addToWaitlist() {
    const refusal = onAddToWaitlist ? onAddToWaitlist() : null;
    setNoteState(refusal ? { key: conv.phoneKey, text: refusal } : null);
  }
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
      <AlertPanel
        role="success"
        icon={CheckIcon}
        title="Booking confirmed"
        style={{ marginBottom: 12, boxShadow: "var(--shadow-soft)" }}
        action={
          /* 32×32, the size every other banner dismiss in the app already is
             (LateBanner / OverlapBanner / WaitAvailBanner all sit at minHeight
             32). What this replaced was `padding:"2px 4px"` on a 12px glyph — a
             ~16px hit area, on a device that is only ever touched, for the only
             control on the notice. `--r-pill` clamps to half the SHORTER side,
             so equal width/height with padding:0 is what makes it an actual
             circle rather than a vertical egg. */
          <button
            onClick={() => { if (onDismissAcceptedBadge) onDismissAcceptedBadge(conv.phoneKey); }}
            title="Dismiss"
            aria-label="Dismiss this notice"
            className="mgt-hover-scale mgt-press"
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--success-text)", width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, opacity: 0.6, borderRadius: R.pill, flexShrink: 0 }}
          ><CloseIcon size={IC.control} /></button>
        }
      >
        <AlertRow first>This request has been added to the bookings list.</AlertRow>
      </AlertPanel>
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
  // v18.2.0 phase 72 (round 2's W6): the chip says what to DO with the draft —
  // it read "HIGH", the parser's level in capitals with nothing saying what a
  // level means. The level is kept as the tooltip, "High confidence".
  // `clampConfidence` only ever returns one of the three keys.
  const confSays = CONF_SAYS[conf];
  const confTitle = conf.charAt(0).toUpperCase() + conf.slice(1) + " confidence";
  // Seating preference suffix — only shown when the customer stated an area
  // (indoor/outdoor); "auto"/unset adds nothing (it's the default).
  const prefSuffix = (d.preference === "indoor" || d.preference === "outdoor")
    ? " · " + (d.preference === "indoor" ? "Indoor" : "Outdoor")
    : "";
  // v18.11.0: the name the message gave leads the full card's line, and the
  // occasions it named (`tagList`, the restaurant's labels) end it, so staff
  // see before Accept what the form will open with. A name the message did not
  // give is the conversation's own, already in the header above. The compact
  // bar is one line cut with an ellipsis, so there the name would push the time
  // and the occasion out of sight (/code-review): it takes `barSummary`, and
  // the name goes in the detail its tap opens (Patryk, 2026-10-18).
  const draftName = typeof d.name === "string" ? d.name.trim() : "";
  const occSuffix = tagLabels(tagList, "occasion", d.occasions).map(function (l) { return " · " + l; }).join("");
  const barSummary = (d.size != null ? guestsLabel(d.size) : "? guests") + " · " + (formatDay(d.date) || "? date") + " · " + (d.time || "? time") + prefSuffix + occSuffix;
  const summary = (draftName ? draftName + " · " : "") + barSummary;
  // Confidence is shown inline in the compact bar (always), so only notes /
  // ambiguity (and, since v18.11.0, the name) are "revealable" behind the toggle.
  const hasDetail = !!(d.notes || d.ambiguity || draftName);
  // The check block, the same in both shapes of the card. A time chip accepts
  // the request at that time; Accept itself opens the form at the time asked.
  // Keyed to the conversation: opening another thread REPLACES the card (its
  // summary swaps in one frame), so the last thread's answer must not fold
  // away under the new one's details, which it did for the ~130ms the new
  // check took (measured).
  const checkEl = (
    <DraftCheck
      key={conv.phoneKey}
      conv={conv} check={check} compact={compact}
      onAcceptAt={(time) => onAccept({ time })}
      onTheWaitlist={onTheWaitlist} onAddToWaitlist={onAddToWaitlist ? addToWaitlist : null}
      onSuggest={onSuggest} note={note}
    />
  );

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
          {/* The draft section itself is the toggle (when there's detail to show).
              v18.2.0 (the design critique, W1): it keeps its WHOLE width. It
              was `flex: 1; min-width: 0`, so on a phone the confidence chip,
              Accept and Dismiss took the line and squeezed the booking to
              "2 pax · 202…" — asking staff to accept a date and time they
              could not see. With a basis of its own content and no shrink,
              the row wraps instead: the details keep line one and the
              controls take line two, as ONE group pushed right — wrapping
              them one by one split Accept and Dismiss across the two lines
              (measured at 375px). Where everything fits it is still one line.
              `maxWidth` keeps the ellipsis as the last resort on a screen too
              narrow for even the details alone. */}
          <div
            onClick={hasDetail ? () => setExpanded((v) => !v) : undefined}
            title={hasDetail ? (expanded ? "Hide details" : "Show details") : undefined}
            style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 0 auto", maxWidth: "100%", minWidth: 0, cursor: hasDetail ? "pointer" : "default" }}
          >
            <span style={{ color: "var(--wa-draft-text)", display: "inline-flex", flexShrink: 0 }}><DraftIcon size={IC.control} /></span>
            <span style={{ fontSize: T.body, fontWeight: FW.semi, color: "var(--wa-draft-text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{barSummary}</span>
            {hasDetail ? <span style={{ color: "var(--wa-draft-text)", flexShrink: 0, display: "inline-flex", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform " + M.tap }}><ChevronRightIcon size={IC.inline} /></span> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0 }}>
          {/* Confidence level — always shown, immediately left of Accept. */}
          <OutlineChip title={confTitle} tone={confTone} size="small">{confSays}</OutlineChip>
          <button onClick={() => onAccept()} className="mgt-hover-scale mgt-press" style={smallBtn("var(--wa-btn-open)")}>Accept</button>
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
        </div>
        {/* v18.8.0 phase 8: the check, as one wrapping row under the bar. */}
        <div style={{ padding: "0 10px" }}>{checkEl}</div>
        {hasDetail ? (
          <Reveal show={expanded} style={{ padding: "0 10px" }}>
            <div style={{ paddingBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {draftName ? <div style={{ fontSize: T.body, color: "var(--wa-draft-text-dim)" }}>{"Name: " + draftName}</div> : null}
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
          {/* v18.0.0 phase 5: FW.medium, not semi. This is the caption NAMING the
              card; the parsed booking two lines down is what the eye is for, and
              a caption in a secondary colour at a primary weight is exactly the
              pairing v17.13.0's pass demoted 46 of. */}
          <span style={{ fontSize: T.body, fontWeight: FW.medium, color: "var(--wa-draft-text)" }}>Draft booking — parsed from message</span>
        </div>
        <OutlineChip title={confTitle} tone={confTone} size="small">{confSays}</OutlineChip>
      </div>
      <div style={{ fontSize: T.lead, color: "var(--wa-draft-text-dim)", lineHeight: 1.6, marginBottom: d.ambiguity ? 8 : 12 }}>
        <span style={{ fontWeight: FW.semi }}>{summary}</span>
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
      {checkEl}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => onAccept()}
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
