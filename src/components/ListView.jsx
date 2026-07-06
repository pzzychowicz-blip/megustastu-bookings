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
//
// v15.1.0: completed + cancelled cards moved behind a controlled Collapsible
// ("Completed & cancelled"), collapsed by default for a cleaner day view.
// The open state (`showFinished`) lives in BookingApp — NOT here — so the
// List keyboard model (↑/↓ over listDaySorted + per-card shortcuts) can
// exclude the hidden cards while the disclosure is closed. The card JSX is
// unchanged, just hoisted into renderCard() so both groups share it.

import { useEffect, useState } from "react";
import { S, BLOCK_BG, STATUS_COLORS, BTN } from "../lib/constants";
import { toMins, toTime, isLocked, statusOrder } from "../lib/booking-logic";
import { noShowMap, normalizePhone } from "../lib/customers";
import { SmallTag, SBadge, TBadge, mkBtn, Collapsible, useFlip } from "./atoms";

// v15.8.0: module-level status-change detection (mirrors TimelineView) so a card
// that changes status plays a colour wipe of its OLD status colour. Keyed by id,
// expires by timestamp; single list on screen so module scope is safe.
let __listPrev = null;
const __listAnims = {};

export function ListView({
  bookings, date, onEdit, onStatus, onDelete, onManual,
  nowMins = 0, warnings = {},
  late = {}, onNoShow = () => {},
  selectedId = null, onSelect = () => {},
  showFinished = false, onToggleFinished = () => {}
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

  // statusOrder already sorts completed/cancelled last, so splitting here
  // preserves the exact visual order the inline list had.
  const active = day.filter((b) => b.status !== "completed" && b.status !== "cancelled");
  const finished = day.filter((b) => b.status === "completed" || b.status === "cancelled");

  // v15.8.0: detect status changes → stamp a wipe of the OLD colour; FLIP the
  // active list so a re-sorted card eases to its new position instead of jumping.
  const [, bumpAnim] = useState(0);
  useEffect(function () {
    const prev = __listPrev;
    const now = Date.now();
    if (prev) {
      let changed = false;
      day.forEach(function (b) {
        const p = prev[b.id];
        // v15.9.0: window 700→800ms so it outlives the slowed 760ms wipe keyframe.
        if (p && p !== b.status) { __listAnims[b.id] = { from: p, until: now + 800 }; changed = true; }
      });
      if (changed) { bumpAnim(function (n) { return n + 1; }); setTimeout(function () { bumpAnim(function (n) { return n + 1; }); }, 820); }
    }
    const m = {};
    day.forEach(function (b) { m[b.id] = b.status; });
    __listPrev = m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings]);
  function listAnimFrom(id) {
    const a = __listAnims[id];
    return a && a.until > Date.now() ? a.from : null;
  }
  const flipRef = useFlip([active.map(function (b) { return b.id; }).join(",")]);

  // v16.0.0: repeat no-show offender map (2+ past no-shows on this phone,
  // counted across ALL dates — the full bookings prop, not just `day`).
  const nsMap = noShowMap(bookings);

  function renderCard(b) {
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
        // v16.1.0: running-late state ("warn"/"noshow") from App's lateMap —
        // amber border + "N min late" tag; at "noshow" a one-tap No show button.
        // Seated-overstay warnings keep precedence over the late highlight.
        const lateSt = late[b.id] || null;
        const sc = STATUS_COLORS[b.status];
        const useStatusColor = b.status === "seated" || b.status === "completed" || b.status === "cancelled";
        const cardBg = useStatusColor ? "var(--bg-card-dim)" : "var(--bg-card-strong)";
        const cardBrd = warn
          ? (warn.overdue ? "var(--card-overdue-border)" : "var(--card-warn-border)")
          : lateSt
            ? "var(--card-warn-border)"
            : b._conflict
              ? "var(--card-conflict-border)"
              : useStatusColor ? sc.border : "var(--border-card-plain)";
        const cardBrdW = (warn || lateSt) ? "3px" : useStatusColor ? "3px" : "1px";

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
        // v16.0.0: repeat no-show offender chip (same threshold as the timeline ⚠).
        const noShowCt = nsMap[normalizePhone(b.phone)] || 0;
        const noShowTag = noShowCt >= 2 ? (
          <SmallTag label={"⚠ no-show ×" + noShowCt} style={{ background: "var(--warn-bg)", color: "var(--warn-text)", border: "1px solid var(--warn-border)" }} />
        ) : null;
        // v16.1.0: running-late tag (minutes past the booked time).
        const lateTag = lateSt ? (
          <SmallTag label={(nowMins - toMins(b.time)) + " min late"} style={{ background: "var(--warn-bg)", color: "var(--warn-text)", border: "1px solid var(--warn-border)" }} />
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

        // v14.4.0: Cancel + Delete are pulled into a right-aligned group (Cancel
        // then Delete); the remaining status changers stay in the left group.
        const statusBtns = ["confirmed", "seated", "completed"]
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
        const cancelBtn = b.status !== "cancelled" ? (
          <button
            key="cancelled"
            className="mgt-hover-scale"
            style={mkBtn({ background: BLOCK_BG.cancelled, textTransform: "capitalize" })}
            onClick={() => onStatus(b.id, "cancelled")}
          >
            {"> cancelled"}
          </button>
        ) : null;

        const animFrom = listAnimFrom(b.id);
        return (
          <div
            key={b.id}
            data-flip-id={b.id}
            className="mgt-hover-scale"
            onClick={() => onSelect(b.id)}
            style={{
              background: cardBg,
              border: cardBrdW + " solid " + cardBrd,
              borderRadius: 16, padding: "14px 16px",
              position: "relative",
              opacity: (b.status === "completed" || b.status === "cancelled") ? 0.75 : 1,
              // v14.4.0: accent ring marks the keyboard-focused card (List shortcuts).
              boxShadow: b.id === selectedId
                ? "0 0 0 3px var(--accent), var(--shadow-card)"
                : "var(--shadow-card)",
              cursor: "pointer"
            }}
          >
            {/* v15.8.0 cont.4: status-change colour wipe — fills the NEW (clicked)
                status colour (green Seated, red Cancelled, …) sweeping left→right
                (direction flipped rtl→ltr in v15.9.0 on request).
                `animFrom` is only the trigger flag; the colour is the new status. */}
            {animFrom ? (
              <div className="mgt-wipe-ltr" style={{
                position: "absolute", inset: 0, borderRadius: 16, pointerEvents: "none", zIndex: 0,
                background: BLOCK_BG[b.status] || "transparent", opacity: 0.5
              }} />
            ) : null}
            <div style={{ position: "relative", zIndex: 1 }}>
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
                {noShowTag}
                {lateTag}
                {durationTag}
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: S.text }}>{b.time + "–" + end}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              {(b.tables || []).map((t) => <TBadge key={t} id={t} />)}
              {phonEl}
            </div>
            {notesEl}
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button className="mgt-hover-scale" style={mkBtn({ background: BTN.tables })} onClick={() => onManual(b.id)}>= Tables</button>
              <button className="mgt-hover-scale" style={mkBtn({ background: BTN.edit })} onClick={() => onEdit(b)}>Edit</button>
              {statusBtns}
              <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
                {/* v16.1.0: one-tap No show once past the no-show threshold. */}
                {lateSt === "noshow" ? (
                  <button className="mgt-hover-scale" style={mkBtn({ background: BTN.orange })} onClick={() => onNoShow(b.id)}>No show</button>
                ) : null}
                {cancelBtn}
                <button className="mgt-hover-scale" style={mkBtn({ background: BTN.del })} onClick={() => onDelete(b.id)}>Delete</button>
              </div>
            </div>
            </div>
          </div>
        );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div ref={flipRef} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {active.map(renderCard)}
      </div>
      {finished.length > 0 ? (
        <Collapsible
          title="Completed & cancelled"
          summary={finished.length + (finished.length === 1 ? " booking" : " bookings")}
          open={showFinished}
          onToggle={onToggleFinished}
          style={{ marginBottom: 0 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {finished.map(renderCard)}
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
}
