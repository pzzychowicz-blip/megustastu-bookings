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
import { BTN, TOTAL_SEATS, hoursFor, R, T, FW, IC } from "../lib/constants";
import { mkBtn, Reveal } from "./atoms";
// v17.9.0: the local `hh` was one of six copies of this label — see lib/time-grid.js.
import { hourLabel as hh } from "../lib/time-grid";
import { ChevronDownIcon, ChevronUpIcon, PrintIcon } from "./Icons";
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
      /* v17.9.1 (Patryk): a tint, not a lift — "friendlier for the user". The
         Summary is a PANEL holding a toggle, a chevron, Print and More, so it is
         a container of controls: scaling it moved those controls out from under
         the cursor, the same defect measured on the List card.
         Applied in BOTH states (Patryk): an expanded panel is still the thing
         you point at to collapse it again, so it should answer the pointer the
         same way. Withholding the class while open was also a live BUG — the
         resting fill arrives through `--row-bg`, which nothing but this class
         consumes, so an open Summary rendered fully transparent
         (measured `rgba(0, 0, 0, 0)`). A custom property is only a value; the
         rule that reads it is what paints. */
      className="mgt-ac-row"
      style={{
        "--row-bg": "var(--bg-soft)",
        "--row-bg-hover": "var(--bg-hover-card)",
        border: "1px solid var(--border-soft)",
        borderRadius: R.card,
        boxShadow: "var(--shadow-soft)",
        overflow: "hidden"
      }}
    >
      {/* Header — the headline toggles the body (click or the `s` shortcut), and
          the chevron on the right does the same thing. Two separate buttons
          rather than one wrapping the row, so we never nest a <button> inside a
          <button>. (The More button lived here until v17.9.0 — see the note at
          its new home in the expanded body.) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", flexWrap: "wrap" }}>
        <button
          onClick={onToggle}
          aria-expanded={open}
          style={{
            flex: "1 1 200px", minWidth: 0, boxSizing: "border-box", padding: 0,
            // v17.8.0: the box was only as tall as its text line — 17px — even
            // though it is the whole "tap to see the day" target. Wide enough
            // to hit horizontally, but 17px is thin for a thumb. 36 to match the
            // controls beside it (44 made the summary card visibly taller than
            // the date row for no gain — it is already 400px+ wide).
            minHeight: 36,
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            background: "transparent", border: "none", cursor: "pointer", textAlign: "left"
          }}
        >
          <span style={{ fontSize: T.lead, fontWeight: FW.bold, color: "var(--accent)" }}>{coversLabel(s.totalCovers)}</span>
          <span style={{ fontSize: T.body, fontWeight: FW.regular, color: "var(--text-muted)" }}>{bookingsLabel(s.totalBookings)}</span>
        </button>
        {/* Right cluster — the live status bar (today only) + Week + chevron, right-aligned
            via marginLeft:auto; wraps below the headline as a unit on narrow widths. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 1, minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {isToday ? (
            <div style={{ fontSize: T.body, fontWeight: FW.regular, color: "var(--text-muted)", minWidth: 0, textAlign: "right" }}>
              {/* Occupancy metrics stay together as one no-wrap unit (short line). */}
              <span style={{ whiteSpace: "nowrap" }}>
                <span style={{ fontWeight: FW.bold, color: "var(--status-seated-text)" }}>{s.seated.count}</span> seated
                <span style={{ margin: "0 4px", color: "var(--text-faint)" }}>·</span>
                <span style={{ fontWeight: FW.bold, color: "var(--text-primary)" }}>{s.upcoming.count}</span> upcoming
                <span style={{ margin: "0 4px", color: "var(--text-faint)" }}>·</span>
                <span style={{ fontWeight: FW.bold, color: "var(--text-primary)" }}>{s.seated.covers}/{TOTAL_SEATS}</span> seats filled
              </span>
              {/* freeing soon — each entry is its own no-wrap span so the list
                  wraps BETWEEN tables (never mid-token) when it gets long. */}
              {freeing && freeing.length ? (
                <span style={{ color: "var(--success-text)", fontWeight: FW.semi }}>
                  <span style={{ margin: "0 4px", color: "var(--text-faint)", fontWeight: FW.regular }}>·</span>
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
          {/* v17.9.0 (Patryk): the More button moved OUT of this header and
              down beside Print day sheet in the expanded body. The header is
              the day's numbers plus the control that reveals them; More opens a
              different screen entirely (Week / Month), and sitting here it was
              a second, unrelated destination inside the summary's own headline.
              Beside Print it is what it actually is — one of the two things you
              can do FROM the day's figures once you are looking at them.

              It is therefore only visible while the summary is expanded, which
              Patryk chose knowingly: the `M` shortcut still opens the popover
              from anywhere, and that is the path staff use. */}
          <button
            onClick={onToggle}
            aria-label={open ? "Collapse summary" : "Expand summary"}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: T.small, color: "var(--text-muted)", fontWeight: FW.bold, flexShrink: 0,
              /* v17.8.0: was padding "4px 2px", giving a 13x21px hit area — the
                 smallest target in the app, on the control that opens the day's
                 numbers. The glyph is unchanged; only the box around it grew. */
              padding: 0, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {open ? <ChevronUpIcon size={IC.control} /> : <ChevronDownIcon size={IC.control} />}
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
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {s.hours.map(function(h){
                  return (
                    <div key={h.hour} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.body }}>
                      <span style={{ color: "var(--text-secondary)", fontWeight: FW.semi, minWidth: 104, flexShrink: 0 }}>
                        {hh(h.hour) + "–" + hh(h.hour + 1)}
                      </span>
                      <div style={{ flex: 1, height: 7, background: "var(--bg-input)", borderRadius: 4,   /* @canvas */  overflow: "hidden", minWidth: 40 }}>
                        <div style={{ width: ((h.covers / maxHourCovers) * 100) + "%", height: "100%", background: "var(--accent)", opacity: 0.8, borderRadius: 4,   /* @canvas */ }} />
                      </div>
                      <span style={{ color: "var(--text-primary)", fontWeight: FW.bold, minWidth: 70, textAlign: "right", flexShrink: 0 }}>
                        {coversLabel(h.covers)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: T.body, color: "var(--text-muted)", padding: "4px 0 2px" }}>No bookings for this day.</div>
          )}
          {/* The day's two actions, right-aligned: print it, or step back and
              look at the week/month around it. More takes Print's exact button
              shape rather than the 36px/T.small one it wore in the header —
              two buttons sharing a row that disagree on height and type size
              read as one control and one afterthought. */}
          {onPrint || onOpenWeek ? (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              {onPrint ? (
                <button
                  onClick={onPrint}
                  className="mgt-hover-scale mgt-press"
                  style={mkBtn({ fontSize: T.body, minHeight: 32, padding: "4px 12px", background: BTN.nav, display: "inline-flex", alignItems: "center", gap: 6 })}><PrintIcon size={IC.control} />Print day sheet</button>
              ) : null}
              {onOpenWeek ? (
                <button
                  onClick={onOpenWeek}
                  title="Week & month at a glance (M)"
                  className="mgt-hover-scale mgt-press"
                  style={mkBtn({ fontSize: T.body, minHeight: 32, padding: "4px 12px", background: BTN.nav })}>More</button>
              ) : null}
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
      background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: R.inset
    }}>
      <div style={{ fontSize: T.small, fontWeight: FW.semi, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: T.title, fontWeight: FW.bold, color: "var(--text-primary)" }}>{covers + " cover" + (covers !== 1 ? "s" : "")}</div>
      <div style={{ fontSize: T.small, fontWeight: FW.regular, color: "var(--text-faint)" }}>{count + " booking" + (count !== 1 ? "s" : "")}</div>
    </div>
  );
}
