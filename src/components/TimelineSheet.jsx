// src/components/TimelineSheet.jsx
//
// v18.4.0 — the printed TIMELINE: the day's grid on paper, beside the day sheet's
// list (DaySheet.jsx). Patryk asked for "a print screen of the grid"; this is a
// print-only DOM instead of a captured image, so it is sharp at any size, shows
// the whole chosen range whatever the screen's zoom and scroll were, and needs
// no library.
//
// Like DaySheet it is portalled to <body> (a SIBLING of #root, which the print
// stylesheet hides) and it is HARD-CODED LIGHT: the print path stays light in
// any theme, so every colour here is a literal and none is a `var(--…)`. The
// status fills are the LIGHT theme's `--block-*` values (`PRINT_FILL`,
// lib/print-timeline.js), which is what "status colours as on screen" means on
// white paper.
//
// Unlike DaySheet it is NOT permanently mounted. App mounts it for one print
// job (`from`–`to`, whole hours, from the print chooser) and unmounts it on
// `afterprint`: it walks every booking for the repeat-no-show flag, which a
// hidden, always-mounted sheet would redo on every booking write.
//
// Geometry is in PERCENT of the chosen range, so the grid fills whatever page
// width the device gives it: index.css asks for a landscape page
// (`@page mgt-timeline`), and a browser that ignores that still prints the
// whole range across a portrait one.
//
// What it draws: the header (restaurant, date, totals, the range), an hour
// axis, the Unplaced lanes when there are any (lib/unplaced.js, the screen's
// rule), one row per table with its bookings and its blocked spans, a legend.
// A block carries its start time, name, party size, status mark and the rail's
// flags (blockFlags.jsx, the screen's list). Seated bookings are drawn at their
// BOOKED duration: paper has no clock to grow them against.
//
// Props: bookings, date, blocks, from, to, splitHour, restaurantName, currency

import { useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { T, FW, IC, SP, APP_NAME, TIMELINE_TABLES } from "../lib/constants";
import { daySummary, countLabel, toMins, isReadableBlock } from "../lib/booking-logic";
import { noShowMap, identityKey } from "../lib/customers";
import { unplacedOf, packLanes } from "../lib/unplaced";
import { WEEKDAY_LONG, formatDay } from "../lib/day";
import { hourLabel } from "../lib/time-grid";
import { StatusIcon } from "./Icons";
import { railFlagsOf } from "./blockFlags";
import { PRINT_FILL, spanIn } from "../lib/print-timeline";

const STATUS_WORD = { confirmed: "Confirmed", pending: "Pending", seated: "Seated", completed: "Completed" };
const INK = "#fff"; /* @fixed-fill */
const RULE = "#bbb"; /* @fixed-fill */
const RULE_SOFT = "#e2e2e2"; /* @fixed-fill */
const LABEL_W = 62;
const ROW_H = 26;

function weekdayName(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d) ? "" : WEEKDAY_LONG[d.getUTCDay()] || "";
}
function isTime(t) { return typeof t === "string" && /^\d{1,2}:\d{2}/.test(t); }

const trackStyle = { position: "relative", height: ROW_H, /* @canvas */ borderBottom: "1px solid " + RULE };
const labelStyle = { width: LABEL_W, flexShrink: 0, fontSize: T.small, fontWeight: FW.bold, color: "#000", /* @fixed-fill */ display: "flex", alignItems: "center", borderBottom: "1px solid " + RULE, boxSizing: "border-box" };

function HourLines({ hours, fromM, toM }) {
  return hours.map(function (h) {
    return <div key={h} style={{ position: "absolute", top: 0, bottom: 0, left: (((h * 60) - fromM) / (toM - fromM)) * 100 + "%", width: 1, background: RULE_SOFT }} />;
  });
}

function SheetBlock({ b, pos, flags, dashed }) {
  const fill = PRINT_FILL[b.status] || PRINT_FILL.confirmed;
  return (
    <div style={{
      position: "absolute", top: 2, bottom: 2, left: pos.left + "%", width: pos.width + "%",
      boxSizing: "border-box", overflow: "hidden",
      display: "flex", alignItems: "center", gap: SP.tight, padding: "0 4px",
      background: fill, color: INK,
      border: dashed ? "1px dashed #333" /* @fixed-fill */ : "1px solid rgba(0, 0, 0, 0.25)", /* @fixed-fill */
      borderRadius: (pos.cutL ? "0" : "6px") + " " + (pos.cutR ? "0 0" : "6px 6px") + " " + (pos.cutL ? "0" : "6px"), /* @canvas */
      fontSize: T.micro, lineHeight: 1.1, whiteSpace: "nowrap"
    }}>
      <span style={{ fontWeight: FW.bold, flexShrink: 0 }}>{b.scheduledTime || b.time}</span>
      <span style={{ fontWeight: FW.semi, flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{b.name || "—"}</span>
      <span style={{ fontWeight: FW.bold, flexShrink: 0 }}>{b.size}</span>
      <span style={{ display: "inline-flex", flexShrink: 0 }}><StatusIcon status={b.status} size={IC.inline} /></span>
      {flags.map(function (f) { return <span key={f.k} title={f.title} style={{ display: "inline-flex", flexShrink: 0 }}>{f.icon}</span>; })}
    </div>
  );
}

export const TimelineSheet = memo(function TimelineSheet({ bookings, date, blocks, from, to, splitHour, restaurantName, currency }) {
  const fromM = from * 60, toM = to * 60;
  const day = useMemo(function () {
    return (bookings || []).filter(function (b) { return b && b.date === date && b.status !== "cancelled" && isTime(b.time); });
  }, [bookings, date]);
  const nsMap = useMemo(function () { return noShowMap(bookings); }, [bookings]);
  const s = useMemo(function () { return daySummary(bookings, date, splitHour); }, [bookings, date, splitHour]);
  const dayBlocks = useMemo(function () {
    return (blocks || []).filter(function (bl) { return bl && bl.date === date && isReadableBlock(bl); });
  }, [blocks, date]);

  const gridIds = new Set(TIMELINE_TABLES.map(function (t) { return t.id; }));
  const endOf = function (b) { return toMins(b.time) + (Number(b.duration) || 90); };
  const lanes = packLanes(unplacedOf(day, gridIds).map(function (u) {
    return { id: u.b.id, s: toMins(u.b.time), e: endOf(u.b), b: u.b };
  }));
  const hours = [];
  for (let h = from; h <= to; h++) hours.push(h);
  const flagsOf = function (b) { return railFlagsOf(b, nsMap[identityKey(b)] || 0, null, currency || "€"); };
  const blockIn = function (b, dashed) {
    const pos = spanIn(toMins(b.time), endOf(b), fromM, toM);
    return pos ? <SheetBlock key={b.id} b={b} pos={pos} flags={flagsOf(b)} dashed={dashed} /> : null;
  };
  const statuses = Object.keys(PRINT_FILL).filter(function (st) { return day.some(function (b) { return b.status === st; }); });

  return createPortal(
    <div className="mgt-print-timeline" style={{ color: "#000", /* @fixed-fill */ background: "#fff", /* @fixed-fill */ fontFamily: "-apple-system, system-ui, sans-serif" }}>
      <div style={{ borderBottom: "2px solid #000", /* @fixed-fill */ paddingBottom: 6, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: T.title, fontWeight: FW.bold }}>{(restaurantName || APP_NAME) + " — Timeline"}</div>
        <div style={{ fontSize: T.lead }}>{weekdayName(date) + " · " + formatDay(date, { weekday: false, year: "always" }) + " · " + hourLabel(from) + "–" + hourLabel(to)}</div>
        <div style={{ fontSize: T.body, marginLeft: "auto" }}>
          {countLabel(s.totalBookings, "booking", "bookings") + " · " + countLabel(s.totalCovers, "cover", "covers")
            + " · Afternoon " + s.afternoon.covers + " / Evening " + s.evening.covers}
        </div>
      </div>

      {/* The hour axis: each label centred on its line, the first and last
          pulled inside so neither is cut by the page edge. */}
      <div style={{ display: "flex" }}>
        <div style={{ width: LABEL_W, flexShrink: 0 }} />
        <div style={{ position: "relative", flex: 1, height: 16, /* @canvas */ borderBottom: "1px solid #000" /* @fixed-fill */ }}>
          {hours.map(function (h, i) {
            const last = i === hours.length - 1;
            return <div key={h} style={{ position: "absolute", top: 0, left: ((h - from) / (to - from)) * 100 + "%", transform: i === 0 ? "none" : last ? "translateX(-100%)" : "translateX(-50%)", fontSize: T.micro, fontWeight: FW.semi }}>{hourLabel(h)}</div>;
          })}
        </div>
      </div>

      {lanes.map(function (lane, i) {
        return (
          <div key={"u" + i} style={{ display: "flex", breakInside: "avoid" }}>
            <div style={labelStyle}>{i === 0 ? "Unplaced" : ""}</div>
            <div style={Object.assign({ flex: 1 }, trackStyle)}>
              <HourLines hours={hours} fromM={fromM} toM={toM} />
              {lane.map(function (it) { return blockIn(it.b, true); })}
            </div>
          </div>
        );
      })}

      {TIMELINE_TABLES.map(function (t) {
        const rowBlocks = dayBlocks.filter(function (bl) { return bl.tableId === t.id; });
        return (
          <div key={t.id} style={{ display: "flex", breakInside: "avoid" }}>
            <div style={labelStyle}>{t.id}</div>
            <div style={Object.assign({ flex: 1 }, trackStyle)}>
              <HourLines hours={hours} fromM={fromM} toM={toM} />
              {rowBlocks.map(function (bl) {
                const pos = bl.allDay ? { left: 0, width: 100 } : spanIn(toMins(bl.from), toMins(bl.to), fromM, toM);
                if (!pos) return null;
                return (
                  <div key={bl.id || (bl.from + "-" + bl.to)} style={{
                    position: "absolute", top: 0, bottom: 0, left: pos.left + "%", width: pos.width + "%",
                    boxSizing: "border-box", overflow: "hidden", padding: "0 4px",
                    display: "flex", alignItems: "center",
                    background: "repeating-linear-gradient(135deg, #f1c9c9 0 4px, #fff 4px 8px)", /* @fixed-fill */
                    border: "1px solid #b33", /* @fixed-fill */
                    color: "#7a1f1f", /* @fixed-fill */
                    fontSize: T.micro, fontWeight: FW.semi, whiteSpace: "nowrap"
                  }}>{"Blocked" + (bl.reason ? " — " + bl.reason : "")}</div>
                );
              })}
              {day.filter(function (b) { return (b.tables || []).indexOf(t.id) >= 0; }).map(function (b) { return blockIn(b, false); })}
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 8, fontSize: T.micro, color: "#444" /* @fixed-fill */ }}>
        {statuses.map(function (st) {
          return (
            <span key={st} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 12, /* @canvas */ borderRadius: 3, /* @canvas */ background: PRINT_FILL[st], color: INK }}><StatusIcon status={st} size={IC.inline} /></span>
              {STATUS_WORD[st]}
            </span>
          );
        })}
        <span style={{ marginLeft: "auto" }}>{APP_NAME}</span>
      </div>
    </div>,
    document.body
  );
});
