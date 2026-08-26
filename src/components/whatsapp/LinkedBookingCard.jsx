// src/components/whatsapp/LinkedBookingCard.jsx
// Compact teal card shown in the conversation header when the conversation is
// linked to a booking (acceptedBookingId). Collapsible per-conversation; when
// collapsed it shrinks to a one-line strip. Holds the single source of truth for
// the two booking actions — Open booking (blue) and Cancel booking (red).

import { Reveal, mkSolidBtn, OutlineChip } from "../atoms";
import { AlertPanel, AlertRow } from "../AlertPanel";
import { useCollapseState } from "../../hooks/useCollapseState";
import { BLOCK_BG, R, T, FW, M, IC, H } from "../../lib/constants";
import { LinkIcon } from "./WaIcons";
import { ChevronRightIcon } from "../Icons";

export function LinkedBookingCard({ booking, onOpen, onCancel, phoneKey, defaultCollapsed }) {
  const [collapsed, toggle] = useCollapseState(phoneKey, "linked", !!defaultCollapsed);
  if (!booking) return null;
  const statusColor = BLOCK_BG[booking.status] || BLOCK_BG.confirmed;
  const canCancel = booking.status !== "cancelled" && booking.status !== "completed";
  const summary = (booking.name || "(no name)") + " · " + (booking.date || "?") + " · " + booking.time + " · " + booking.size + " pax";

  // v15.8.2-wa-sandbox: the two booking actions moved up onto the header row
  // (before the chevron) instead of stacking vertically in the body, to reclaim
  // space. The group stops click-propagation so a button press never toggles the
  // collapse; the chevron stays last + flexShrink:0 so they can't collide.
  const actionBtns = (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      <button
        onClick={onOpen}
        className="mgt-hover-scale mgt-press"
        style={mkSolidBtn("var(--wa-btn-open)", { padding: "8px 14px", minHeight: H.chrome, fontSize: T.body, boxShadow: "var(--shadow-btn)", whiteSpace: "nowrap" })}
      >Open booking</button>
      {/* Secondary = OUTLINE in its own hue. A solid red pill next to a solid
          blue one made the destructive action compete with the safe one for the
          eye, and on the quietened green pane the pair read as two primaries
          bolted onto a background. Red outline still says danger — the hue is
          intact, only the fill is gone — while "Open booking" keeps the single
          saturated fill the accent rule reserves for the primary action. */}
      {/* v17.15.3: `OutlineChip`, not the shape typed out again. This was the
          atom written by hand — transparent fill, 2px pill, semantic ink — and
          it carried the exact fault the atom exists to prevent: the border came
          from `--danger-border` and the ink from `--danger-text`, two families
          never required to agree. Measured: in LIGHT that is rgba(252,165,165,
          .55), a pale pink ring, around #991b1b, a dark maroon; in DARK the two
          nearly converge. The same chip read as a different component per
          theme, which is what `--chip-danger-border` (color-mix from the ink at
          50%) exists to stop. Nothing scans for a chip that never imported the
          atom — DESIGN.md says so about the booking form's "Kitchen busy" chip,
          and this is the module's copy of that finding. The button geometry
          stays at the call site; only the ink/border DECISION moves. */}
      {canCancel ? (
        <OutlineChip
          as="button"
          tone="danger"
          onClick={onCancel}
          className="mgt-hover-scale mgt-press"
          style={{ padding: "8px 14px", minHeight: H.chrome, fontSize: T.body, fontWeight: FW.semi, whiteSpace: "nowrap" }}
        >Cancel booking</OutlineChip>
      ) : null}
    </div>
  );

  // Unified header + Reveal body (the app's Collapsible pattern) so the
  // collapse/expand eases instead of the strip ⇄ card swap snapping.
  // v17.8.0-wa-sandbox: the notification-pane idiom, in the WAITLIST palette.
  // This card was the module's last teal surface — a 0.10-alpha teal wash in a
  // teal rim, a hue the booking app does not otherwise use, sitting one line
  // under a green "Past bookings" panel and a green "Booking confirmed" notice.
  // The --wa-teal-* family is deleted: teal was a fourth green nobody had
  // registered, and a token whose NAME disagrees with its value is exactly how
  // a surface stays outside its own family's audit.
  // v17.15.3: the last pane in the module still wearing the v17.8.0 idiom —
  // soft tint plus a 1px NEUTRAL --border-card. Now that AlertPanel carries
  // both `action` and `onHeaderClick`, this card is the same shape as the
  // intent banner and takes the same atom, so every semantic pane in the module
  // is drawn by one component. The LinkIcon becomes the section mark and the
  // "Linked booking" label its title; the status chip and the collapsed summary
  // ride in the title node, since they belong to the heading rather than to the
  // controls. Behaviour is unchanged: the whole header is still the toggle.
  return (
    <AlertPanel
      role="success"
      icon={LinkIcon}
      onHeaderClick={toggle}
      style={{ marginBottom: 8, boxShadow: "var(--shadow-soft)" }}
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%" }}>
        <span style={{ fontSize: T.small, fontWeight: FW.semi, color: "var(--success-text)", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>Linked booking</span>
        <span style={{ fontSize: T.micro, padding: "2px 8px", borderRadius: R.pill, background: statusColor, color: "var(--text-on-accent)", fontWeight: FW.bold, textTransform: "capitalize", flexShrink: 0 }}>{booking.status}</span>
        {collapsed ? <span style={{ fontSize: T.body, color: "var(--text-primary)", fontWeight: FW.regular, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span> : null}
      </span>}
      action={<>
        {actionBtns}
        <span style={{ color: "var(--success-text)", flexShrink: 0, display: "inline-flex", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform " + M.tap }}><ChevronRightIcon size={IC.control} /></span>
      </>}
    >
      <Reveal show={!collapsed}>
        <AlertRow first>
          <div style={{ fontSize: T.body, color: "var(--text-primary)", fontWeight: FW.semi, marginBottom: 2 }}>{booking.name || "(no name)"}</div>
          <div style={{ fontSize: T.body, color: "var(--text-muted)" }}>{(booking.date || "?") + " · " + booking.time + " · " + booking.size + " pax" + (booking.tables && booking.tables.length ? " · tables " + booking.tables.join(", ") : "")}</div>
        </AlertRow>
      </Reveal>
    </AlertPanel>
  );
}
