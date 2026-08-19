// ── AppBanners ───────────────────────────────────────────────────────────────
// v17.3.4: extracted VERBATIM from App.jsx (de-monolith extraction #2 — the
// v15.8.0 "Notification layout" in-flow family): the three PERSISTENT simple
// banners, offline / write-error / inefficiency.
//
// v17.8.0: they are no longer three panes with three margins. NotificationStrip
// owns the one pane every notification shares, so this file now yields SECTIONS
// for it — `{ id, tone, tint, title, count, node }` — and each `node` is just
// the section's body. Everything visible is otherwise the same content.
//
// It exports a FUNCTION rather than a component on purpose. The strip needs the
// tone, title and count of each section as DATA (to build its collapsed
// one-line summary and to order by severity); a component could only hand back
// opaque JSX, and App would have had to duplicate the same facts alongside it.
//
// All STATE stays in BookingApp (the Phase D3 locked decision). `ineffShow` is
// computed in App (it reads reshuffled / inefficient / dismissedIneff /
// optimizerActiveFor / the Settings master switch) and passed as a boolean.
//
// Props (unchanged):
// Each section also carries an `icon` (a component, not an element) — the strip
// renders it in place of the old semantic dot and again in its collapsed
// per-category summary, so it has to be re-renderable at two sizes.
//
//  isOnline         — usePersistence connection flag (banner shows when false)
//  writeWarning     — string | null (the red hard-failure banner)
//  onDismissWarning — setWriteWarning(null)
//  ineffShow        — boolean: show the "could be reshuffled" suggestion
//  onDismissIneff   — setDismissedIneff(viewDate)
//  onReshuffle      — setConfirmReshuffle(true)

import { mkBtn } from "./atoms";
import { AlertIcon, OfflineIcon, SwapIcon, ClosedIcon } from "./Icons";
import { NOTIF_GUTTER, NOTIF_PAD_X } from "./NotificationStrip";
import { BTN, R, T, FW } from "../lib/constants";

// A section body: the row under a section header. The mark and title live in the
// header the strip draws, so a one-line banner supplies only its sentence and
// its actions. NOTIF_GUTTER lines the text up with the section titles above it
// rather than under the mark — imported from the strip, never re-derived here
// (v17.8.0 fix: this was a hard-coded 31 that went stale the day the mark
// became an icon).
function body(children, extra) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px " + NOTIF_PAD_X + "px 10px " + NOTIF_GUTTER + "px",
      fontSize: T.body, fontWeight: FW.semi,
      ...(extra || null)
    }}>
      {children}
    </div>
  );
}

export function appBannerSections({ isOnline, writeWarning, onDismissWarning, ineffShow, onDismissIneff, onReshuffle, loadFailed, readError, hasConnected, dayClosed }) {
  const out = [];

  // v17.8.0 (strip audit): this used to be a floating TOAST. It is the one
  // message in that layer that is neither transient nor recoverable without a
  // reload — the toast layer shows one slot at a time and is meant for things
  // that pass. As the top-severity strip section it also sorts above everything
  // else, which is right: nothing below it is trustworthy if the read failed.
  if (loadFailed) out.push({
    id: "loadFail",
    tone: "var(--status-offline)", tint: "var(--danger-bg)",
    icon: AlertIcon,
    title: "Couldn't load bookings", count: 1,
    node: body(
      <>
        <span style={{ flex: 1, minWidth: 0, fontWeight: FW.medium, color: "var(--text-primary)" }}>
          {readError
            ? "The server refused the read (" + readError.code + " on /" + readError.path + ")."
            : hasConnected
              ? "Connected, but no data has arrived."
              : "Can\u2019t reach the server \u2014 no connection has been established."}
        </span>
        <button
          onClick={function () { window.location.reload(); }}
          className="mgt-hover-scale mgt-press"
          style={mkBtn({ background: BTN.today, fontSize: T.body, padding: "4px 12px", minHeight: 32 })}>Reload</button>
      </>
    , { flexWrap: "wrap" })
  });

  // The ⚠ glyphs are gone: the dot already says "attention", and a glyph plus a
  // coloured dot plus coloured text is three signals for one message.
  if (writeWarning) out.push({
    id: "writeError",
    tone: "var(--status-offline)", tint: "var(--danger-bg)",
    icon: AlertIcon,
    title: "Couldn't save", count: 1,
    node: body(
      <>
        <span style={{ flex: 1, minWidth: 0, color: "var(--danger-text)" }}>{writeWarning}</span>
        <button
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: T.body, background: "var(--app-btn-slate-dim)", minHeight: 32, padding: "4px 12px" })}
          onClick={onDismissWarning}>Dismiss</button>
      </>
    )
  });

  if (!isOnline) out.push({
    id: "offline",
    tone: "var(--status-offline)", tint: "var(--app-offline-bg)",
    icon: OfflineIcon,
    title: "Working offline", count: 1,
    node: body(
      <span style={{ color: "var(--app-offline-text)" }}>
        Your changes are saved locally and will sync when the connection returns. Keep this tab open.
      </span>
    )
  });

  // v17.8.0 (strip audit): the closed-day notice was drawn separately inside
  // TimelineView (over the grid) and PlanView, and List showed nothing at all —
  // three views, two implementations, one of them missing. It is a persistent
  // fact about the viewed DAY, which is exactly what this strip is for, and the
  // same argument that moved the search/settings pair into one shared row.
  // Sits below the app-failure sections and above the operational ones: on a
  // closed day it explains why everything else is empty.
  if (dayClosed) out.push({
    id: "closed",
    tone: "var(--warn-text)", tint: "var(--app-overlap-bg)",
    icon: ClosedIcon,
    title: "Closed this day", count: 1,
    node: body(
      <span style={{ color: "var(--warn-text)" }}>
        No bookings or walk-ins can be saved for this date. Adjust it in Settings → Opening hours.
      </span>
    )
  });

  if (ineffShow) out.push({
    id: "ineff",
    tone: "var(--warn-text)", tint: "var(--app-overlap-bg)",
    // SwapIcon, reused from the split-view toolbar: the suggestion IS a swap.
    icon: SwapIcon,
    title: "Tables could be reshuffled", count: 1,
    node: body(
      <>
        <span style={{ flex: 1, minWidth: 0, color: "var(--warn-text)" }}>Moving some bookings would free up more capacity.</span>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}><button
          onClick={onDismissIneff}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: T.body, minHeight: 36, padding: "6px 14px", background: BTN.dismiss })}>Dismiss</button><button
          onClick={onReshuffle}
          className="mgt-hover-scale"
          style={{ background: BTN.orange, color: "var(--text-on-accent)", border: "1px solid var(--border-glass)", borderRadius: R.pill, padding: "6px 14px", cursor: "pointer", fontSize: T.body, fontWeight: FW.semi, minHeight: 36, boxShadow: "var(--shadow-btn)" }}>Reshuffle</button></div>
      </>
    , { flexWrap: "wrap" })
  });

  return out;
}
