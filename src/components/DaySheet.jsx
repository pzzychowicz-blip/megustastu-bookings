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
// (Time · Name · Guests · Tables · Phone · Deposit/voucher · Notes), any table blocks, and
// the day's waitlist entries.
//
// Props: bookings, date, splitHour, waitlist, blocks, restaurantName, currency (v17.0.0 — settings/general)

import { useEffect, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { T, FW, APP_NAME } from "../lib/constants";
import { daySummary, guestsLabel, countLabel } from "../lib/booking-logic";
import { formatPhone } from "../lib/customers";
import { normalizeCode, formatCode, money } from "../lib/vouchers";
// v18.0.0 session 8: ONE weekday list, in lib/day.js — this was the fourth copy.
import { WEEKDAY_LONG, formatDay } from "../lib/day";
// v17.10.2: was `weekdayOf`, which is ALSO exported from lib/constants.js — where
// it returns the day NUMBER (0–6). Two functions, one name, incompatible return
// types, one of them on the shared module. That is worse than a duplicate: it is
// a trap for whoever tidies up the "copy", because importing the shared one here
// silently prints a number in the print sheet's header instead of "Wednesday".
function weekdayName(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d) ? "" : WEEKDAY_LONG[d.getUTCDay()] || "";
}
// v18.2.0 phase 65 (Patryk): the saved file is named for its day. A browser
// names a print-to-PDF after `document.title`, which is the app's name, so
// every day's sheet saved as "MGT Bookings.pdf". ISO, like the app's two
// other files (mgt-backup-…, mgt-activity-…), so a folder of them sorts by day;
// a date that is not canonical (a booking's stored date can reach `viewDate`
// verbatim) names no day rather than a broken one.
// v18.4.0: a print of the TIMELINE alone (the chooser stamps `data-print` on
// <html> before it prints) is named for what it is. This sheet owns the title
// for every print because it is the one that is always mounted.
function sheetFileName(date) {
  const stem = document.documentElement.getAttribute("data-print") === "timeline" ? "mgt-timeline" : "mgt-day-sheet";
  return /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? stem + "-" + date : stem;
}

// Inline light-only styles (no tokens — print stays light).
const cell = { border: "1px solid #999", /* @fixed-fill */ padding: "4px 6px", fontSize: T.body, textAlign: "left", verticalAlign: "top", color: "#000" };
const th = Object.assign({}, cell, { fontWeight: FW.bold, background: "#eee" /* @fixed-fill */ });

// v17.1.0 perf: React.memo — always-mounted (print-only DOM) so it used to
// re-render on every BookingApp render; props are state objects + primitives.
export const DaySheet = memo(function DaySheet({ bookings, date, splitHour, waitlist, blocks, restaurantName, currency, vouchersOn = true }) {
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

  // The title carries the sheet's name only while it prints: `beforeprint` and
  // `afterprint` fire for the Summary's Print (the chooser, v18.4.0) AND for the browser's
  // own ⌘P, and both print this sheet (index.css hides #root in print). The
  // cleanup restores it too, should the day change or the sheet unmount mid-print.
  useEffect(function () {
    let prev = null;
    function before() { if (prev === null) prev = document.title; document.title = sheetFileName(date); }
    function after() { if (prev !== null) { document.title = prev; prev = null; } }
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return function () {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      after();
    };
  }, [date]);

  return createPortal(
    <div className="mgt-print-sheet" style={{ color: "#000", /* @fixed-fill */ background: "#fff", padding: 24, fontFamily: "-apple-system, system-ui, sans-serif" }}>
      <div style={{ borderBottom: "2px solid #000", /* @fixed-fill */ paddingBottom: 8, marginBottom: 12 }}>
        <div style={{ fontSize: T.display, fontWeight: FW.bold }}>{(restaurantName || APP_NAME) + " — Day sheet"}</div>
        <div style={{ fontSize: T.lead, marginTop: 2 }}>{weekdayName(date) + " · " + formatDay(date, { weekday: false, year: "always" })}</div>
        <div style={{ fontSize: T.body, marginTop: 4 }}>
          {countLabel(s.totalBookings, "booking", "bookings") + " · " + countLabel(s.totalCovers, "cover", "covers")
            + " · Afternoon " + s.afternoon.covers + " / Evening " + s.evening.covers}
        </div>
      </div>

      {day.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={th}>Time</th>
              <th style={th}>Name</th>
              <th style={th}>Guests</th>
              <th style={th}>Tables</th>
              <th style={th}>Phone</th>
              {/* v18.0.0 phase 4: the column is SHARED, so with the vouchers
                  module off it does not disappear — it narrows to what is left.
                  A header naming a feature the restaurant does not have is the
                  same defect on paper as on screen, and this sheet is read at
                  the table by people who never open Settings. */}
              <th style={th}>{vouchersOn ? "Deposit / voucher" : "Deposit"}</th>
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
                  {/* v18.2.0 phase 50 (C-4): the one phone shape, as on screen. */}
                  <td style={cell}>{b.phone ? formatPhone(b.phone) : "—"}</td>
                  {/* v18.0.0: deposit and voucher share one money column. A
                      separate column would widen a sheet that is printed on
                      A4 and read at the table, and the two are the same
                      question — has this guest already paid something. */}
                  <td style={cell}>{[
                    (Number(b.deposit) || 0) > 0 ? money(Number(b.deposit), currency || "€") : null,
                    vouchersOn && normalizeCode(b.voucherCode) ? formatCode(b.voucherCode) : null,
                  ].filter(Boolean).join("  ·  ") || "—"}</td>
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
            return <div key={w.id}>{(i + 1) + ". " + (w.name || "—") + " · " + guestsLabel(w.size) + (w.preference === "indoor" ? " · indoor" : w.preference === "outdoor" ? " · outdoor" : "") + (w.prefTime ? " · wants " + w.prefTime : "") + (w.phone ? " · " + formatPhone(w.phone) : "")}</div>;
          })}
        </div>
      ) : null}

      {/* v17.15.2: the printed footer names the APP, not the restaurant. It used
          to compose `restaurantName + " Booking System"`, which made the app's
          own name a different string per restaurant setting — the same defect
          the deposit flag had when it printed the configured currency symbol.
          The heading above already carries the restaurant name, so this line
          was also saying it twice. */}
      <div style={{ marginTop: 18, fontSize: T.micro, color: "#666" /* @fixed-fill */ }}>{APP_NAME}</div>
    </div>,
    document.body
  );
}
);
