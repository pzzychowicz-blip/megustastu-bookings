// src/components/Summary.jsx
// Collapsible day-summary panel — total covers (guests expected) for the
// selected date, broken down by hour and by the two editable shifts. Sits
// between the date-nav row and the main view; reflects `viewDate`. Helps with
// prep ("how many covers, and when").
//
// Covers = Σ booking.size over non-cancelled bookings (see `daySummary` in
// booking-logic.js). Shift split is the editable `splitHour` (Settings →
// General → Shifts): Afternoon = OPEN..split, Evening = split..CLOSE.
//
// Controlled: `open` + `onToggle` are owned by BookingApp (so the global `g`
// keyboard shortcut can toggle it too). Collapsed = a one-line headline;
// expanded = per-shift chips + an hourly cover breakdown.
//
// Note: the panel lifts via `.mgt-hover-scale` only when COLLAPSED — a compact
// bar in the date-nav row, consistent with the date controls beside it. When
// expanded it's a tall content panel, so the lift is suppressed (an 8% scale on
// a large surface reads as a jarring jump — the timeline scroller skips it too).
//
// v14.6.0.

import { daySummary } from "../lib/booking-logic";
import { BTN, TOTAL_SEATS, hoursFor } from "../lib/constants";
import { mkBtn } from "./atoms";

function hh(n){ return String(((n % 24) + 24) % 24).padStart(2, "0") + ":00"; }
function coversLabel(n){ return n + " cover" + (n !== 1 ? "s" : ""); }
function bookingsLabel(n){ return n + " booking" + (n !== 1 ? "s" : ""); }

export function Summary({ bookings, date, splitHour, shiftsEnabled, isToday, open, onToggle, onOpenWeek }) {
  const s = daySummary(bookings, date, splitHour);
  const hasData = s.totalBookings > 0;
  // v15.0.0: per-weekday hours. The Afternoon/Evening split is ONE global value, so
  // on a day whose window excludes it (or a closed day) the two shift chips are
  // meaningless — hide them and show only the hourly bars. Read hoursFor(date) so
  // this is correct for the viewed day regardless of the live active-day binding.
  const dh = hoursFor(date);
  const splitInWindow = !dh.closed && splitHour > dh.open && splitHour < dh.close;
  const showShifts = shiftsEnabled !== false && splitInWindow; // Shifts toggle (Settings → General → Shifts)
  const maxHourCovers = s.hours.reduce(function(m, h){ return Math.max(m, h.covers); }, 0) || 1;

  return (
    <div
      className={open ? undefined : "mgt-hover-scale"}
      style={{
        background: "var(--bg-soft)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        boxShadow: "var(--shadow-soft)",
        overflow: "hidden"
      }}
    >
      {/* Header — the headline toggles the body (click or the `s` shortcut); the
          More button opens the at-a-glance popover (Week / Month — see WeekView).
          Separate buttons so we never nest a <button> inside a <button>. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", flexWrap: "wrap" }}>
        <button
          onClick={onToggle}
          aria-expanded={open}
          style={{
            flex: "1 1 200px", minWidth: 0, boxSizing: "border-box", padding: 0,
            display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
            background: "transparent", border: "none", cursor: "pointer", textAlign: "left"
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>{coversLabel(s.totalCovers)}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>{bookingsLabel(s.totalBookings)}</span>
        </button>
        {/* Right cluster — the live status bar (today only) + Week + chevron, right-aligned
            via marginLeft:auto; wraps below the headline as a unit on narrow widths. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {isToday ? (
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              <span style={{ fontWeight: 700, color: "var(--status-seated-text)" }}>{s.seated.count}</span> seated
              <span style={{ margin: "0 5px", color: "var(--text-faint)" }}>·</span>
              <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{s.upcoming.count}</span> upcoming
              <span style={{ margin: "0 5px", color: "var(--text-faint)" }}>·</span>
              <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{s.seated.covers}/{TOTAL_SEATS}</span> seats filled
            </div>
          ) : null}
          {onOpenWeek ? (
            <button
              onClick={onOpenWeek}
              className="mgt-hover-scale"
              style={mkBtn({ minHeight: 30, padding: "4px 12px", fontSize: 11, background: BTN.nav })}
            >
              More
            </button>
          ) : null}
          <button
            onClick={onToggle}
            aria-label={open ? "Collapse summary" : "Expand summary"}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-muted)", fontWeight: 700, flexShrink: 0, padding: "4px 2px" }}
          >
            {open ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Expanded body — shift chips + hourly bars. */}
      {open ? (
        <div style={{ padding: "2px 14px 14px" }}>
          {hasData ? (
            <div>
              {showShifts ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <ShiftChip label={"Afternoon " + hh(dh.open) + "–" + hh(splitHour)} covers={s.afternoon.covers} count={s.afternoon.count} />
                  <ShiftChip label={"Evening " + hh(splitHour) + "–" + hh(dh.close)} covers={s.evening.covers} count={s.evening.count} />
                </div>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {s.hours.map(function(h){
                  return (
                    <div key={h.hour} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <span style={{ color: "var(--text-secondary)", fontWeight: 600, minWidth: 104, flexShrink: 0 }}>
                        {hh(h.hour) + "–" + hh(h.hour + 1)}
                      </span>
                      <div style={{ flex: 1, height: 7, background: "var(--bg-input)", borderRadius: 4, overflow: "hidden", minWidth: 40 }}>
                        <div style={{ width: ((h.covers / maxHourCovers) * 100) + "%", height: "100%", background: "var(--accent)", opacity: 0.8, borderRadius: 4 }} />
                      </div>
                      <span style={{ color: "var(--text-primary)", fontWeight: 700, minWidth: 70, textAlign: "right", flexShrink: 0 }}>
                        {coversLabel(h.covers)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "4px 0 2px" }}>No bookings for this day.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// One shift total (Afternoon / Evening): label + cover count + booking count.
function ShiftChip({ label, covers, count }) {
  return (
    <div style={{
      flex: "1 1 160px", minWidth: 150,
      padding: "8px 12px",
      background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: 10
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{covers + " cover" + (covers !== 1 ? "s" : "")}</div>
      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-faint)" }}>{count + " booking" + (count !== 1 ? "s" : "")}</div>
    </div>
  );
}
