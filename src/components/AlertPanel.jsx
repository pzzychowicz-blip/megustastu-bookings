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
// ── Why this is not BannerRows ───────────────────────────────────────────────
// `BannerRows` is bound to `useRevealRows`, an arrival/departure lifecycle for
// rows that come and go while you watch. These lists are static — a block list,
// a guest's past visits — and already sit inside a `Reveal` that animates the
// whole panel. Pointing a per-item lifecycle at a list that is only ever shown
// or hidden WHOLE is the mistake CLAUDE.md records from the notification
// strip's date change, in miniature.
//
// Props:
//   role     — a key of ALERT_TONES ("danger" | "warn" | "success" | "offline").
//              Supplies BOTH tone and tint, so the pairing cannot be got wrong.
//   tone/tint — explicit overrides, for a pane whose fill is not its role's
//              default (the strip's warn sections sit on --app-overlap-bg).
//   icon     — a component, not an element (it is rendered at IC.control here).
//   title    — the section heading. Omit it for a pane that is only rows.
//   count    — optional; rendered in the strip's dimmed count style.
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

export function AlertPanel({ role = "danger", tone, tint, icon: Icon, title, count, style, children }) {
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
        <div style={{
          display: "flex", alignItems: "center", gap: SP.base,
          padding: "0 " + NOTIF_PAD_X + "px", marginBottom: 6
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
        </div>
      ) : null}
      {children}
    </div>
  );
}
