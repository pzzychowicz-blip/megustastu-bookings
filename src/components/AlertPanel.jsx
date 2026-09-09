// ── AlertPanel — a notification-strip section with a TITLE and rows ──────────
// v17.15.2. `InlineAlert` (atoms.jsx) is the strip's section shape for a single
// sentence; this is the same shape for a titled LIST. Between them, every
// semantic notice in the app — main screen or modal, one line or many — is
// drawn the same way.
//
// ── The shape it replaces ────────────────────────────────────────────────────
// Eight panes were built as a pale semantic fill PLUS a border in the matching
// hue PLUS bold text in a third shade of it. DESIGN.md bans that outright and
// names it: it encodes one signal three times and is the stock badge every
// framework ships. v17.15.0 removed three copies of it with `InlineAlert` and
// recorded the instruction this file discharges.
//
// `BlockModal` was the worst of them and shows why a titled list needed its own
// component rather than N `InlineAlert`s: it drew ONE CARD PER BLOCK, each with
// its own fill, its own border and its own 8px margin — precisely the "N panes
// with N margins" that `NotificationStrip` exists to collapse, reproduced
// inside a modal where the strip could not see it.
//
// ── What it renders ──────────────────────────────────────────────────────────
// Exactly what `NotificationStrip` renders for one section, and every value is
// taken from that file rather than re-chosen here:
//
//   • a tinted pane, `R.card`, and NO border — the tint carries the semantics
//   • a header: the mark in `tone` at `IC.control`, the title in `tone` at
//     T.body/FW.bold, and an optional count in the strip's own dimmed style
//   • rows: transparent, separated by hairlines, indented to NOTIF_GUTTER so
//     row text starts under the TITLE rather than under the mark
//
// NOTIF_GUTTER / NOTIF_PAD_X are imported, never re-derived. That is the same
// contract `AppBanners` and `BannerRows` sign, and it exists because the number
// was once hard-coded as 31 here and there and went stale the day the mark
// became an icon.
//
// ── Why this is not in atoms.jsx ─────────────────────────────────────────────
// `NotificationStrip` imports from atoms, so an atom importing the strip's
// geometry is a cycle. `InlineAlert` lives with that constraint and says so at
// its own site (it approximates the mark-to-text gap with `SP.base` rather than
// importing NOTIF_GAP). A component file has no such problem, so this one takes
// the real numbers — which is also why `AvailBanner` moved out of atoms.jsx in
// the same commit: it is one of the eight panes and needed this.
//
// ── Why this is not BannerRows, and when a caller still needs its hook ───────
// `BannerRows` is bound to `useRevealRows` AND owns the strip's row geometry.
// This component owns only the geometry, which is what makes it usable for
// both kinds of list — the lifecycle is the caller's decision, taken per pane:
//
//   • Rows that only ever appear and disappear WITH the whole panel — a
//     guest's past visits, a no-show history, the alternatives under
//     "no tables available" — need nothing. The `Reveal` around the panel
//     animates them, and attaching a per-item lifecycle to a list that is only
//     ever shown or hidden whole is the mistake CLAUDE.md records from the
//     notification strip's date change, in miniature.
//   • Rows that depart IN PLACE while the surface stays open take
//     `useRevealRows` themselves. `BlockModal` is the one such pane: Unblock
//     removes a row with the modal still on screen. See its call site for the
//     two things that come with the hook — hold the departed row mounted so its
//     `Reveal` can collapse, and compute `first` from the rows actually OPEN
//     (`i < 1`), or the departing row is handed the hairline this component
//     exists to withhold.
//
// (v17.15.2 first shipped this header asserting the first bullet for ALL of
// them, `BlockModal` included, and was corrected in the same version.)
//
// Props:
//   role     — a key of ALERT_TONES ("danger" | "warn" | "success" | "offline").
//              Supplies BOTH tone and tint, so the pairing cannot be got wrong.
//   tone/tint — explicit overrides, for a pane whose fill is not its role's
//              default (the strip's warn sections sit on --app-overlap-bg).
//   icon     — a component, not an element (it is rendered at IC.control here).
//   title    — the section heading. Omit it for a pane that is only rows.
//   count    — optional; rendered in the strip's dimmed count style.
//   action   — optional trailing node in the HEADER row: a dismiss, a pair of
//              buttons, a collapse chevron. Defaults to nothing, so a pane that
//              does not pass it renders byte-for-byte as before.
//              It exists because a titled pane whose header carries controls
//              was otherwise forced to stay hand-written, and a hand-written
//              pane is the thing this file was created to end — the module's
//              two such panes were the last copies of the v17.8.0 idiom left.
//              The strip's own sections already work this way (BannerRows puts
//              a per-row dismiss last), so this is that arrangement one level
//              up rather than a new idea.
//   onHeaderClick — optional; makes the header row a collapse toggle. It comes
//              with `action`, not instead of it: the module's intent banner is
//              a titled pane whose header carries BOTH controls and a chevron,
//              and converting it without this would have deleted an affordance
//              inside a design refactor, which is the one thing a refactor may
//              not do. Deliberately a plain onClick and NOT role="button":
//              `action` renders controls inside this row, and ARIA makes a
//              button's children presentational — the trap CLAUDE.md records
//              from the timeline block. A caller wanting a keyboard-reachable
//              toggle puts it in `action` as a real <button>.
//   children — the rows. Wrap each in <AlertRow> to get the hairline.

import { ALERT_TONES } from "./atoms";
import { NOTIF_GUTTER, NOTIF_PAD_X } from "./NotificationStrip";
import { R, T, FW, IC, SP } from "../lib/constants";

// One row. The hairline lives HERE and not on the caller's content, so every
// pane separates its rows identically and a row stays pure content — the same
// division `BannerRows` makes. `first` keeps the line off the top row, whose
// separation from the header is already the header's padding.
export function AlertRow({ first, style, children }) {
  return (
    <div style={{
      padding: "4px " + NOTIF_PAD_X + "px 4px " + NOTIF_GUTTER + "px",
      fontSize: T.body, color: "var(--text-primary)",
      ...(first ? null : { borderTop: "1px solid var(--border-soft)" }),
      ...(style || null)
    }}>{children}</div>
  );
}

export function AlertPanel({ role = "danger", tone, tint, icon: Icon, title, count, action, onHeaderClick, style, children }) {
  const t = ALERT_TONES[role] || ALERT_TONES.danger;
  const ink = tone || t.tone;
  const fill = tint || t.tint;
  return (
    <div style={{
      background: fill, borderRadius: R.card,
      paddingTop: title ? 10 : 4, paddingBottom: 8,
      ...(style || null)
    }}>
      {title ? (
        <div onClick={onHeaderClick} style={{
          display: "flex", alignItems: "center", gap: SP.base,
          padding: "0 " + NOTIF_PAD_X + "px", marginBottom: 6,
          ...(onHeaderClick ? { cursor: "pointer", flexWrap: "wrap" } : null)
        }}>
          {/* Guarded on the prop rather than rendered bare: this eslint config
              does not count a JSX reference as a use, so a component read ONLY
              as `<Icon />` reports as unused — the trap `InlineAlert` documents
              at its own site. The guard is worth having anyway: a pane with no
              icon should render no hole. */}
          {Icon ? (
            <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", color: ink, flexShrink: 0 }}>
              <Icon size={IC.control} />
            </span>
          ) : null}
          <span style={{ fontSize: T.body, fontWeight: FW.bold, color: ink, flex: 1, minWidth: 0 }}>{title}</span>
          {count > 1 ? (
            <span style={{ fontSize: T.small, fontWeight: FW.bold, color: ink, opacity: 0.75, flexShrink: 0 }}>{count}</span>
          ) : null}
          {/* Last in the row and flexShrink:0, matching where every dismiss in
              the notification system already sits. `action` is a NODE rather
              than a set of props because what goes here differs per pane — one
              button, two, or a chevron — and enumerating those would put the
              caller's layout decisions in this file. */}
          {action ? <span style={{ display: "inline-flex", alignItems: "center", gap: SP.tight, flexShrink: 0 }}>{action}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
