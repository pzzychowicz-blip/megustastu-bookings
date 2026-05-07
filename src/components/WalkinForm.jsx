// src/components/WalkinForm.jsx
// Modal form for seating a walk-in guest immediately. Different from the
// regular booking form in three important ways:
//
//   1. Date is always today, time defaults to "right now" (rounded to the
//      minute). Staff can override the time but rarely does.
//   2. The guest is created with status "seated" and `_locked: true`,
//      meaning the optimizer won't reshuffle their tables.
//   3. Tables are picked manually via the same TableGrid the ManualModal
//      uses. There's no "auto" option — the host has the guest right in
//      front of them, so they decide which table to use.
//
// Kitchen-busy guard: if seating this party at this time would push the
// kitchen over its concurrent-start limit, the parent's `onSave` handler
// shows a confirmation modal first. That logic lives in BookingApp, not
// here — this component just calls `onSave()` when the Seat button is
// pressed.
//
// Parent wires up:
//   • Conditional render: only mount when the walk-in flow is active.
//   • Visibility close: `onClose()` handler. The modal's Overlay onClose
//     and the Cancel button both call it.
//   • Save handler: `onSave()` — kitchen-busy decision + actual save.
//   • Walk-in number: `walkinNum` is computed by the parent before
//     mounting (it scans existing bookings for the highest "Walk-in N").
//     Recomputed every render to stay current; the actual save in the
//     parent re-derives it for write-time correctness.
//
// Phase B5 (v15-refactor): extracted from App.jsx (the inline `walkinModal`
// IIFE) and converted RC() → JSX. Behaviour, output markup, and all inline
// styles are byte-identical to the original.
//
// Phase C1 (v15-refactor): the local `getCapOf` is now imported as
// `comboCapBest` from booking-logic.js (same algorithm, single canonical
// source — also used by ManualModal). The `localNowTime` fallback is
// replaced by the imported `nowTime`.

import { S, BTN, KITCHEN_TABLE_LIMIT } from "../lib/constants";
import {
  toMins, toTime, getDur,
  getBlockSlots, getBusy,
  findBest, findBestAny,
  optimizerActiveFor, findTimes, formatSugg,
  getKitchenLoad, findKitchenFriendlyTimes,
  comboCapBest, nowTime
} from "../lib/booking-logic";
import { Overlay, Section, Fld, AvailBanner, mkInp, mkBtn } from "./atoms";
import { TableGrid } from "./TableGrid";

export function WalkinForm({
  draft, setDraft,
  error,
  liveBookings, bookings, tableBlocks, autoOptimizer,
  walkinNum, isMobile,
  onSave, onClose
}) {
  const wf = draft;
  const wSize = Number(wf.size) || 2;
  // Fallback if the draft has no time (initial state). Parent's openWalkin
  // already seeds `time` to nowTime(), so this branch is rarely taken — kept
  // for parity with the original.
  const wTime = wf.time || nowTime();
  const wDur = wf.customDur || getDur(wSize);
  const wDate = new Date().toISOString().slice(0, 10);
  const wS = toMins(wTime);
  const wE = wS + wDur;

  // Build the "other slots" array for availability checks. Excludes
  // cancelled bookings and any bookings without tables (those don't occupy
  // anything). Then concat the table-blocks for the same date.
  const wOther = liveBookings
    .filter((b) => b && b.date === wDate && b.status !== "cancelled" && (b.tables || []).length > 0)
    .map((b) => ({
      tables: b.tables || [],
      s: toMins(b.time),
      e: toMins(b.time) + (b.duration || 90)
    }))
    .concat(getBlockSlots(tableBlocks, wDate));
  const wBusy = getBusy(wOther, wS, wE);

  // Auto-check: only relevant when the host hasn't picked any tables yet.
  // First tries an automatic best-fit; if nothing fits, returns suggestion
  // chips (alternative times before/after) for the AvailBanner to render.
  const wAutoCheck = (() => {
    const pre = findBest(wSize, "auto", wS, wE, wOther) || findBestAny(wSize, wS, wE, wOther);
    if (pre) return null;
    const noResh = !optimizerActiveFor(wDate, autoOptimizer);
    const sugg = findTimes(wDate, wSize, "auto", liveBookings, wDur, wS, tableBlocks, null, noResh);
    return formatSugg(sugg, wS);
  })();

  // Capacity computation — see booking-logic.js#comboCapBest. Local alias
  // keeps existing call sites readable.
  const getCapOf = comboCapBest;

  // Toggle a table on/off. Auto-prunes the selection so the host doesn't
  // accumulate redundant tables once `wSize` is met. Refuses i1+i4 without
  // i2 AND i3 (the indoor cluster must be physically contiguous).
  function wToggle(id) {
    if (wBusy.has(id)) return;
    const sel = wf.tables || [];
    if (sel.includes(id)) {
      setDraft({ ...wf, tables: sel.filter((x) => x !== id) });
      return;
    }
    let next = sel.concat([id]);
    let h1 = next.includes("i1"), h4 = next.includes("i4");
    let h2 = next.includes("i2"), h3 = next.includes("i3");
    if (h1 && h4 && (!h2 || !h3)) return;
    if (sel.length > 0 && getCapOf(sel) >= wSize) {
      let trimmed = sel.slice();
      while (trimmed.length > 0 && getCapOf(trimmed) >= wSize) {
        trimmed = trimmed.slice(1);
      }
      next = trimmed.concat([id]);
      h1 = next.includes("i1"); h4 = next.includes("i4");
      h2 = next.includes("i2"); h3 = next.includes("i3");
      if (h1 && h4 && (!h2 || !h3)) return;
    }
    setDraft({ ...wf, tables: next });
  }

  const wSel = wf.tables || [];
  const wCap = getCapOf(wSel);
  const wOk = wSel.length > 0 && wCap >= wSize;
  const wSummaryColor = wOk ? "#166534" : "#9a3412";
  const wSummaryText = wSel.length === 0
    ? "Select tables below."
    : "Capacity: " + wCap + (wCap >= wSize ? " (fits " + wSize + " pax)" : " — need " + wSize + " pax");
  const wClearBtn = wSel.length > 0 ? (
    <button
      key="clr"
      style={mkBtn({ fontSize: 12, padding: "6px 12px", background: BTN.clear })}
      onClick={() => setDraft({ ...wf, tables: [] })}
    >
      Clear
    </button>
  ) : null;

  // ── Kitchen load + alternative-time suggestions ──
  // Kitchen load is computed against the full bookings array (not
  // liveBookings) — kitchen pacing is about scheduled starts, not live
  // ones. wKitchenSugg is only computed when busy, otherwise we'd waste
  // a full search every render.
  const wKitchenLoad = getKitchenLoad(bookings, wDate, wTime, wDur, null);
  const wKitchenStarts = wKitchenLoad.starts + 1;
  const wKitchenGuests = wKitchenLoad.guests + wSize;
  const wKitchenBusy = wKitchenStarts >= KITCHEN_TABLE_LIMIT;
  const wKitchenSugg = wKitchenBusy
    ? findKitchenFriendlyTimes(bookings, wDate, wSize, "auto", wDur, wTime, null, tableBlocks)
    : null;

  // Renderer for the time-suggestion chips inside the kitchen section.
  // Tapping a chip jumps the form to that time (and clears the table
  // selection so the host re-picks for the new time).
  function wRenderKT(arr) {
    if (!arr || !arr.length) return null;
    return arr.map((r) => (
      <span
        key={r.timeStr}
        onClick={() => setDraft({ ...wf, tables: [], time: r.timeStr })}
        style={{
          cursor: "pointer", padding: "3px 8px", borderRadius: 6,
          fontWeight: 600, fontSize: 12,
          background: r.hasTables ? "rgba(220,252,231,0.8)" : "rgba(254,249,195,0.8)",
          color: r.hasTables ? "#166534" : "#854d0e",
          border: "1px solid " + (r.hasTables ? "rgba(134,239,172,0.5)" : "rgba(253,230,138,0.5)"),
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
        }}
      >
        {r.timeStr}
      </span>
    ));
  }

  const wKitchenSection = (
    <div style={{
      padding: "10px 14px",
      borderRadius: 14,
      border: "2px solid " + (wKitchenBusy ? "rgba(253,186,116,0.55)" : "rgba(255,255,255,0.45)"),
      background: wKitchenBusy ? "rgba(255,237,213,0.6)" : "rgba(255,255,255,0.35)",
      marginBottom: 14, fontSize: 13,
      color: wKitchenBusy ? "#9a3412" : S.muted
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <span style={{ fontWeight: 700 }}>Starting at this time: </span>
          {wKitchenStarts + " booking" + (wKitchenStarts !== 1 ? "s" : "")
            + " · " + wKitchenGuests + " guest" + (wKitchenGuests !== 1 ? "s" : "")}
        </span>
        {wKitchenBusy ? (
          <span style={{
            fontWeight: 700, color: "#dc2626", fontSize: 13,
            padding: "4px 12px", borderRadius: 8,
            border: "1.5px solid rgba(220,38,38,0.4)",
            flexShrink: 0
          }}>
            Kitchen busy
          </span>
        ) : null}
      </div>
      {wKitchenSugg && (wKitchenSugg.before.length || wKitchenSugg.after.length) ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: S.muted, marginBottom: 6 }}>
            <span style={{
              background: "rgba(220,252,231,0.8)", color: "#166534",
              padding: "2px 6px", borderRadius: 6, fontSize: 10, fontWeight: 600
            }}>
              green
            </span>
            {" = tables available  "}
            <span style={{
              background: "rgba(254,249,195,0.8)", color: "#854d0e",
              padding: "2px 6px", borderRadius: 6, fontSize: 10, fontWeight: 600
            }}>
              yellow
            </span>
            {" = kitchen ok, tables tight"}
          </div>
          {wKitchenSugg.before.length ? (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 12 }}>Before: </span>
              <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                {wRenderKT(wKitchenSugg.before)}
              </span>
            </div>
          ) : null}
          {wKitchenSugg.after.length ? (
            <div>
              <span style={{ fontWeight: 700, fontSize: 12 }}>After: </span>
              <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                {wRenderKT(wKitchenSugg.after)}
              </span>
            </div>
          ) : null}
        </div>
      ) : (wKitchenBusy ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "#991b1b" }}>
          No kitchen-friendly alternatives found nearby.
        </div>
      ) : null)}
    </div>
  );

  // ── Stepper button style (size + duration +/-) ──
  // Repeated ~6× across the form — extracted as a const to avoid duplication.
  const stepperBtnStyle = {
    background: "rgba(235,239,246,0.95)",
    border: "1px solid rgba(210,218,230,0.8)",
    borderRadius: 12, width: 42, height: 42, fontSize: 22,
    cursor: "pointer", color: S.text, fontWeight: 600,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    boxShadow: "inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.06)"
  };
  // Helper for the centered stepper value display.
  const stepperValueStyle = {
    minWidth: 56, textAlign: "center",
    fontSize: 15, fontWeight: 700, color: S.text
  };

  return (
    <Overlay onClose={onClose}>
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{
          fontSize: 16, fontWeight: 700, color: "#fff",
          display: "inline-block", padding: "8px 16px", borderRadius: 12,
          background: "rgba(22,101,52,0.75)",
          border: "1px solid rgba(255,255,255,0.2)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"
        }}>
          Walk-in
        </div>
      </div>
      <div style={{ fontSize: 13, color: S.text, marginBottom: 16, textAlign: "center" }}>
        {"Walk-in " + walkinNum + " · Seated"}
      </div>

      <Section>
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: 12
        }}>
          <Fld label="Time">
            <input
              type="time"
              value={wTime}
              onChange={(e) => setDraft({ ...wf, tables: [], time: e.target.value })}
              min="13:00"
              max="22:00"
              style={mkInp()}
            />
          </Fld>
          <Fld label="Number of guests">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                style={stepperBtnStyle}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDraft({
                    ...wf,
                    size: Math.max(1, (Number(wf.size) || 2) - 1),
                    tables: []
                  });
                }}
              >
                -
              </button>
              <span style={stepperValueStyle}>{String(wSize)}</span>
              <button
                style={stepperBtnStyle}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDraft({
                    ...wf,
                    size: Math.min(25, (Number(wf.size) || 2) + 1),
                    tables: []
                  });
                }}
              >
                +
              </button>
            </div>
          </Fld>
          <Fld label="Duration">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                style={stepperBtnStyle}
                onPointerDown={(e) => {
                  e.preventDefault();
                  const cd = wf.customDur || getDur(Number(wf.size) || 2);
                  setDraft({ ...wf, customDur: Math.max(15, cd - 15) });
                }}
              >
                -
              </button>
              <span style={stepperValueStyle}>{wDur + " min"}</span>
              <button
                style={stepperBtnStyle}
                onPointerDown={(e) => {
                  e.preventDefault();
                  const cd = wf.customDur || getDur(Number(wf.size) || 2);
                  setDraft({ ...wf, customDur: Math.min(480, cd + 15) });
                }}
              >
                +
              </button>
              <span style={{ fontSize: 13, color: S.muted, marginLeft: 4 }}>
                {"End: " + toTime(toMins(wTime) + wDur)}
              </span>
              {wf.customDur ? (
                <button
                  style={mkBtn({ fontSize: 12, background: BTN.reset })}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setDraft({ ...wf, customDur: null });
                  }}
                >
                  Reset
                </button>
              ) : null}
            </div>
          </Fld>
          <Fld label="Notes" style={{ marginTop: 12 }}>
            <textarea
              value={wf.notes}
              onChange={(e) => setDraft({ ...wf, notes: e.target.value })}
              rows={2}
              placeholder="Special requests..."
              style={{ ...mkInp(), resize: "vertical" }}
            />
          </Fld>
        </div>
      </Section>

      <div style={{ fontSize: 13, color: S.text, marginBottom: 14 }}>
        Tap tables to select / deselect.
      </div>

      <div style={{
        marginBottom: 14, padding: "12px 14px", borderRadius: 14,
        background: "rgba(255,255,255,0.35)",
        border: "2px solid " + (wOk ? "rgba(134,239,172,0.6)" : "rgba(255,255,255,0.5)"),
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 8, flexWrap: "wrap",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)"
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: S.text }}>
            {"Selected: " + (wSel.length ? wSel.join(" + ") : "none")}
          </div>
          <div style={{ fontSize: 13, color: wSummaryColor, fontWeight: 500, marginTop: 2 }}>
            {wSummaryText}
          </div>
        </div>
        {wClearBtn}
      </div>

      <TableGrid
        selected={wSel}
        toggle={wToggle}
        busy={wBusy}
        seatedBusy={new Set()}
        swapBusy={false}
      />

      {wAutoCheck && wSel.length === 0 ? (
        <AvailBanner
          msg={"No tables available at " + wTime + "."}
          sugg={wAutoCheck}
          warn
          onTapTime={(t) => setDraft({ ...wf, tables: [], time: t })}
        />
      ) : null}

      {error ? (
        <div style={{
          color: "#991b1b", fontSize: 13,
          padding: "10px 14px",
          background: "rgba(254,226,226,0.7)",
          borderRadius: 14,
          border: "2px solid rgba(252,165,165,0.55)",
          marginBottom: 14
        }}>
          {error}
        </div>
      ) : null}

      {wKitchenSection}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <button
          style={mkBtn({ minHeight: 44, padding: "10px 18px", background: BTN.cancel })}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!wOk}
          style={{
            background: wOk ? "rgba(22,101,52,0.8)" : "rgba(180,180,190,0.4)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 14, padding: "10px 22px",
            cursor: wOk ? "pointer" : "not-allowed",
            fontSize: 14, fontWeight: 600, color: "#fff", minHeight: 44,
            boxShadow: wOk
              ? "0 2px 8px rgba(22,101,52,0.2), inset 0 1px 1px rgba(255,255,255,0.15)"
              : "none"
          }}
        >
          Seat
        </button>
      </div>
    </Overlay>
  );
}
