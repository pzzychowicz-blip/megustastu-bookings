// src/components/WeekView.jsx
// "More" at-a-glance popover, opened from the Summary panel's More button (or
// the `M` shortcut). Two modes, switchable via a Week/Month segmented control
// or the W / M keys:
//
//   • Week  — the 7 days (Mon–Sun, European convention) of the week containing
//             the reference date, each as a row with a cover bar + booking count.
//   • Month — a Mon-start calendar grid of the reference month; each in-month
//             day cell shows its cover count with a busyness tint. (v14.9.0)
//
// Tap a day to jump to it (sets viewDate + closes). The footer arrows navigate the
// period (week or month) without committing; "This week" / "This month" returns
// to today's period. Per-day counts reuse `daySummary` (splitHour is irrelevant
// for the totals, so 0 is passed).
//
// Date math is ALL-UTC: a "YYYY-MM-DD" string parses as UTC midnight and
// toISOString is UTC, so day-of-week + ±day/week/month math stays consistent.
// (Mixing local getDate() with UTC toISOString shifted the whole week back a day
// in UTC+ timezones — the bug the v14.7.0 live preview caught.)
//
// Uses the shared Overlay (with the v14.4.1 pinned-footer slot) for the
// scrim/card + the nav/close footer.
//
// v14.7.0 (week) · v14.9.0 (month view + W/M switch).

import { useState, useEffect } from "react";
import { Overlay, mkBtn, AutoHeight, SEG_TRACK, segStyle, TBadge } from "./atoms";
import { daySummary, rangeStats, countLabel } from "../lib/booking-logic";
import { S, BTN, R, T, FW, IC, H, TIMELINE_TABLES } from "../lib/constants";
import { hourLabel } from "../lib/time-grid";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { todayStr, addDays, isReadableDate, formatDay } from "../lib/day";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];   // week-list rows
const WDS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];          // month-grid header
const MONF = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// 7 ISO date strings (Mon→Sun) for the week containing `dateStr`.
function weekDates(dateStr){
  const d = new Date(dateStr);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Mon … 6 = Sun
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dow);
  const out = [];
  for(let i = 0; i < 7; i++){
    const x = new Date(monday);
    x.setUTCDate(monday.getUTCDate() + i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

// Mon-start calendar matrix (4–6 weeks) for the month containing `dateStr`.
// Each cell: { date, inMonth }. Leading/trailing cells spill into the adjacent
// month so every row is a full Mon→Sun week.
function monthGrid(dateStr){
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Mon-start offset of the 1st
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const numWeeks = Math.ceil((lead + daysInMonth) / 7);
  const cur = new Date(first);
  cur.setUTCDate(first.getUTCDate() - lead); // Monday on/before the 1st
  const weeks = [];
  for(let w = 0; w < numWeeks; w++){
    const week = [];
    for(let i = 0; i < 7; i++){
      week.push({ date: cur.toISOString().slice(0, 10), inMonth: cur.getUTCMonth() === month });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// v18.2.0 (the design critique, C1): the house date at both ends, "21.09 –
// 27.09", where it was "Sep 21 – 27, 2026". No weekdays — a week here always
// runs Monday to Sunday, and the columns under it say so. The year appears
// where `formatDay` puts it, on an end that is not this year.
function weekRangeLabel(days){
  return formatDay(days[0], { weekday: false }) + " – " + formatDay(days[6], { weekday: false });
}
function monthLabel(dateStr){
  const d = new Date(dateStr);
  return MONF[d.getUTCMonth()] + " " + d.getUTCFullYear();
}
function sameMonth(a, b){
  const x = new Date(a), y = new Date(b);
  return x.getUTCMonth() === y.getUTCMonth() && x.getUTCFullYear() === y.getUTCFullYear();
}
// v18.2.0 (the design critique, X2): the popover's cells are OPAQUE. They were
// --bg-input, half-transparent over a translucent sheet, so the page behind the
// modal showed through and the timeline's orange blocks tinted days amber —
// measured, days 18–20 and 25–27 amber over the Timeline, grey over the List.
const CELL = "var(--bg-cal-cell)";
// The busiest in-month day's shading (the accent at up to 30%), shared by the
// cells and the key under them so the key cannot describe a different scale.
const HEAT = 0.3;
// An out-of-month day's number, faded; the cell stays solid.
const OUT_OF_MONTH = 0.4;

export function WeekView({ bookings, viewDate, isMobile, onPick, onClose }){
  const [mode, setMode] = useState("week");   // "week" | "month"
  // v17.16.11: seed from `viewDate` only when it is a date this view can step
  // FROM. `viewDate` can hold a booking's stored date verbatim (SearchPanel's
  // onPick → goToDate(b.date)), and every date operation in this component
  // anchors on these two: goWeek/moveFocus through `addDays`, goMonth through
  // its own `toISOString()`, focusWithinWeek through `weekDates(ref)`. So ONE
  // guard here covers all four, where swapping `addDays` for `stepDate` would
  // have covered two and left goMonth throwing.
  //
  // A calendar cannot draw an unparseable date, so it opens on today. The
  // booking itself stays reachable in List — this hides no repair.
  const anchor = isReadableDate(viewDate) ? viewDate : todayStr();
  const [ref, setRef] = useState(anchor);    // a date inside the displayed period
  const [focus, setFocus] = useState(anchor); // keyboard-highlighted day
  const today = todayStr();
  const isWeek = mode === "week";
  const isStats = mode === "stats"; // v16.3.0: analytics over the month of `ref`

  // ── Period navigation (keep `ref` + `focus` in sync) ──
  function goWeek(delta){ setRef(addDays(ref, delta * 7)); setFocus(addDays(focus, delta * 7)); }
  function goMonth(delta){
    const f = new Date(focus);
    const target = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + delta, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    const day = Math.min(f.getUTCDate(), last);
    const nf = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day)).toISOString().slice(0, 10);
    setFocus(nf); setRef(nf);
  }
  function focusWithinWeek(dir){
    const wd = weekDates(ref);
    let idx = wd.indexOf(focus);
    if(idx === -1) idx = (new Date(focus).getUTCDay() + 6) % 7;
    setFocus(wd[(idx + dir + 7) % 7]);
  }
  function moveFocus(dd){ // month-mode 2D move; the displayed month follows
    const nf = addDays(focus, dd);
    setFocus(nf);
    if(!sameMonth(nf, ref)) setRef(nf);
  }
  function switchMode(m){ setMode(m); setRef(focus); } // re-centre the period on the focused day
  function goToday(){ setRef(today); setFocus(today); }

  // Keyboard nav while the popover is open. The global handler suppresses keys
  // (showWeek is in anyModal, so it returns early), so WeekView owns them:
  // W/M switch view · ←/→ period · ↑/↓ (and ←/→ in month) move the day focus ·
  // T this period · Enter open the focused day. (Esc / backdrop close stays with
  // the shared Overlay + global handler.)
  useEffect(function(){
    function onKey(e){
      if(e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if(k === "w" || k === "W"){ e.preventDefault(); switchMode("week"); }
      else if(k === "m" || k === "M"){ e.preventDefault(); switchMode("month"); }
      else if(k === "s" || k === "S"){ e.preventDefault(); switchMode("stats"); }
      else if(k === "t" || k === "T"){ e.preventDefault(); goToday(); }
      // In stats mode the arrows navigate months (no day focus); Enter is a no-op.
      else if(k === "Enter"){ if(!isStats){ e.preventDefault(); onPick(focus); } }
      else if(k === "ArrowLeft"){ e.preventDefault(); isStats ? goMonth(-1) : isWeek ? goWeek(-1) : moveFocus(-1); }
      else if(k === "ArrowRight"){ e.preventDefault(); isStats ? goMonth(1) : isWeek ? goWeek(1) : moveFocus(1); }
      else if(k === "ArrowUp"){ if(!isStats){ e.preventDefault(); isWeek ? focusWithinWeek(-1) : moveFocus(-7); } }
      else if(k === "ArrowDown"){ if(!isStats){ e.preventDefault(); isWeek ? focusWithinWeek(1) : moveFocus(7); } }
    }
    window.addEventListener("keydown", onKey);
    return function(){ window.removeEventListener("keydown", onKey); };
    // v18.3.2 (the stale-closure triage): no dependency array, so the listener
    // is re-added on every render. The list was [mode, ref, focus], which
    // covers the helpers' reads of those, but `goToday` reads `today`, taken
    // at render: with the popover left open across midnight and no key
    // pressed, T went to yesterday. Every helper is rebuilt per render, so
    // listing them would re-run this per render anyway; this says so plainly.
  });

  // ── Header: Week/Month segmented control + period label ──
  // v18.2.0 (the design critique, X3): the app's ONE segmented look — atoms'
  // SEG_TRACK / segStyle, the view switcher's and Settings' tab bar's. This was
  // a third style, the chosen mode in solid accent blue where the other two
  // lift a white segment, and it said which mode was on by colour alone:
  // `aria-pressed` now, as ViewSwitcher's buttons.
  function modeBtn(m, label){
    const active = mode === m;
    return (
      <button
        onClick={function(){ switchMode(m); }}
        className="mgt-hover-scale"
        aria-pressed={active}
        style={{ ...segStyle(active), padding: "6px 18px", minHeight: H.compact }}
      >
        {label}
      </button>
    );
  }

  // ── Footer (mode-aware nav) ──
  const footer = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button onClick={function(){ isWeek ? goWeek(-1) : goMonth(-1); }} aria-label={isWeek ? "Previous week" : "Previous month"} title={isWeek ? "Previous week" : "Previous month"} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, minWidth: 40, padding: "6px 12px", fontSize: T.title, background: BTN.nav })} ><ChevronLeftIcon size={IC.chrome} /></button>
        <button onClick={goToday} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "6px 14px", background: BTN.today })}>{isWeek ? "This week" : "This month"}</button>
        <button onClick={function(){ isWeek ? goWeek(1) : goMonth(1); }} aria-label={isWeek ? "Next week" : "Next month"} title={isWeek ? "Next week" : "Next month"} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, minWidth: 40, padding: "6px 12px", fontSize: T.title, background: BTN.nav })} ><ChevronRightIcon size={IC.chrome} /></button>
      </div>
      <button onClick={onClose} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "8px 18px", background: "var(--app-btn-slate)" })}>Close</button>
    </div>
  );

  // v18.2.0 phase 61 (Patryk): hung from the top like Settings, not centred.
  // Centred, the card's top moved every time its body changed height — Week
  // (7 rows) → Month (4–6 week rows) → Stats — so the Week / Month / Stats
  // control you had just pressed moved out from under the finger, and a month
  // with a sixth week moved it again. `anchor="top"` holds the top and only the
  // bottom edge follows the body (DESIGN.md, "Settings hangs from a fixed top").
  return (
    <Overlay onClose={onClose} footer={footer} anchor="top">
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div role="group" aria-label="Show" style={SEG_TRACK}>
          {modeBtn("week", "Week")}
          {modeBtn("month", "Month")}
          {modeBtn("stats", "Stats")}
        </div>
        <div style={{ fontSize: T.body, fontWeight: FW.medium, color: "var(--text-muted)", marginTop: 8 }}>
          {isWeek ? weekRangeLabel(weekDates(ref)) : monthLabel(ref)}
        </div>
      </div>

      {/* v15.8.0: AutoHeight eases the height when switching Week↔Month. (v17.8.0:
          its `linear` prop is gone — AutoHeight always eases linear now, so this
          call site is byte-identical in behaviour and is the reference the rest
          of the app's modal bodies were brought in line with.)
          Phase 61: `watch`, Settings' own, because every mode switch and every
          period step REPLACES the body — without it the new body paints once
          at its full height before the observer clips it to the old one. */}
      <AutoHeight watch={mode + "|" + ref}>{isStats ? statsBody() : isWeek ? weekBody() : monthBody()}</AutoHeight>

      <div style={{ marginTop: 18, fontSize: T.small, color: "var(--text-faint)", textAlign: "center" }}>
        {isStats
          ? "W/M/S view · ←→ month · T this month"
          : isWeek
            ? "W/M/S view · ↑↓ day · ←→ week · T today · Enter open"
            : "W/M/S view · ↑↓←→ day · footer arrows month · T today · Enter open"}
      </div>
    </Overlay>
  );

  // ── Week body: 7 rows with a cover bar ──
  function weekBody(){
    const days = weekDates(ref);
    const rows = days.map(function(d){
      const sum = daySummary(bookings, d, 0);
      return { date: d, covers: sum.totalCovers, bookings: sum.totalBookings };
    });
    const maxCovers = rows.reduce(function(m, r){ return Math.max(m, r.covers); }, 0) || 1;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map(function(r, i){
          const isToday = r.date === today;
          const isSel = r.date === viewDate;
          const isFocused = r.date === focus;
          const dnum = Number(r.date.slice(8, 10));
          return (
            <button
              key={r.date}
              onClick={function(){ onPick(r.date); }}
              className="mgt-hover-scale"
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: R.inset, cursor: "pointer",
                width: "100%", boxSizing: "border-box", textAlign: "left",
                background: CELL,
                border: "1px solid " + (isFocused || isSel ? "var(--accent)" : "var(--border-input)"),
                boxShadow: isFocused ? "0 0 0 2px var(--accent)" : "none"
              }}
            >
              <div style={{ minWidth: 56, flexShrink: 0 }}>
                <div style={{ fontSize: T.body, fontWeight: FW.bold, color: isToday ? "var(--accent)" : "var(--text-primary)" }}>{WD[i]}</div>
                <div style={{ fontSize: T.small, fontWeight: FW.regular, color: "var(--text-muted)" }}>{dnum + (isToday ? " · today" : "")}</div>
              </div>
              <div style={{ flex: 1, height: 8, background: "var(--bg-stepper)", borderRadius: 4,   /* @canvas */  overflow: "hidden", minWidth: 30 }}>
                <div style={{ width: ((r.covers / maxCovers) * 100) + "%", height: "100%", background: "var(--accent)", opacity: r.covers ? 0.8 : 0, borderRadius: 4,   /* @canvas */ }} />
              </div>
              <div style={{ minWidth: 86, textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: T.lead, fontWeight: FW.bold, color: "var(--text-primary)" }}>{countLabel(r.covers, "cover", "covers")}</div>
                <div style={{ fontSize: T.small, fontWeight: FW.regular, color: "var(--text-faint)" }}>{countLabel(r.bookings, "booking", "bookings")}</div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // ── Stats body (v16.3.0): analytics over the MONTH containing `ref` ──
  function statsBody(){
    const d = new Date(ref);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    const st = rangeStats(bookings, from, to);
    const maxH = st.hours.reduce(function(mx, h){ return Math.max(mx, h.covers); }, 0) || 1;
    const maxT = st.tables.reduce(function(mx, t){ return Math.max(mx, t.bookings); }, 0) || 1;
    // The LIVE binding, read at render: this body is not memoised, so a table
    // renamed in Settings is current the next time Stats draws.
    const inLayout = new Set(TIMELINE_TABLES.map(function(t){ return t.id; }));
    // v18.2.0 phase 74 (round 2's X6): the five tiles are a GRID, five across
    // on the card and three over two on the phone's sheet — `isMobile`, the
    // 600px line where Overlay switches between the two, so no second
    // breakpoint. They were flex items on an 84px basis, and a wrapping line is
    // packed greedily: the tablet's 530px card held four and stretched the
    // fifth, "no-shows", alone across a row of its own. On the sheet's six
    // columns the top three span two each and the bottom two span three.
    const stat = function(val, label, color, i){
      return (
        <div key={label} style={{ gridColumn: isMobile ? (i < 3 ? "span 2" : "span 3") : "auto", minWidth: 0, padding: "8px 10px", background: CELL, border: "1px solid var(--border-input)", borderRadius: R.inset }}>
          <div style={{ fontSize: T.title, fontWeight: FW.bold, color: color || "var(--text-primary)" }}>{val}</div>
          <div style={{ fontSize: T.small, fontWeight: FW.regular, color: "var(--text-muted)" }}>{label}</div>
        </div>
      );
    };
    // `label` is a node: an hour's text, or a table's badge. v18.2.0 phase 74
    // (X6): a table is drawn as a table everywhere else, so here too — and one
    // the layout does not have is the dashed badge the List card draws
    // (phase 69), where it read "Table 1" as though the room had one.
    const bar = function(key, label, val, max, color){
      return (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.body, marginBottom: 4 }}>
          <span style={{ color: "var(--text-secondary)", fontWeight: FW.medium, minWidth: 64, flexShrink: 0 }}>{label}</span>
          <div style={{ flex: 1, height: 8, background: "var(--bg-stepper)", borderRadius: 4,   /* @canvas */  overflow: "hidden", minWidth: 30 }}>
            <div style={{ width: ((val / max) * 100) + "%", height: "100%", background: color || "var(--accent)", opacity: 0.8, borderRadius: 4,   /* @canvas */ }} />
          </div>
          <span style={{ color: "var(--text-primary)", fontWeight: FW.bold, minWidth: 64, textAlign: "right", flexShrink: 0 }}>{val}</span>
        </div>
      );
    };
    if(st.totalBookings === 0 && st.noShows === 0){
      return <div style={{ fontSize: T.body, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>No bookings this month.</div>;
    }
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(6, 1fr)" : "repeat(5, 1fr)", gap: 8, marginBottom: 14 }}>
          {stat(st.totalCovers, "covers", undefined, 0)}
          {stat(st.totalBookings, "bookings", undefined, 1)}
          {stat(st.avgParty, "avg party", undefined, 2)}
          {stat(st.avgCoversPerDay, "covers / day", undefined, 3)}
          {stat(st.noShows, "no-shows", st.noShows ? "var(--warn-text)" : undefined, 4)}
        </div>
        <div style={{ fontSize: T.body, fontWeight: FW.bold, color: "var(--text-muted)", margin: "0 0 6px" }}>Busiest hours</div>
        <div style={{ marginBottom: 14 }}>
          {st.hours.slice(0, 6).map(function(h){ return bar(h.hour, hourLabel(h.hour), h.covers, maxH); })}
          {st.hours.length === 0 ? <div style={{ fontSize: T.body, color: "var(--text-faint)" }}>—</div> : null}
        </div>
        <div style={{ fontSize: T.body, fontWeight: FW.bold, color: "var(--text-muted)", margin: "0 0 6px" }}>Table usage</div>
        <div>
          {st.tables.slice(0, 10).map(function(t){ return bar(t.id, <TBadge id={t.id} missing={!inLayout.has(t.id)} />, t.bookings, maxT); })}
          {st.tables.length === 0 ? <div style={{ fontSize: T.body, color: "var(--text-faint)" }}>—</div> : null}
        </div>
      </div>
    );
  }

  // ── Month body: Mon-start calendar grid, busyness tint per in-month day ──
  function monthBody(){
    const weeks = monthGrid(ref);
    let maxCovers = 1;
    const data = {};
    weeks.forEach(function(wk){ wk.forEach(function(c){
      const sum = daySummary(bookings, c.date, 0);
      data[c.date] = { covers: sum.totalCovers, bookings: sum.totalBookings };
      if(c.inMonth) maxCovers = Math.max(maxCovers, sum.totalCovers);
    }); });
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
          {WDS.map(function(w){ return (
            <div key={w} style={{ textAlign: "center", fontSize: T.small, fontWeight: FW.bold, color: "var(--text-muted)" }}>{w}</div>
          ); })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {weeks.map(function(wk, wi){ return (
            <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
              {wk.map(function(c){
                const cov = data[c.date].covers;
                const isToday = c.date === today;
                const isSel = c.date === viewDate;
                const isFocused = c.date === focus;
                const dnum = Number(c.date.slice(8, 10));
                const intensity = c.inMonth ? cov / maxCovers : 0;
                return (
                  <button
                    key={c.date}
                    onClick={function(){ onPick(c.date); }}
                    className="mgt-hover-scale"
                    style={{
                      position: "relative", overflow: "hidden",
                      minHeight: 54,   /* @canvas */ padding: "6px 4px 4px", borderRadius: R.inset, cursor: "pointer",
                      boxSizing: "border-box", textAlign: "center",
                      background: CELL,
                      border: "1px solid " + (isFocused || isSel ? "var(--accent)" : "var(--border-input)"),
                      boxShadow: isFocused ? "0 0 0 2px var(--accent)" : "none"
                    }}
                  >
                    <div style={{ position: "absolute", inset: 0, background: "var(--accent)", opacity: intensity * HEAT, pointerEvents: "none" }} />
                    {/* v18.2.0: an out-of-month day fades its NUMBER, not the
                        cell — at 40% the whole button was see-through again,
                        the defect this phase fixes (and the paused reminder's
                        rule: fade the content, keep the surface). */}
                    <div style={{ position: "relative", opacity: c.inMonth ? 1 : OUT_OF_MONTH }}>
                      <div style={{ fontSize: T.body, fontWeight: FW.bold, color: isToday ? "var(--accent)" : "var(--text-primary)" }}>{dnum}</div>
                      <div style={{ fontSize: T.micro, fontWeight: FW.medium, color: cov ? "var(--text-secondary)" : "var(--text-faint)", marginTop: 2 }}>
                        {c.inMonth ? cov : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ); })}
        </div>
        {/* v18.2.0 (X2): the key the blue shading never had. The swatch runs
            from an empty day to the fullest one, which is exactly what the
            cells draw: the accent at up to HEAT (30%) over the cell. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, fontSize: T.small, color: "var(--text-muted)" }}>
          <span>Fewer covers</span>
          <span aria-hidden="true" style={{ width: 64, height: 8, borderRadius: 4,   /* @canvas */ border: "1px solid var(--border-input)", background: "linear-gradient(to right, " + CELL + ", color-mix(in srgb, var(--accent) " + (HEAT * 100) + "%, " + CELL + "))" }} />
          <span>More</span>
        </div>
      </div>
    );
  }
}
