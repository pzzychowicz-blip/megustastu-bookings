// src/components/whatsapp/IntentBanner.jsx
// Alert banner above the thread when the latest message is classified cancel
// (red/danger) or modify (orange/warn). Alert-only — the booking actions live in
// LinkedBookingCard. Collapsible (defaults expanded, since it's an alert); the
// "✓ Mark as handled" button (teal) dismisses it until a new request arrives —
// with a 300ms fade (§7 decision 2026-06-13) so the dismissal reads as a
// deliberate action, not a glitch. The fade is click-local: the auto-handled
// path (cancelling the linked booking) unmounts the banner from the parent,
// which is fine — the conversation isn't on screen during that flow.

import { useState } from "react";
import { Reveal, mkSolidBtn } from "../atoms";
import { AlertPanel, AlertRow } from "../AlertPanel";
import { useCollapseState } from "../../hooks/useCollapseState";
import { R, T, FW, M, IC, H, EXIT_MS } from "../../lib/constants";
import { WarnIcon, PencilIcon } from "./WaIcons";
import { CheckIcon, ChevronRightIcon } from "../Icons";

export function IntentBanner({ intent, linkedBooking, phoneKey, draftData, onMarkHandled, onApplyChanges }) {
  const [collapsed, toggle] = useCollapseState(phoneKey, "intent", false);
  const [leaving, setLeaving] = useState(false); // fade-out in progress
  if (intent !== "cancel" && intent !== "modify") return null;
  const isCancel = intent === "cancel";
  const isModify = intent === "modify";
  // Parsed requested changes (modify) — same draftData the new-booking flow uses,
  // so the staff can apply them in one click (onApplyChanges).
  const reqParts = [];
  if (isModify && draftData) {
    if (draftData.size != null) reqParts.push(draftData.size + " pax");
    if (draftData.date) reqParts.push(draftData.date);
    if (draftData.time) reqParts.push(draftData.time);
    if (draftData.preference === "indoor" || draftData.preference === "outdoor") reqParts.push(draftData.preference === "indoor" ? "Indoor" : "Outdoor");
  }
  const showApply = isModify && linkedBooking && onApplyChanges && reqParts.length > 0;
  // Notifications are ONE surface: a soft semantic TINT at pane scale — not the
  // chip-scale --danger-bg/--warn-bg this wore before v17.8.0 — with the hue
  // carried by the mark and the text. The shape before that was a 2px ring in
  // the semantic hue around a saturated wash, the bolted-on alert box the sweep
  // removed app-wide, which at banner size outshouted every real warning.
  // v17.15.3 finished the move: the 1px neutral --border-card is gone too, so
  // the tint carries the semantics unaided, and R.card now comes from
  // AlertPanel rather than being restated here.
  const bg = isCancel ? "var(--danger-bg-soft)" : "var(--app-overlap-bg)";
  const color = isCancel ? "var(--danger-text)" : "var(--warn-text)";
  const Icon = isCancel ? WarnIcon : PencilIcon;
  const title = isCancel ? "Customer is requesting to cancel" : "Customer is requesting changes";
  const subtitle = linkedBooking ? ("Linked to: " + (linkedBooking.date || "?") + " · " + linkedBooking.time + " · " + linkedBooking.size + " pax") : "No linked booking found";

  // v15.8.2-wa-sandbox: action buttons moved up onto the header row (between the
  // title and the chevron) to reclaim the vertical space they took as their own
  // line. The button group stops click-propagation so pressing a button never
  // toggles the collapse; the chevron stays last and flexShrink:0 so the buttons
  // can't collide with it (they wrap under the title on narrow widths).
  const actionBtns = (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      {showApply ? (
        <button
          onClick={() => { if (onApplyChanges) onApplyChanges(); }}
          title="Open the booking pre-filled with the requested changes"
          className="mgt-hover-scale mgt-press"
          style={mkSolidBtn("var(--wa-btn-open)", { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 14px", minHeight: H.chrome, fontSize: T.body, boxShadow: "var(--shadow-btn)", whiteSpace: "nowrap" })}
         ><PencilIcon size={IC.inline} />Apply changes</button>
      ) : null}
      <button
        onClick={() => {
          if (leaving) return; // ignore re-clicks during the fade
          setLeaving(true);
          // 17.15.0-wa-sandbox: EXIT_MS, not a typed 300. The banner fades on
          // `M.exit` (--t-move) and this is the hold that keeps it mounted long
          // enough to finish — two halves of one fact in two languages, which
          // is the pairing v17.15.0 found wrong in six places at once. A hold
          // shorter than its animation does not LOOK broken: the fade plays
          // part way and the node blinks out at whatever opacity it reached.
          setTimeout(() => { if (onMarkHandled) onMarkHandled(); }, EXIT_MS);
        }}
        title="Mark this request as handled"
        className="mgt-hover-scale mgt-press"
        style={mkSolidBtn("var(--wa-btn-handled)", { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 14px", minHeight: H.chrome, cursor: leaving ? "default" : "pointer", fontSize: T.body, boxShadow: "var(--shadow-btn)", whiteSpace: "nowrap" })}
      ><CheckIcon size={IC.inline} />Mark as handled</button>
    </div>
  );

  // Unified header + Reveal body (the app's Collapsible pattern): the alert
  // header stays put and the details ease open/closed instead of the
  // collapsed-strip ⇄ full-card swap snapping the layout.
  // v17.15.3: the pane and its header are `AlertPanel` now. This was the last
  // copy of the v17.8.0 idiom in the module — soft tint plus a 1px NEUTRAL
  // --border-card — which was never the BANNED shape but is one release behind
  // v17.15.2's section, which carries no border at all and lets the tint carry
  // the semantics on its own.
  //
  // It passes `tone`/`tint` rather than a role, which is the override the atom
  // documents for "a pane whose fill is not its role's default": a modify
  // request sits on --app-overlap-bg, exactly as the strip's own warn sections
  // do, so it stays the same KIND of surface as a running-late warning and
  // differs only in hue.
  //
  // The whole header stays the collapse toggle (`onHeaderClick`) — dropping
  // that to a chevron-only hit target would be a behaviour change smuggled into
  // a design refactor. The opacity fade and its EXIT_MS hold stay on the
  // wrapper, since they are about this banner LEAVING, not about the section.
  return (
    <AlertPanel
      tone={color}
      tint={bg}
      icon={Icon}
      title={title}
      onHeaderClick={toggle}
      style={{ marginBottom: 10, boxShadow: "var(--shadow-soft)", opacity: leaving ? 0 : 1, transition: "opacity " + M.exit }}
      action={<>
        {actionBtns}
        <span style={{ color, flexShrink: 0, display: "inline-flex", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform " + M.tap }}><ChevronRightIcon size={IC.control} /></span>
      </>}
    >
      <Reveal show={!collapsed}>
        <AlertRow first>
          <div style={{ color, opacity: 0.85 }}>{subtitle}</div>
          {showApply ? <div style={{ color, fontWeight: FW.semi, marginTop: 4 }}>{"Requested: " + reqParts.join(" · ")}</div> : null}
        </AlertRow>
      </Reveal>
    </AlertPanel>
  );
}
