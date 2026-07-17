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

import { useMemo, memo } from "react";
import { daySummary } from "../lib/booking-logic";
import { BTN, TOTAL_SEATS, hoursFor } from "../lib/constants";
import { mkBtn, Reveal } from "./atoms";

function hh(n){ return String(((n % 24) + 24) % 24).padStart(2, "0") + ":00"; }
function coversLabel(n){ return n + " cover" + (n !== 1 ? "s" : ""); }
function bookingsLabel(n){ return n + " booking" + (n !== 1 ? "s" : ""); }

// v16.3.0: "freeing soon" entries from the freeing list ([{tables,inMin}]).
// Tables joined with + (a multi-table booking), cap at 3 entries + a "+N" tail.
// Returns an ARRAY so each entry can render as its own no-wrap span — the line
// wraps BETWEEN entries (never mid-token) when several tables are freeing at
// once, instead of overflowing the card (v16.3.0-correction).
function freeingParts(freeing){
  if(!freeing || !freeing.length) return [];
  const parts = freeing.slice(0, 3).map(function(f){
    const t = (f.tables && f.tables.length) ? f.tables.join("+") : "?";
    return t + " (~" + f.inMin + "m)";
  });
  if(freeing.length > 3) parts.push("+" + (freeing.length - 3));
  return parts;
}

// v17.1.0 perf: React.memo — Summary sits in the always-visible date-nav row,
// so it used to re-render on every BookingApp render. Function props are App's
// stable VA wrappers; hoursSig/layoutSig are identity-only props that bust the
// memo on an hours/layout edit (hoursFor + TOTAL_SEATS are live bindings).
export const Summary = memo(function Summary({ bookings, date, splitHour, shiftsEnabled, isToday, open, freeing, onToggle, onOpenWeek, onPrint }) {
  // v17.1.0 perf: Summary lives in the always-visible date-nav row, so this
  // used to walk all bookings on EVERY BookingApp render; memoized.
  const s = useMemo(() => daySummary(bookings, date, splitHour), [bookings, date, splitHour]);
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 1, minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {isToday ? (
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", minWidth: 0, textAlign: "right" }}>
              {/* Occupancy metrics stay together as one no-wrap unit (short line). */}
              <span style={{ whiteSpace: "nowrap" }}>
                <span style={{ fontWeight: 700, color: "var(--status-seated-text)" }}>{s.seated.count}</span> seated
                <span style={{ margin: "0 5px", color: "var(--text-faint)" }}>·</span>
                <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{s.upcoming.count}</span> upcoming
                <span style={{ margin: "0 5px", color: "var(--text-faint)" }}>·</span>
                <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{s.seated.covers}/{TOTAL_SEATS}</span> seats filled
              </span>
              {/* freeing soon — each entry is its own no-wrap span so the list
                  wraps BETWEEN tables (never mid-token) when it gets long. */}
              {freeing && freeing.length ? (
                <span style={{ color: "var(--success-text)", fontWeight: 600 }}>
                  <span style={{ margin: "0 5px", color: "var(--text-faint)", fontWeight: 500 }}>·</span>
                  <span style={{ whiteSpace: "nowrap" }}>freeing soon:</span>{" "}
                  {freeingParts(freeing).map(function(p, i){
                    return (
                      <span key={i}>{i > 0 ? ", " : ""}<span style={{ whiteSpace: "nowrap" }}>{p}</span></span>
                    );
                  })}
                </span>
              ) : null}
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

      {/* Expanded body — shift chips + hourly bars. Wrapped in Reveal (v15.8.0)
          so the panel eases open/closed instead of snapping the column below
          it (the outer panel is overflow:hidden, so the collapse won't spill). */}
      <Reveal show={open}>
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
          {onPrint ? (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button
                onClick={onPrint}
                className="mgt-hover-scale mgt-press"
                style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: BTN.nav })}>🖨 Print day sheet</button>
            </div>
          ) : null}
        </div>
      </Reveal>
    </div>
  );
});

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
