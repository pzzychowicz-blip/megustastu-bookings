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
// Note: the wide toggle header intentionally skips `.mgt-hover-scale` — an 8%
// lift on a full-width (≤1000px) bar reads as a large jump; the timeline
// scroller skips it for the same reason.
//
// v14.6.0.

import { daySummary } from "../lib/booking-logic";
import { OPEN, CLOSE, BTN } from "../lib/constants";
import { mkBtn } from "./atoms";

function hh(n){ return String(((n % 24) + 24) % 24).padStart(2, "0") + ":00"; }
function coversLabel(n){ return n + " cover" + (n !== 1 ? "s" : ""); }
function bookingsLabel(n){ return n + " booking" + (n !== 1 ? "s" : ""); }

export function Summary({ bookings, date, splitHour, shiftsEnabled, open, onToggle, onOpenWeek }) {
  const s = daySummary(bookings, date, splitHour);
  const hasData = s.totalBookings > 0;
  const showShifts = shiftsEnabled !== false; // Shifts toggle (Settings → General → Shifts)
  const maxHourCovers = s.hours.reduce(function(m, h){ return Math.max(m, h.covers); }, 0) || 1;

  return (
    <div style={{
      background: "var(--bg-soft)",
      border: "1px solid var(--border-soft)",
      borderRadius: 14,
      marginBottom: 12,
      boxShadow: "var(--shadow-soft)",
      overflow: "hidden"
    }}>
      {/* Header — the headline toggles the body (click or the `s` shortcut); the
          Week button opens the week-at-a-glance popover. Separate buttons so we
          never nest a <button> inside a <button>. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
        <button
          onClick={onToggle}
          aria-expanded={open}
          style={{
            flex: 1, minWidth: 0, boxSizing: "border-box", padding: 0,
            display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
            background: "transparent", border: "none", cursor: "pointer", textAlign: "left"
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Summary</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>{coversLabel(s.totalCovers)}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>{bookingsLabel(s.totalBookings)}</span>
        </button>
        {onOpenWeek ? (
          <button
            onClick={onOpenWeek}
            className="mgt-hover-scale"
            style={mkBtn({ minHeight: 30, padding: "4px 12px", fontSize: 11, background: BTN.nav })}
          >
            Week
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

      {/* Expanded body — shift chips + hourly bars. */}
      {open ? (
        <div style={{ padding: "2px 14px 14px" }}>
          {hasData ? (
            <div>
              {showShifts ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <ShiftChip label={"Afternoon " + hh(OPEN) + "–" + hh(splitHour)} covers={s.afternoon.covers} count={s.afternoon.count} />
                  <ShiftChip label={"Evening " + hh(splitHour) + "–" + hh(CLOSE)} covers={s.evening.covers} count={s.evening.count} />
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
