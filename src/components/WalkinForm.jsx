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

import { S, BTN, KITCHEN_TABLE_LIMIT, hoursFor } from "../lib/constants";
import {
  toMins, toTime, getDur,
  getBlockSlots, getBusy, occupancyEnd,
  findBest, findBestAny,
  optimizerActiveFor, findTimes, formatSugg,
  getKitchenLoad, findKitchenFriendlyTimes,
  comboCapBest, nowTime
} from "../lib/booking-logic";
import { Overlay, Section, Fld, AvailBanner, mkInp, mkBtn, AutoHeight, Reveal } from "./atoms";
import { TableGrid } from "./TableGrid";
import { useDeferredCompute } from "../hooks/useDeferredCompute";

export function WalkinForm({
  draft, setDraft,
  error,
  liveBookings, bookings, tableBlocks, autoOptimizer,
  walkinNum, isMobile, nowMins = 0,
  onSave, onClose, onAddToWaitlist
}) {
  const wf = draft;
  const wSize = Number(wf.size) || 2;
  // Fallback if the draft has no time (initial state). Parent's openWalkin
  // already seeds `time` to nowTime(), so this branch is rarely taken — kept
  // for parity with the original.
  const wTime = wf.time || nowTime();
  const wDur = wf.customDur || getDur(wSize);
  const wDate = new Date().toISOString().slice(0, 10);
  // v15.0.0: walk-ins are always for TODAY, so the time bounds + closed notice
  // read today's per-weekday hours (not the viewed day's).
  const th = hoursFor(wDate);
  const wS = toMins(wTime);
  const wE = wS + wDur;

  // Build the "other slots" array for availability checks. Excludes
  // cancelled AND (v16.0.0 follow-up) completed bookings — a completed visit
  // is over, its table is free (mirrors ManualModal + the doSave guard; the
  // optimizer already ignores completed via isActive) — plus any bookings
  // without tables (those don't occupy anything). Then concat the
  // table-blocks for the same date.
  const wOther = liveBookings
    .filter((b) => b && b.date === wDate && b.status !== "cancelled" && b.status !== "completed" && (b.tables || []).length > 0)
    .map((b) => ({
      tables: b.tables || [],
      s: toMins(b.time),
      // v15.1.1: a still-seated guest holds the table NOW even when overstaying
      // (their live end == now); occupancyEnd extends it to nowMins+1 so getBusy/
      // findBest don't offer an occupied table to a walk-in starting now. Keyed on
      // nowMins (not wS) so a future-dated walk-in time stays free. See booking-logic.
      e: occupancyEnd(b, nowMins)
    }))
    .concat(getBlockSlots(tableBlocks, wDate));
  const wBusy = getBusy(wOther, wS, wE);

  // Auto-check: only relevant when the host hasn't picked any tables yet.
  // First tries an automatic best-fit; if nothing fits, suggestion chips
  // (alternative times before/after) for the AvailBanner to render.
  // v16.3.0 perf phase 2: the cheap best-fit probe stays synchronous (µs — it
  // reuses wOther), but the findTimes suggestion scan (the heavy part — full
  // trial optimisations on failing slots) is DEFERRED post-paint via
  // useDeferredCompute, so opening Walk-in is instantaneous even on a day
  // where the scan takes ~0.5s; the ⏳ cue shows past ~150ms.
  const wFitsNow = !!(findBest(wSize, "auto", wS, wE, wOther) || findBestAny(wSize, wS, wE, wOther));
  const wSuggScan = useDeferredCompute(function () {
    if (wFitsNow) return null;
    const noResh = !optimizerActiveFor(wDate, autoOptimizer);
    return formatSugg(findTimes(wDate, wSize, "auto", liveBookings, wDur, wS, tableBlocks, null, noResh), wS);
    // wOther is rebuilt per render (not dep-safe); its inputs are covered by
    // liveBookings/tableBlocks + the wFitsNow boolean itself. The th signature
    // (/code-review) re-scans when another device edits today's hours live.
  }, [wFitsNow, wSize, wDur, wS, liveBookings, tableBlocks, autoOptimizer, th.closed ? "closed" : th.open + "-" + th.close]);
  const wAutoCheck = wFitsNow ? null : wSuggScan.value;
  const wChecking = !wFitsNow && wSuggScan.pending;

  // Capacity computation — see booking-logic.js#comboCapBest. Local alias
  // keeps existing call sites readable.
  const getCapOf = comboCapBest;

  // Toggle a table on/off. Auto-prunes the selection so the host doesn't
  // accumulate redundant tables once `wSize` is met. Refuses i1+i4 without
  // i2 AND i3 (the indoor cluster must be physically contiguous).
  function wToggle(id) {
    const sel = wf.tables || [];
    // v17.1.1: DESELECT before the busy check — the Plan-view seated-takeover
    // pre-select can put a currently-busy table in the selection, and the host
    // must still be able to remove it.
    if (sel.includes(id)) {
      setDraft({ ...wf, tables: sel.filter((x) => x !== id) });
      return;
    }
    if (wBusy.has(id)) return;
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
  const wSummaryColor = wOk ? "var(--success-text)" : "var(--warn-text)";
  const wSummaryText = wSel.length === 0
    ? "Select tables below."
    : "Capacity: " + wCap + (wCap >= wSize ? " (fits " + wSize + " pax)" : " — need " + wSize + " pax");
  const wClearBtn = wSel.length > 0 ? (
    <button
      key="clr"
      className="mgt-hover-scale mgt-press"
      style={mkBtn({ fontSize: 12, padding: "6px 12px", background: BTN.clear })}
      onClick={() => setDraft({ ...wf, tables: [], _pre: false })}
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
        className="mgt-hover-scale"
        onClick={() => setDraft({ ...wf, tables: [], time: r.timeStr, _pre: false })}
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

  const wKitchenSugBlock = (wKitchenSugg && (wKitchenSugg.before.length || wKitchenSugg.after.length)) ? (
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
    <div style={{ marginTop: 6, fontSize: 12, color: "var(--danger-text)" }}>
      No kitchen-friendly alternatives found nearby.
    </div>
  ) : null);

  const wKitchenSection = (
    <div style={{
      padding: "10px 14px",
      borderRadius: 14,
      border: "2px solid " + (wKitchenBusy ? "var(--warn-border)" : "var(--border-soft)"),
      background: wKitchenBusy ? "var(--warn-bg)" : "var(--bg-soft)",
      marginBottom: 14, fontSize: 13,
      color: wKitchenBusy ? "var(--warn-text)" : S.muted
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <span style={{ fontWeight: 700 }}>Starting at this time: </span>
          {wKitchenStarts + " booking" + (wKitchenStarts !== 1 ? "s" : "")
            + " · " + wKitchenGuests + " guest" + (wKitchenGuests !== 1 ? "s" : "")}
        </span>
        {wKitchenBusy ? (
          <span style={{
            fontWeight: 700, color: "var(--text-required)", fontSize: 13,
            padding: "4px 12px", borderRadius: 8,
            border: "1.5px solid rgba(220,38,38,0.4)",
            flexShrink: 0
          }}>
            Kitchen busy
          </span>
        ) : null}
      </div>
      {/* v15.8.0 cont.4: the suggestion sub-panel eases in/out via Reveal — the same
          effect as the Summary panel. */}
      <Reveal show={!!wKitchenSugBlock}>{wKitchenSugBlock}</Reveal>
    </div>
  );

  // ── Stepper button style (size + duration +/-) ──
  // Repeated ~6× across the form — extracted as a const to avoid duplication.
  const stepperBtnStyle = {
    background: "var(--bg-stepper)",
    border: "1px solid var(--border-soft)",
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

  // v14.4.1: action row + error pinned via Overlay's `footer` slot (marginTop
  // dropped — the footer region's borderTop+padding separates it now). The
  // kitchen-busy suggestion panel (wKitchenSection) stays in the scrolling body.
  const footerEl=(
    <>
      {error ? (
        <div style={{
          color: "var(--danger-text)", fontSize: 13,
          padding: "10px 14px",
          background: "var(--danger-bg)",
          borderRadius: 14,
          border: "2px solid var(--danger-border)",
          marginBottom: 14
        }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          className="mgt-hover-scale"
          style={mkBtn({ minHeight: 44, padding: "10px 18px", background: BTN.cancel })}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!wOk}
          className="mgt-hover-scale"
          style={{
            background: wOk ? "rgba(22,101,52,0.8)" : "rgba(180,180,190,0.4)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 14, padding: "10px 22px",
            cursor: wOk ? "pointer" : "not-allowed",
            fontSize: 14, fontWeight: 600, color: "var(--text-on-accent)", minHeight: 44,
            boxShadow: wOk
              ? "0 2px 8px rgba(22,101,52,0.2), inset 0 1px 1px rgba(255,255,255,0.15)"
              : "none"
          }}
        >
          Seat
        </button>
      </div>
    </>
  );

  return (
    <Overlay onClose={onClose} footer={footerEl}>
      <AutoHeight>
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{
          fontSize: 16, fontWeight: 700, color: "var(--text-on-accent)",
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
              // v17.1.1 review #3: a time edit discards the Plan pre-selection
              // (tables reset), so `_pre` is cleared too — from here on the
              // form behaves exactly like the plain Walk-in-button path.
              onChange={(e) => setDraft({ ...wf, tables: [], time: e.target.value, _pre: false })}
              min={String(th.open).padStart(2, "0") + ":00"}
              max={th.close >= 24 ? "23:59" : String(th.close).padStart(2, "0") + ":00"}
              className="mgt-hover-scale"
              style={mkInp()}
            />
          </Fld>
          <Fld label="Number of guests">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                className="mgt-hover-scale"
                style={stepperBtnStyle}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDraft({
                    ...wf,
                    size: Math.max(1, (Number(wf.size) || 2) - 1),
                    // v17.1.1: the Plan-view "Walk-in here" path (`_pre`) keeps
                    // the host-chosen table across guest-count edits; the plain
                    // Walk-in-button path still resets so auto-fit re-runs.
                    tables: wf._pre ? (wf.tables || []) : []
                  });
                }}
              >
                -
              </button>
              <span style={stepperValueStyle}>{String(wSize)}</span>
              <button
                className="mgt-hover-scale"
                style={stepperBtnStyle}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDraft({
                    ...wf,
                    size: Math.min(25, (Number(wf.size) || 2) + 1),
                    tables: wf._pre ? (wf.tables || []) : [] // v17.1.1: see the − stepper
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
                className="mgt-hover-scale"
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
                className="mgt-hover-scale"
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
                  className="mgt-hover-scale mgt-press"
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
              className="mgt-hover-scale"
              style={{ ...mkInp(), resize: "vertical" }}
            />
          </Fld>
        </div>
      </Section>

      {wKitchenSection}

      <div style={{ fontSize: 13, color: S.text, marginBottom: 14, textAlign: "center" }}>
        Tap tables to select / deselect.
      </div>

      <div style={{
        marginBottom: 14, padding: "12px 14px", borderRadius: 14,
        background: "var(--bg-card)",
        border: "2px solid " + (wOk ? "var(--suggest-border)" : "var(--border-sheet)"),
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

      {/* v16.3.0 perf phase 2: ⏳ cue while the deferred suggestion scan runs.
          Reveal-wrapped — its ~300ms ease is the grace, so a fast scan shows
          only an imperceptible sliver instead of a flash. */}
      <Reveal show={wChecking && wSel.length === 0}>
        <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border-soft)", borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textAlign: "center" }}>⏳ Checking table availability…</div>
      </Reveal>
      {wAutoCheck && wSel.length === 0 ? (
        <>
          <AvailBanner
            msg={"No tables available at " + wTime + "."}
            sugg={wAutoCheck}
            warn
            onTapTime={(t) => setDraft({ ...wf, tables: [], time: t, _pre: false })}
          />
          {/* v16.0.0: nothing fits right now → offer the waitlist (today's date,
              current draft time as the wanted time). */}
          {onAddToWaitlist ? (
            <div style={{ display: "flex", justifyContent: "center", marginTop: -4, marginBottom: 12 }}>
              <button
                className="mgt-hover-scale"
                style={mkBtn({ fontSize: 13, background: BTN.orange, minHeight: 40, padding: "8px 16px" })}
                onClick={() => onAddToWaitlist()}
              >
                ⏳ Add to waitlist
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      </AutoHeight>
    </Overlay>
  );
}
