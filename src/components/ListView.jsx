// src/components/ListView.jsx
// List-view rendering of the day's bookings — sorted by status (seated first,
// then confirmed, completed, cancelled), then by time. Each booking renders
// as a card with name, status badge, party size, time range, table chips,
// optional notes, and action buttons (Tables / Edit / Delete + status changers).
//
// Pure presentational, no hooks. All state lives in BookingApp.
//
// The "live duration" tag (only on seated bookings) shows actual elapsed
// minutes since seating (min 15) — this is separate from the end-time label,
// which is pinned to the scheduled plan until a guest overstays. See the
// inline comments preserved from v14 p1 inside the map for the original
// design rationale.
//
// Phase B4 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Behaviour, output markup, and all inline styles are byte-identical to the
// original.
//
// Phase C1 (v15-refactor): `statusOrder` moved to booking-logic.js. The
// inline `liveDur` / `elapsedMin` calculations stay here — they have
// different semantics from TimelineView's `liveBarDur` (end-time pinned to
// plan vs live bar width) and aren't shared.

import { S, BLOCK_BG, STATUS_COLORS, BTN } from "../lib/constants";
import { toMins, toTime, isLocked, statusOrder } from "../lib/booking-logic";
import { SmallTag, SBadge, TBadge, mkBtn } from "./atoms";

export function ListView({
  bookings, date, onEdit, onStatus, onDelete, onManual,
  nowMins = 0, warnings = {}
}) {
  const day = bookings
    .filter((b) => b.date === date)
    .sort((a, b) => {
      const sa = statusOrder(a.status);
      const sb = statusOrder(b.status);
      if (sa !== sb) return sa - sb;
      return a.time.localeCompare(b.time);
    });

  if (!day.length) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: S.text, fontSize: 15 }}>
        No bookings for this date.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {day.map((b) => {
        // v14 p1 (Issue 2 fix): end-time label is pinned to the scheduled plan
        // (time + duration) while the guest is within plan; once they overstay,
        // syncLiveDurations bumps b.duration to elapsed and the label starts
        // tracking live time from that moment on.
        // v14 p1 follow-up: the duration TAG is separate from end-time — it
        // shows actual minutes since seating (live, min 15) so staff can see
        // how long the party has been at the table regardless of the planned end.
        const elapsedMin = b.status === "seated" ? Math.max(15, nowMins - toMins(b.time)) : 0;
        const liveDur = b.status === "seated" ? Math.max(elapsedMin, b.duration || 90) : b.duration;
        const end = toTime(toMins(b.time) + liveDur);
        const warn = warnings[b.id];
        const sc = STATUS_COLORS[b.status];
        const useStatusColor = b.status === "seated" || b.status === "completed" || b.status === "cancelled";
        const cardBg = useStatusColor ? "var(--bg-card-dim)" : "var(--bg-card-strong)";
        const cardBrd = warn
          ? (warn.overdue ? "var(--card-overdue-border)" : "var(--card-warn-border)")
          : b._conflict
            ? "var(--card-conflict-border)"
            : useStatusColor ? sc.border : "var(--border-card-plain)";
        const cardBrdW = warn ? "3px" : useStatusColor ? "3px" : "1px";

        const durationTag = b.status === "seated" ? (
          <SmallTag label={elapsedMin + " min"} style={{ background: "#166534", color: "var(--text-on-accent)", border: "none" }} />
        ) : null;

        const warnEl = warn ? (
          <div style={{
            fontSize: 13, fontWeight: 700, marginBottom: 8,
            padding: "6px 10px", borderRadius: 12,
            background: warn.overdue ? "var(--danger-bg)" : "var(--warn-bg)",
            color: warn.overdue ? "var(--danger-text)" : "var(--warn-text)",
            border: "2px solid " + (warn.overdue ? "var(--danger-border)" : "var(--warn-border)")
          }}>
            {warn.overdue
              ? "Overdue — next booking (" + warn.next + ") at " + warn.nextTime + " is waiting"
              : "Next booking (" + warn.next + ") at " + warn.nextTime + " in " + warn.gap + " min"}
          </div>
        ) : null;

        const conflictEl = (b._conflict && b.status !== "completed") ? (
          <div style={{
            fontSize: 13, color: "var(--danger-text)", fontWeight: 700, marginBottom: 8,
            background: "var(--danger-bg)",
            border: "2px solid var(--danger-border)",
            borderRadius: 12, padding: "6px 10px"
          }}>
            No table assigned — use manual assignment.
          </div>
        ) : null;

        const manualTag = (b._manual && !isLocked(b)) ? (
          <SmallTag label="manual" style={{ background: "#0369a1", color: "var(--text-on-accent)", border: "none" }} />
        ) : null;
        const lockedTag = b._locked ? (
          <SmallTag label="locked" style={{ background: "#854d0e", color: "var(--text-on-accent)", border: "none" }} />
        ) : null;
        const prefTag = (b.preferredTables && b.preferredTables.length > 0) ? (
          <SmallTag label={"★ " + b.preferredTables.join("+")} style={{ background: "#0d9488", color: "var(--text-on-accent)", border: "none" }} />
        ) : null;

        const notesEl = b.notes ? (
          <div style={{
            fontSize: 13, color: S.text,
            borderTop: "0.5px solid " + S.border,
            paddingTop: 8, marginTop: 8
          }}>
            {b.notes}
          </div>
        ) : null;

        const phonEl = b.phone ? (
          <span style={{ fontSize: 13, color: S.text, marginLeft: 4 }}>{b.phone}</span>
        ) : null;

        const statusBtns = ["confirmed", "seated", "completed", "cancelled"]
          .filter((s) => s !== b.status)
          .map((s) => (
            <button
              key={s}
              className="mgt-hover-scale"
              style={mkBtn({ background: BLOCK_BG[s], textTransform: "capitalize" })}
              onClick={() => onStatus(b.id, s)}
            >
              {"> " + s}
            </button>
          ));

        return (
          <div
            key={b.id}
            className="mgt-hover-scale"
            style={{
              background: cardBg,
              border: cardBrdW + " solid " + cardBrd,
              borderRadius: 16, padding: "14px 16px",
              opacity: (b.status === "completed" || b.status === "cancelled") ? 0.75 : 1,
              boxShadow: "var(--shadow-card)"
            }}
          >
            {conflictEl}
            {warnEl}
            <div style={{
              display: "flex", alignItems: "flex-start", justifyContent: "space-between",
              flexWrap: "wrap", gap: 8
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: S.text }}>{b.name}</span>
                <SBadge status={b.status} />
                <span style={{ fontSize: 13, color: S.text, fontWeight: 700 }}>{b.size + " pax"}</span>
                {manualTag}
                {lockedTag}
                {prefTag}
                {durationTag}
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: S.text }}>{b.time + "–" + end}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              {(b.tables || []).map((t) => <TBadge key={t} id={t} />)}
              {phonEl}
            </div>
            {notesEl}
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button className="mgt-hover-scale" style={mkBtn({ background: BTN.tables })} onClick={() => onManual(b.id)}>= Tables</button>
              <button className="mgt-hover-scale" style={mkBtn({ background: BTN.edit })} onClick={() => onEdit(b)}>Edit</button>
              <button className="mgt-hover-scale" style={mkBtn({ background: BTN.del })} onClick={() => onDelete(b.id)}>Delete</button>
              {statusBtns}
            </div>
          </div>
        );
      })}
    </div>
  );
}
