// src/components/TimeAxis.jsx
//
// v17.5.0 — a horizontally-scrollable strip of 15-minute time blocks, in the
// Timeline's visual language. Replaces the Plan view's <input type="range">
// scrubber: the slider gave no sense of WHERE in the service you were, and read
// nothing like the timeline grid staff already know.
//
// ── Why this shares the Timeline's span exactly ──────────────────────────────
// The strip runs OPEN … GRID_CLOSE — the same span TimelineView draws, one hour
// past closing. That was a deliberate choice (the old slider stopped at CLOSE):
// because the spans now match, this component can reuse `pct()` and
// QUARTER_HOURS UNCHANGED, with no range-parametrised variant, and a block here
// lines up tick-for-tick with the same minute on the timeline. The extra
// 22:00–23:00 tail is also genuinely useful — it's where a late booking runs out.
//
// ── Live bindings ────────────────────────────────────────────────────────────
// OPEN / GRID_CLOSE / QUARTER_HOURS and pct() are LIVE module bindings holding
// the ACTIVE VIEW DAY's hours (useOperatingHours calls setActiveDayHours during
// render). This component is only ever rendered for the view date, so they
// agree. They're read at render time here — never captured into a module-scope
// local, which would freeze them (the constants.js live-binding gotcha).
//
// NOT memo'd, and deliberately so: it reads those live bindings, which
// React.memo cannot see, so it would need an hoursSig-style busting prop to be
// correct. Its parent (PlanView) is memo'd and already takes `hoursSig`, so the
// repaint gating happens one level up where it can be done right.
//
// Module scope is load-bearing: PlanView has no other sub-components, and an
// inline one would be a NEW component type every render — remounting ~40 tick
// divs on every 15s nowMins tick and every pan gesture (the v17.1.0
// GridLines/BlockBar lesson, CLAUDE.md's inline-sub-components row).

import { useRef, useLayoutEffect } from "react";
import { OPEN, GRID_CLOSE, QUARTER_HOURS, S } from "../lib/constants";
import { pct, toTime } from "../lib/booking-logic";

// Width of one 15-minute block. 44px is the app's tap-target floor (every
// mkBtn action button uses minHeight 44), which is what makes the blocks
// reliably tappable on the tablets — the whole point of replacing a 6px-wide
// slider thumb. A 13:00–23:00 day is therefore ~1760px and scrolls.
const QUARTER_PX = 44;

export function TimeAxis({ selected, onSelect, nowMins = 0, isToday = false, autoScrollKey = 0 }) {
  const scrollRef = useRef(null);
  const totalMins = (GRID_CLOSE - OPEN) * 60;
  const trackW = Math.max(320, QUARTER_HOURS.length * QUARTER_PX);
  const quarterPctW = (15 / totalMins) * 100;

  // Centre the selected block — but only on a PROGRAMMATIC change (the Now
  // button, a date change, the clock-follow tick), never when the user just
  // tapped a block or is mid-scroll. Yanking the strip out from under a finger
  // is exactly the kind of thing that makes a scrubber feel broken, so the
  // parent bumps `autoScrollKey` at the programmatic sites and nowhere else.
  // useLayoutEffect + INSTANT scroll, deliberately not smooth: with
  // behavior:"smooth" the first paint showed the far right of the strip and
  // then slid ~1.5s to the right place, which reads as the widget being
  // broken. A programmatic re-centre should simply already be there.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || selected == null) return;
    const x = ((selected - OPEN * 60) / totalMins) * trackW;
    el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScrollKey]);

  const nowInRange = isToday && nowMins >= OPEN * 60 && nowMins <= GRID_CLOSE * 60;

  return (
    <div
      ref={scrollRef}
      style={{
        overflowX: "auto", overflowY: "hidden",
        touchAction: "pan-x", WebkitOverflowScrolling: "touch",
        borderRadius: 10, marginBottom: 8,
      }}
    >
      {/* 58px = 24 header + 26 blocks + a 8px lane at the bottom so the native
          horizontal scrollbar doesn't paint over the blocks it scrolls. */}
      <div style={{ width: trackW + "px", minWidth: "100%", position: "relative", height: 58 }}>
        {/* Hour strip — same 24px header, tokens and centred hour pills as the
            timeline grid, so the two read as one system. */}
        <div style={{
          position: "relative", height: 24, boxSizing: "border-box",
          background: "var(--tl-header-strip)",
          borderBottom: "2px solid var(--tl-header-border)",
          borderRadius: "6px 6px 0 0", overflow: "visible",
        }}>
          {QUARTER_HOURS.map((m) => (
            <div key={"l" + m} style={{
              position: "absolute", top: 0, bottom: 0, left: pct(m),
              borderLeft: m % 60 === 0 ? "2px solid var(--tl-gridline-hour)" : "0.5px solid var(--tl-gridline-quarter)",
            }} />
          ))}
          {/* Right edge drawn separately: pct() of the last quarter is not 100%,
              and QUARTER_HOURS stops one quarter short of GRID_CLOSE. */}
          <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, borderLeft: "2px solid var(--tl-gridline-hour)" }} />
          {QUARTER_HOURS.filter((m) => m % 60 === 0 && m < GRID_CLOSE * 60).map((m) => (
            <span key={"h" + m} style={{
              position: "absolute", top: 3, left: ((m + 30 - OPEN * 60) / totalMins) * 100 + "%",
              transform: "translateX(-50%)",
              fontSize: 10, fontWeight: 600, color: "var(--text-on-accent)",
              whiteSpace: "nowrap", pointerEvents: "none",
              background: "var(--tl-hour-pill)", padding: "2px 5px", borderRadius: 6, zIndex: 1,
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}>{String(Math.floor(m / 60) % 24).padStart(2, "0") + ":00"}</span>
          ))}
        </div>

        {/* Selectable quarter blocks. Alternating hour BANDS are what make the
            strip legible at a glance — a flat row of 44px cells with hairline
            dividers reads as an empty bar in dark mode. Each hour's first block
            carries a faint label so you can find a time without selecting it. */}
        {QUARTER_HOURS.map((m) => {
          const isSel = selected === m;
          const isHourStart = m % 60 === 0;
          const bandOdd = Math.floor(m / 60) % 2 === 1;
          return (
            <button
              key={"q" + m}
              type="button"
              onClick={() => onSelect(m)}
              aria-label={toTime(m)}
              aria-pressed={isSel}
              title={toTime(m)}
              className={isSel ? undefined : "mgt-timeaxis-cell"}
              style={{
                position: "absolute", top: 26, height: 26,
                left: pct(m), width: quarterPctW + "%",
                boxSizing: "border-box", padding: 0, margin: 0, cursor: "pointer",
                border: "none",
                borderLeft: isHourStart ? "2px solid var(--tl-gridline-hour)" : "0.5px solid var(--tl-gridline-quarter)",
                background: isSel ? S.accent : (bandOdd ? "var(--bg-soft)" : "var(--bg-card)"),
                color: isSel ? "var(--text-on-accent)" : "var(--text-faint)",
                fontSize: 10, fontWeight: isSel ? 700 : 500,
                fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                borderRadius: isSel ? 6 : 0,
                zIndex: isSel ? 3 : 1,
                transition: "background 140ms ease, color 140ms ease",
                WebkitTapHighlightColor: "transparent",
              }}
            >{isSel ? toTime(m) : (isHourStart ? String(Math.floor(m / 60) % 24).padStart(2, "0") : "")}</button>
          );
        })}

        {/* Now marker — same tokens as the timeline's, drawn over the blocks. */}
        {nowInRange ? (
          <div style={{ position: "absolute", top: 24, height: 26, left: pct(nowMins), zIndex: 4, pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 2, background: "var(--tl-now-line)" }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
