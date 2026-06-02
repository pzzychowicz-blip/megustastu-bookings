// src/components/WeekView.jsx
// Week-at-a-glance popover, opened from the Summary panel. Shows the 7 days
// (Mon–Sun, European convention) of the week containing a reference date, each
// with its booking count and cover count (Σ size over non-cancelled). Tap a day
// to jump to it (sets viewDate + closes). ‹ › navigate weeks without committing
// until a day is tapped; "This week" returns to today's week.
//
// Uses the shared Overlay (with the v14.4.1 pinned-footer slot) for the
// scrim/card + the nav/close footer. Per-day counts reuse `daySummary`
// (splitHour is irrelevant for the totals, so 0 is passed).
//
// v14.7.0.

import { useState, useEffect } from "react";
import { Overlay, mkBtn } from "./atoms";
import { daySummary } from "../lib/booking-logic";
import { BTN } from "../lib/constants";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 7 ISO date strings (Mon→Sun) for the week containing `dateStr`.
function weekDates(dateStr){
  // All-UTC arithmetic: a "YYYY-MM-DD" string parses as UTC midnight and
  // toISOString is UTC, so the day-of-week + ±day math stays consistent.
  // (Mixing local getDate() with UTC toISOString shifted the whole week back a
  // day in UTC+ timezones — that was the bug the live preview caught.)
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
function rangeLabel(days){
  const a = new Date(days[0]);
  const b = new Date(days[6]);
  const aL = MON[a.getUTCMonth()] + " " + a.getUTCDate();
  const bL = (a.getUTCMonth() === b.getUTCMonth() ? "" : MON[b.getUTCMonth()] + " ") + b.getUTCDate();
  return aL + " – " + bL + ", " + b.getUTCFullYear();
}

export function WeekView({ bookings, viewDate, onPick, onClose }){
  const [ref, setRef] = useState(viewDate);
  // Keyboard focus row (0 = Mon … 6 = Sun). Starts on the day you came from.
  const [focusIdx, setFocusIdx] = useState(function(){ const d = new Date(viewDate); return (d.getUTCDay() + 6) % 7; });
  const today = new Date().toISOString().slice(0, 10);
  const days = weekDates(ref);
  const rows = days.map(function(d){
    const sum = daySummary(bookings, d, 0); // splitHour irrelevant for totals
    return { date: d, covers: sum.totalCovers, bookings: sum.totalBookings };
  });
  const maxCovers = rows.reduce(function(m, r){ return Math.max(m, r.covers); }, 0) || 1;

  function shiftWeek(delta){
    const x = new Date(ref);
    x.setUTCDate(x.getUTCDate() + delta * 7);
    setRef(x.toISOString().slice(0, 10));
  }

  // Keyboard nav while the popover is open. The global handler suppresses these
  // (showWeek is in anyModal; its Enter falls through to a bare return), so
  // WeekView owns them: ←/→ = prev/next week, ↑/↓ = move the day focus, T = this
  // week, Enter = open the focused day. (Esc / backdrop close stays with the
  // shared Overlay + global handler.)
  useEffect(function(){
    function onKey(e){
      if(e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if(k === "ArrowLeft"){ e.preventDefault(); shiftWeek(-1); }
      else if(k === "ArrowRight"){ e.preventDefault(); shiftWeek(1); }
      else if(k === "ArrowUp"){ e.preventDefault(); setFocusIdx(function(f){ return (f + 6) % 7; }); }
      else if(k === "ArrowDown"){ e.preventDefault(); setFocusIdx(function(f){ return (f + 1) % 7; }); }
      else if(k === "t" || k === "T"){ e.preventDefault(); setRef(today); }
      else if(k === "Enter"){ e.preventDefault(); onPick(days[focusIdx]); }
    }
    window.addEventListener("keydown", onKey);
    return function(){ window.removeEventListener("keydown", onKey); };
  }, [ref, focusIdx]);

  const footer = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button onClick={function(){ shiftWeek(-1); }} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, minWidth: 40, padding: "6px 12px", fontSize: 18, background: BTN.nav })} dangerouslySetInnerHTML={{ __html: "&#8249;" }} />
        <button onClick={function(){ setRef(today); }} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "6px 14px", background: BTN.today })}>This week</button>
        <button onClick={function(){ shiftWeek(1); }} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, minWidth: 40, padding: "6px 12px", fontSize: 18, background: BTN.nav })} dangerouslySetInnerHTML={{ __html: "&#8250;" }} />
      </div>
      <button onClick={onClose} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "8px 18px", background: "var(--app-btn-slate)" })}>Close</button>
    </div>
  );

  return (
    <Overlay onClose={onClose} footer={footer}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-on-accent)", display: "inline-block", padding: "8px 16px", borderRadius: 12, background: "rgba(0,122,255,0.75)", border: "1px solid rgba(255,255,255,0.2)", boxShadow: "0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)" }}>
          Week
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginTop: 8 }}>{rangeLabel(days)}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map(function(r, i){
          const isToday = r.date === today;
          const isSel = r.date === viewDate;
          const isFocused = i === focusIdx;
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
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-faint)", textAlign: "center" }}>
        ↑↓ day · ←→ week · T this week · Enter open
      </div>
    </Overlay>
  );
}
