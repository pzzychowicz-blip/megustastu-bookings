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
//  isOnline         — usePersistence connection flag (banner shows when false)
//  writeWarning     — string | null (the red hard-failure banner)
//  onDismissWarning — setWriteWarning(null)
//  ineffShow        — boolean: show the "could be reshuffled" suggestion
//  onDismissIneff   — setDismissedIneff(viewDate)
//  onReshuffle      — setConfirmReshuffle(true)

import { mkBtn } from "./atoms";
import { BTN, R } from "../lib/constants";

// A section body: the row under a section header. The dot and title live in the
// header the strip draws, so a one-line banner supplies only its sentence and
// its actions. Left padding lines the text up with the section titles above it
// (the strip's 14 + dot 8 + gap 9) rather than under the dot.
function body(children, extra) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 14px 11px 31px",
      fontSize: 13, fontWeight: 600,
      ...(extra || null)
    }}>
      {children}
    </div>
  );
}

export function appBannerSections({ isOnline, writeWarning, onDismissWarning, ineffShow, onDismissIneff, onReshuffle }) {
  const out = [];

  // The ⚠ glyphs are gone: the dot already says "attention", and a glyph plus a
  // coloured dot plus coloured text is three signals for one message.
  if (writeWarning) out.push({
    id: "writeError",
    tone: "var(--status-offline)", tint: "var(--danger-bg)",
    title: "Couldn't save", count: 1,
    node: body(
      <>
        <span style={{ flex: 1, minWidth: 0, color: "var(--danger-text)" }}>{writeWarning}</span>
        <button
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: 12, background: "var(--app-btn-slate-dim)", minHeight: 32, padding: "4px 12px" })}
          onClick={onDismissWarning}>Dismiss</button>
      </>
    )
  });

  if (!isOnline) out.push({
    id: "offline",
    tone: "var(--status-offline)", tint: "var(--app-offline-bg)",
    title: "Working offline", count: 1,
    node: body(
      <span style={{ color: "var(--app-offline-text)" }}>
        Your changes are saved locally and will sync when the connection returns. Keep this tab open.
      </span>
    )
  });

  if (ineffShow) out.push({
    id: "ineff",
    tone: "var(--warn-text)", tint: "var(--app-overlap-bg)",
    title: "Tables could be reshuffled", count: 1,
    node: body(
      <>
        <span style={{ flex: 1, minWidth: 0, color: "var(--warn-text)" }}>Moving some bookings would free up more capacity.</span>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}><button
          onClick={onDismissIneff}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: 13, minHeight: 36, padding: "6px 14px", background: BTN.dismiss })}>Dismiss</button><button
          onClick={onReshuffle}
          className="mgt-hover-scale"
          style={{ background: BTN.orange, color: "var(--text-on-accent)", border: "1px solid var(--border-glass)", borderRadius: R.pill, padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, minHeight: 36, boxShadow: "var(--shadow-btn)" }}>Reshuffle</button></div>
      </>
    , { flexWrap: "wrap" })
  });

  return out;
}
