// src/components/DaySheet.jsx
//
// v16.3.0 — printable day sheet for the pass. A print-ONLY DOM (hidden on
// screen via `.mgt-print-sheet { display:none }`, revealed by the `@media print`
// block in index.html which also hides #root). Portalled to document.body so it
// is a SIBLING of #root — otherwise hiding #root would hide the sheet too.
//
// DELIBERATELY hard-coded LIGHT (black on white, literal colours, no var(--…)):
// the project's "print path stays light regardless of in-app theme" rule. This
// is the one component exempt from the no-colour-literals convention.
//
// Content for `date`: header (restaurant, date + weekday, covers + shift totals
// via daySummary), a time-sorted table of the day's NON-cancelled bookings
// (Time · Name · Pax · Tables · Phone · Deposit · Notes), any table blocks, and
// the day's waitlist entries.
//
// Props: bookings, date, splitHour, waitlist, blocks, restaurantName, currency (v17.0.0 — settings/general)

import { useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { T, FW } from "../lib/constants";
import { daySummary } from "../lib/booking-logic";

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// v17.10.2: was `weekdayOf`, which is ALSO exported from lib/constants.js — where
// it returns the day NUMBER (0–6). Two functions, one name, incompatible return
// types, one of them on the shared module. That is worse than a duplicate: it is
// a trap for whoever tidies up the "copy", because importing the shared one here
// silently prints a number in the print sheet's header instead of "Wednesday".
function weekdayName(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d) ? "" : WD[d.getUTCDay()] || "";
}
// Inline light-only styles (no tokens — print stays light).
const cell = { border: "1px solid #999", /* @fixed-fill */ padding: "4px 6px", fontSize: T.body, textAlign: "left", verticalAlign: "top", color: "#000" };
const th = Object.assign({}, cell, { fontWeight: FW.bold, background: "#eee" /* @fixed-fill */ });

// v17.1.0 perf: React.memo — always-mounted (print-only DOM) so it used to
// re-render on every BookingApp render; props are state objects + primitives.
export const DaySheet = memo(function DaySheet({ bookings, date, splitHour, waitlist, blocks, restaurantName, currency }) {
  // /code-review: the sheet is PERMANENTLY mounted (display:none) and BookingApp
  // re-renders every 15s tick — memoise the filter/sort/summary passes so they
  // run only when the underlying data (not the clock) changes. This is the
  // profiled-need exception to the "no memo by default" rule: a known
  // every-15s recomputation over the whole bookings list with zero visual output.
  const day = useMemo(function () {
    return (bookings || [])
      .filter(function (b) { return b && b.date === date && b.status !== "cancelled"; })
      .slice()
      .sort(function (a, b) { return (a.time || "").localeCompare(b.time || ""); });
  }, [bookings, date]);
  const s = useMemo(function () { return daySummary(bookings, date, splitHour); }, [bookings, date, splitHour]);
  const dayBlocks = useMemo(function () {
    return (blocks || []).filter(function (bl) { return bl && bl.date === date; });
  }, [blocks, date]);
  const dayWait = useMemo(function () {
    return (waitlist || [])
      .filter(function (w) { return w && w.date === date && w.status === "waiting"; })
      .slice()
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
  }, [waitlist, date]);

  return createPortal(
    <div className="mgt-print-sheet" style={{ color: "#000", /* @fixed-fill */ background: "#fff", padding: 24, fontFamily: "-apple-system, system-ui, sans-serif" }}>
      <div style={{ borderBottom: "2px solid #000", /* @fixed-fill */ paddingBottom: 8, marginBottom: 12 }}>
        <div style={{ fontSize: T.display, fontWeight: FW.bold }}>{(restaurantName || "Me Gustas Tú") + " — Day sheet"}</div>
        <div style={{ fontSize: T.lead, marginTop: 2 }}>{weekdayName(date) + " · " + date}</div>
        <div style={{ fontSize: T.body, marginTop: 4 }}>
          {s.totalBookings + " booking" + (s.totalBookings !== 1 ? "s" : "") + " · " + s.totalCovers + " cover" + (s.totalCovers !== 1 ? "s" : "")
            + " · Afternoon " + s.afternoon.covers + " / Evening " + s.evening.covers}
        </div>
      </div>

      {day.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={th}>Time</th>
              <th style={th}>Name</th>
              <th style={th}>Pax</th>
              <th style={th}>Tables</th>
              <th style={th}>Phone</th>
              <th style={th}>Deposit</th>
              <th style={th}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {day.map(function (b) {
              return (
                <tr key={b.id}>
                  <td style={cell}>{b.scheduledTime || b.time}</td>
                  <td style={Object.assign({}, cell, { fontWeight: FW.bold })}>{b.name || "—"}{b.status === "seated" ? " (seated)" : b.status === "completed" ? " (done)" : b.status === "pending" ? " (pending)" : ""}</td>
                  <td style={cell}>{b.size}</td>
                  <td style={cell}>{(b.tables || []).join(", ") || "—"}</td>
                  <td style={cell}>{b.phone || "—"}</td>
                  <td style={cell}>{(Number(b.deposit) || 0) > 0 ? (currency || "€") + b.deposit : "—"}</td>
                  <td style={cell}>{b.notes || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <div style={{ fontSize: T.body, marginBottom: 16 }}>No bookings for this day.</div>}

      {dayBlocks.length ? (
        <div style={{ marginBottom: 12, fontSize: T.body }}>
          <div style={{ fontWeight: FW.bold, marginBottom: 4 }}>Blocked tables</div>
          {dayBlocks.map(function (bl) {
            return <div key={bl.id}>{bl.tableId + " — " + (bl.allDay ? "all day" : (bl.from + "–" + bl.to)) + (bl.reason ? " (" + bl.reason + ")" : "")}</div>;
          })}
        </div>
      ) : null}

      {dayWait.length ? (
        <div style={{ fontSize: T.body }}>
          <div style={{ fontWeight: FW.bold, marginBottom: 4 }}>Waitlist</div>
          {dayWait.map(function (w, i) {
            return <div key={w.id}>{(i + 1) + ". " + (w.name || "—") + " · " + w.size + " pax" + (w.prefTime ? " · wants " + w.prefTime : "") + (w.phone ? " · " + w.phone : "")}</div>;
          })}
        </div>
      ) : null}

      {/* v17.15.2: the printed footer names the APP, not the restaurant. It used
          to compose `restaurantName + " Booking System"`, which made the app's
          own name a different string per restaurant setting — the same defect
          the deposit flag had when it printed the configured currency symbol.
          The heading above already carries the restaurant name, so this line
          was also saying it twice. */}
      <div style={{ marginTop: 18, fontSize: T.micro, color: "#666" /* @fixed-fill */ }}>MGT Bookings</div>
    </div>,
    document.body
  );
}
);
