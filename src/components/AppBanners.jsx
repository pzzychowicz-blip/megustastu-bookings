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
import { BTN, R, T, FW, H, SP } from "../lib/constants";

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

// v17.16.9 (CT-2A-07): what the "Couldn't save" section says when it is holding
// a PARKED write — one whose automatic retries ran out.
//
// The wording is the whole point of the fix, and the first draft of it was
// WRONG in a way only running the app showed. It said the change was "shown
// here but not saved to the server", from the finding's own account of the
// defect: an optimistic `setBookings` that nothing reverts. Measured live, the
// card had already snapped back to the saved value — `drainPending` is only
// ever called from the two places that have just set local state to server
// truth, in the same commit. So there is no divergence to describe; the change
// is simply GONE, which is why naming it matters more, not less. The old
// message was "Couldn't save a change after several attempts — please re-check
// and try again": no booking named, for a change the user had just watched
// disappear.
function parkedMessage(labels) {
  if (labels.length > 1) return labels.length + " changes were not saved and have been undone.";
  // A label can be null — `describeWrite` returns null for an empty diff, and a
  // booking whose name and time are both blank falls back to its id. Neither is
  // worth a worse sentence than "a change".
  return (labels[0] || "A change") + " — not saved, and undone.";
}

export function appBannerSections({ isOnline, writeWarning, onDismissWarning, parkedWrites, onRetryParked, onDiscardParked, ineffShow, onDismissIneff, onReshuffle, loadFailed, readError, hasConnected, dayClosed }) {
  const out = [];

  // v17.8.0 (strip audit): this used to be a floating TOAST. It is the one
  // message in that layer that is neither transient nor recoverable without a
  // reload — the toast layer shows one slot at a time and is meant for things
  // that pass. As the top-severity strip section it also sorts above everything
  // else, which is right: nothing below it is trustworthy if the read failed.
  if (loadFailed) out.push({
    id: "loadFail",
    // v17.15.0: was --status-offline, which is #ff3b30 in BOTH themes while
    // --danger-bg inverts — measured 3.03:1 in light and 4.31:1 in dark, i.e.
    // below AA and a 42% swing between themes. --danger-text flips with the
    // fill it sits on: 7.09:1 / 8.05:1. Same token the modal InlineAlert takes.
    tone: "var(--danger-text)", tint: "var(--danger-bg)",
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
  // v17.16.9: parked writes share this section with the red hard-failure banner
  // — same category, same mark, and the strip's tally is per SECTION, so a
  // second one would need a second icon to say anything (the `ClashIcon`
  // lesson).
  //
  // **They are two INDEPENDENT states and both can be live**, which the first
  // version of this got wrong: it rendered the parked message INSTEAD of
  // `writeWarning`, and swapped Dismiss for Retry/Discard, so a concurrent
  // warning was neither shown nor dismissable — it just reappeared later, out
  // of context, when the parked write was resolved. Concretely: a booking write
  // parks, then a `tableBlocks` write is rejected and calls `setWriteWarning`;
  // the block edit is lost and the app never says so. `writeWarning` has three
  // other callers (not loaded, empty-array refusal, blocks rejected), none of
  // them related to parking.
  //
  // So both lines render when both are set, the parked one first — it is the
  // one that persists and the one with actions — and Dismiss appears alongside
  // Retry/Discard whenever there is a warning to dismiss.
  const parked = parkedWrites || [];
  if (writeWarning || parked.length) out.push({
    id: "writeError",
    // v17.15.0: was --status-offline, which is #ff3b30 in BOTH themes while
    // --danger-bg inverts — measured 3.03:1 in light and 4.31:1 in dark, i.e.
    // below AA and a 42% swing between themes. --danger-text flips with the
    // fill it sits on: 7.09:1 / 8.05:1. Same token the modal InlineAlert takes.
    tone: "var(--danger-text)", tint: "var(--danger-bg)",
    icon: AlertIcon,
    title: "Couldn't save", count: parked.length || 1,
    node: body(
      <>
        <span style={{ flex: 1, minWidth: 0, color: "var(--danger-text)", display: "grid", gap: SP.tight }}>
          {parked.length ? <span>{parkedMessage(parked)}</span> : null}
          {writeWarning ? <span>{writeWarning}</span> : null}
        </span>
        {/* Retry takes the banner-primary orange every other in-flow banner
            uses for its act-on-this control (Reassign, Assign, No show).
            Discard keeps the neutral slate the Dismiss beside it has — and is
            deliberately NOT BTN.cancel, which in this app is red and means
            cancel the BOOKING. */}
        {parked.length ? (
          <button
            className="mgt-hover-scale"
            style={mkBtn({ fontSize: T.body, background: BTN.orange, minHeight: H.compact, padding: "4px 12px" })}
            onClick={onRetryParked}>Retry</button>
        ) : null}
        {parked.length ? (
          <button
            className="mgt-hover-scale"
            style={mkBtn({ fontSize: T.body, background: "var(--app-btn-slate-dim)", minHeight: H.compact, padding: "4px 12px" })}
            onClick={onDiscardParked}>Discard</button>
        ) : null}
        {writeWarning ? (
          <button
            className="mgt-hover-scale"
            style={mkBtn({ fontSize: T.body, background: "var(--app-btn-slate-dim)", minHeight: H.compact, padding: "4px 12px" })}
            onClick={onDismissWarning}>Dismiss</button>
        ) : null}
      </>
    )
  });

  if (!isOnline) out.push({
    id: "offline",
    // v17.15.2: was --status-offline, and it is the THIRD section to have worn
    // it. v17.15.0 measured that token on --danger-bg and corrected loadFail
    // and writeError; this sibling was two lines away and kept it, on a fill
    // that inverts the same way — 3.13:1 in light, 3.90:1 in dark, i.e. below
    // AA in EITHER theme rather than in one.
    //
    // It also painted the section HEADER red while this section's own body text
    // (below) was already --app-offline-text amber: two colours for one
    // message, in the one place the strip promises a section is headed on the
    // same terms as its body. --app-offline-text is the token made for this
    // fill and flips with it: 6.26:1 / 9.61:1.
    //
    // The connection DOT keeps --status-offline. That is not an inconsistency:
    // the dot sits on the neutral header, a surface that does not flip out from
    // under it, which is precisely the rule this change applies here.
    tone: "var(--app-offline-text)", tint: "var(--app-offline-bg)",
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
