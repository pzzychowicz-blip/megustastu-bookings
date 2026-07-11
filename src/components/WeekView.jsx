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
// Tap a day to jump to it (sets viewDate + closes). The footer ‹ › navigate the
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
import { Overlay, mkBtn, AutoHeight } from "./atoms";
import { daySummary, rangeStats } from "../lib/booking-logic";
import { BTN } from "../lib/constants";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];   // week-list rows
const WDS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];          // month-grid header
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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

function weekRangeLabel(days){
  const a = new Date(days[0]);
  const b = new Date(days[6]);
  const aL = MON[a.getUTCMonth()] + " " + a.getUTCDate();
  const bL = (a.getUTCMonth() === b.getUTCMonth() ? "" : MON[b.getUTCMonth()] + " ") + b.getUTCDate();
  return aL + " – " + bL + ", " + b.getUTCFullYear();
}
function monthLabel(dateStr){
  const d = new Date(dateStr);
  return MONF[d.getUTCMonth()] + " " + d.getUTCFullYear();
}
function sameMonth(a, b){
  const x = new Date(a), y = new Date(b);
  return x.getUTCMonth() === y.getUTCMonth() && x.getUTCFullYear() === y.getUTCFullYear();
}
function addDays(dateStr, n){
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function WeekView({ bookings, viewDate, onPick, onClose }){
  const [mode, setMode] = useState("week");   // "week" | "month"
  const [ref, setRef] = useState(viewDate);    // a date inside the displayed period
  const [focus, setFocus] = useState(viewDate); // keyboard-highlighted day
  const today = new Date().toISOString().slice(0, 10);
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
  }, [mode, ref, focus]);

  // ── Header: Week/Month segmented control + period label ──
  function modeBtn(m, label){
    const active = mode === m;
    return (
      <button
        onClick={function(){ switchMode(m); }}
        className="mgt-hover-scale"
        style={{
          border: "none", borderRadius: 9, padding: "6px 18px", cursor: "pointer",
          fontSize: 13, fontWeight: 700, minHeight: 32,
          background: active ? "rgba(0,122,255,0.85)" : "transparent",
          color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
          boxShadow: active ? "0 1px 3px rgba(0,0,0,0.15), inset 0 1px 1px rgba(255,255,255,0.15)" : "none"
        }}
      >
        {label}
      </button>
    );
  }

  // ── Footer (mode-aware nav) ──
  const footer = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button onClick={function(){ isWeek ? goWeek(-1) : goMonth(-1); }} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, minWidth: 40, padding: "6px 12px", fontSize: 18, background: BTN.nav })} dangerouslySetInnerHTML={{ __html: "&#8249;" }} />
        <button onClick={goToday} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "6px 14px", background: BTN.today })}>{isWeek ? "This week" : "This month"}</button>
        <button onClick={function(){ isWeek ? goWeek(1) : goMonth(1); }} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, minWidth: 40, padding: "6px 12px", fontSize: 18, background: BTN.nav })} dangerouslySetInnerHTML={{ __html: "&#8250;" }} />
      </div>
      <button onClick={onClose} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "8px 18px", background: "var(--app-btn-slate)" })}>Close</button>
    </div>
  );

  return (
    <Overlay onClose={onClose} footer={footer}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 12, background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
          {modeBtn("week", "Week")}
          {modeBtn("month", "Month")}
          {modeBtn("stats", "Stats")}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginTop: 8 }}>
          {isWeek ? weekRangeLabel(weekDates(ref)) : monthLabel(ref)}
        </div>
      </div>

      {/* v15.8.0: AutoHeight (linear) eases the height when switching Week↔Month. */}
      <AutoHeight linear>{isStats ? statsBody() : isWeek ? weekBody() : monthBody()}</AutoHeight>

      <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-faint)", textAlign: "center" }}>
        {isStats
          ? "W/M/S view · ‹ › month · T this month"
          : isWeek
            ? "W/M/S view · ↑↓ day · ←→ week · T today · Enter open"
            : "W/M/S view · ↑↓←→ day · ‹ › month · T today · Enter open"}
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
                padding: "10px 12px", borderRadius: 12, cursor: "pointer",
                width: "100%", boxSizing: "border-box", textAlign: "left",
                background: "var(--bg-input)",
                border: "1px solid " + (isFocused || isSel ? "var(--accent)" : "var(--border-input)"),
                boxShadow: isFocused ? "0 0 0 2px var(--accent)" : "none"
              }}
            >
              <div style={{ minWidth: 56, flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isToday ? "var(--accent)" : "var(--text-primary)" }}>{WD[i]}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>{dnum + (isToday ? " · today" : "")}</div>
              </div>
              <div style={{ flex: 1, height: 8, background: "var(--bg-stepper)", borderRadius: 4, overflow: "hidden", minWidth: 30 }}>
                <div style={{ width: ((r.covers / maxCovers) * 100) + "%", height: "100%", background: "var(--accent)", opacity: r.covers ? 0.8 : 0, borderRadius: 4 }} />
              </div>
              <div style={{ minWidth: 86, textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{r.covers + " cover" + (r.covers !== 1 ? "s" : "")}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-faint)" }}>{r.bookings + " booking" + (r.bookings !== 1 ? "s" : "")}</div>
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
    const stat = function(val, label, color){
      return (
        <div style={{ flex: "1 1 84px", padding: "8px 10px", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: color || "var(--text-primary)" }}>{val}</div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>{label}</div>
        </div>
      );
    };
    const bar = function(label, val, max, color){
      return (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: "var(--text-secondary)", fontWeight: 600, minWidth: 64, flexShrink: 0 }}>{label}</span>
          <div style={{ flex: 1, height: 8, background: "var(--bg-stepper)", borderRadius: 4, overflow: "hidden", minWidth: 30 }}>
            <div style={{ width: ((val / max) * 100) + "%", height: "100%", background: color || "var(--accent)", opacity: 0.8, borderRadius: 4 }} />
          </div>
          <span style={{ color: "var(--text-primary)", fontWeight: 700, minWidth: 64, textAlign: "right", flexShrink: 0 }}>{val}</span>
        </div>
      );
    };
    if(st.totalBookings === 0 && st.noShows === 0){
      return <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>No bookings this month.</div>;
    }
    return (
      <div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {stat(st.totalCovers, "covers")}
          {stat(st.totalBookings, "bookings")}
          {stat(st.avgParty, "avg party")}
          {stat(st.avgCoversPerDay, "covers / day")}
          {stat(st.noShows, "no-shows", st.noShows ? "var(--warn-text)" : undefined)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", margin: "0 0 6px" }}>Busiest hours</div>
        <div style={{ marginBottom: 14 }}>
          {st.hours.slice(0, 6).map(function(h){ return bar(String(h.hour).padStart(2, "0") + ":00", h.covers, maxH); })}
          {st.hours.length === 0 ? <div style={{ fontSize: 12, color: "var(--text-faint)" }}>—</div> : null}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", margin: "0 0 6px" }}>Table usage</div>
        <div>
          {st.tables.slice(0, 10).map(function(t){ return bar("Table " + t.id, t.bookings, maxT); })}
          {st.tables.length === 0 ? <div style={{ fontSize: 12, color: "var(--text-faint)" }}>—</div> : null}
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
            <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>{w}</div>
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
                      minHeight: 54, padding: "6px 4px 5px", borderRadius: 10, cursor: "pointer",
                      boxSizing: "border-box", textAlign: "center",
                      background: "var(--bg-input)",
                      opacity: c.inMonth ? 1 : 0.4,
                      border: "1px solid " + (isFocused || isSel ? "var(--accent)" : "var(--border-input)"),
                      boxShadow: isFocused ? "0 0 0 2px var(--accent)" : "none"
                    }}
                  >
                    <div style={{ position: "absolute", inset: 0, background: "var(--accent)", opacity: intensity * 0.3, pointerEvents: "none" }} />
                    <div style={{ position: "relative" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isToday ? "var(--accent)" : "var(--text-primary)" }}>{dnum}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: cov ? "var(--text-secondary)" : "var(--text-faint)", marginTop: 1 }}>
                        {c.inMonth ? cov : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ); })}
        </div>
      </div>
    );
  }
}
