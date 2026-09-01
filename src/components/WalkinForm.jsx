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

import { S, BTN, BLOCK_BG, KITCHEN_TABLE_LIMIT, hoursFor, R, M, T, FW, H, IC } from "../lib/constants";
import {
  toMins, toTime, getDur,
  getBlockSlots, getBusy, occupancyEnd, padEnd,
  findBest, findBestAny,
  optimizerActiveFor, findTimes, formatSugg,
  getKitchenLoad, findKitchenFriendlyTimes,
  comboCapBest, nowTime
} from "../lib/booking-logic";
import { Overlay, ModalTitle, Section, Fld, InlineAlert, mkInp, mkArea, mkBtn, mkSolidBtn, AutoHeight, Reveal, Presence, OutlineChip } from "./atoms";
import { AvailBanner } from "./AvailBanner";
import { AlertPanel } from "./AlertPanel";
import { NOTIF_GUTTER, NOTIF_PAD_X } from "./NotificationStrip";
import { WaitIcon, AlertIcon } from "./Icons";
import { TableGrid } from "./TableGrid";
import { useDeferredCompute } from "../hooks/useDeferredCompute";
import { todayStr } from "../lib/day";

// v17.8.0 review fix: hex literals ON PURPOSE — see the identical pair in
// BookingFormModal. The kitchen-suggestion chip FILLS are hard-coded pale green
// / pale yellow and deliberately theme-invariant, so their text has to be too.
// The token sweep briefly used --success-text / --status-pending-text here,
// which invert between themes and left light-green text on a pale-green chip in
// dark mode. A token may only be used where the surface under it flips as well.
const KTXT_OK = "#166534", KTXT_TIGHT = "#854d0e";   /* @fixed-fill */

export function WalkinForm({
  draft, setDraft,
  error,
  liveBookings, bookings, tableBlocks, autoOptimizer,
  walkinNum, isMobile, nowMins = 0, today = "",
  onSave, onClose, onAddToWaitlist
}) {
  const wf = draft;
  const wSize = Number(wf.size) || 2;
  // Fallback if the draft has no time (initial state). Parent's openWalkin
  // already seeds `time` to nowTime(), so this branch is rarely taken — kept
  // for parity with the original.
  const wTime = wf.time || nowTime();
  const wDur = wf.customDur || getDur(wSize);
  const wDate = todayStr();
  // v15.0.0: walk-ins are always for TODAY, so the time bounds + closed notice
  // read today's per-weekday hours (not the viewed day's).
  const th = hoursFor(wDate);
  const wS = toMins(wTime);
  // v17.6.0: the query window's end carries the turnaround buffer, so a walk-in
  // is not offered a table whose next party starts within the separation time.
  // The slot ends opposite already carry it via occupancyEnd. Buffer off ⇒ 0.
  const wE = padEnd(wS + wDur);

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
      e: occupancyEnd(b, nowMins, today)
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
  // v17.15.2: slides in and out. It appears the moment you tap a table and
  // vanishes the moment you clear — always under the eye of the person who
  // caused it — and it was doing both by hard cut. `Presence` with the
  // slide pair is the app's idiom for a button arriving in a row: App's
  // "Today", the timeline's optimiser pill, LateBanner's "No show".
  const wClearBtn = (
    <Presence show={wSel.length > 0} inClass="mgt-slide-in" outClass="mgt-slide-out" tag="span">
      <button
        key="clr"
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ fontSize: T.body, padding: "6px 12px", background: BTN.clear })}
        onClick={() => setDraft({ ...wf, tables: [], _pre: false })}
      >
        Clear
      </button>
    </Presence>
  );

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
          cursor: "pointer", padding: "2px 8px", borderRadius: R.pill,
          fontWeight: FW.semi, fontSize: T.body,
          background: r.hasTables ? "rgba(220,252,231,0.8)" : "rgba(254,249,195,0.8)",  /* @fixed-fill */
          color: r.hasTables ? KTXT_OK : KTXT_TIGHT,
          border: "1px solid " + (r.hasTables ? "rgba(134,239,172,0.5)" : "rgba(253,230,138,0.5)"),  /* @fixed-fill */
          boxShadow: "var(--shadow-flat)"
        }}
      >
        {r.timeStr}
      </span>
    ));
  }

  const wKitchenSugBlock = (wKitchenSugg && (wKitchenSugg.before.length || wKitchenSugg.after.length)) ? (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: T.small, color: S.muted, marginBottom: 6 }}>
        <span style={{
          background: "rgba(220,252,231,0.8)", /* @fixed-fill */ color: KTXT_OK,
          padding: "2px 6px", borderRadius: R.pill, fontSize: T.micro, fontWeight: FW.semi
        }}>
          green
        </span>
        {" = tables available  "}
        <span style={{
          background: "rgba(254,249,195,0.8)", /* @fixed-fill */ color: KTXT_TIGHT,
          padding: "2px 6px", borderRadius: R.pill, fontSize: T.micro, fontWeight: FW.semi
        }}>
          yellow
        </span>
        {" = kitchen ok, tables tight"}
      </div>
      {wKitchenSugg.before.length ? (
        <div style={{ marginBottom: 4 }}>
          <span style={{ fontWeight: FW.bold, fontSize: T.body }}>Before: </span>
          <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
            {wRenderKT(wKitchenSugg.before)}
          </span>
        </div>
      ) : null}
      {wKitchenSugg.after.length ? (
        <div>
          <span style={{ fontWeight: FW.bold, fontSize: T.body }}>After: </span>
          <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
            {wRenderKT(wKitchenSugg.after)}
          </span>
        </div>
      ) : null}
    </div>
  ) : (wKitchenBusy ? (
    <div style={{ marginTop: 6, fontSize: T.body, color: "var(--danger-text)" }}>
      No kitchen-friendly alternatives found nearby.
    </div>
  ) : null);

  // v17.15.2 (follow-up): this is the SECOND copy of the kitchen panel, and the
  // pane sweep earlier in this version converted only the booking form's. The
  // grep that found the eight matched `--warn-bg` and `--warn-border` on ONE
  // line; here they are on two, so a byte-equivalent copy of both faults sat
  // three files away and passed every check. Searching for a SHAPE by its
  // literal formatting is the same mistake as searching for a component by its
  // import — the lesson this version already recorded about `OutlineChip`,
  // walked into again in the commit that recorded it.
  //
  // Both faults, identical to the ones fixed there: the BUSY state was the
  // banned semantic triple (the CALM state is an information panel and stays
  // exactly as it was), and the "Kitchen busy" chip was an `OutlineChip` typed
  // out by hand, with theme-INVARIANT `--text-required` on a fill that inverts
  // — 4.11:1 in light, 2.86:1 in dark.
  //
  // /code-review: ONE element type across both states, never a ternary between
  // an AlertPanel and a div. React reconciles by type, so the ternary discarded
  // the whole subtree on every busy<->calm flip and took the suggestions
  // `Reveal` with it — the chips vanished in a frame instead of collapsing,
  // a REGRESSION on the single div this used to be. `AlertPanel` takes
  // tone/tint overrides for exactly this, and the shared element also lets the
  // tint cross-fade. Mirrors BookingFormModal's copy line for line.
  const wKitchenSection = (
    <AlertPanel
      role="warn"
      icon={wKitchenBusy ? AlertIcon : null}
      title={wKitchenBusy ? "Kitchen may be busy" : null}
      tint={wKitchenBusy ? undefined : "var(--bg-soft)"}
      style={{ marginBottom: 14, transition: "background-color " + M.move,
        ...(wKitchenBusy ? null : { border: "1px solid var(--border-soft)", paddingTop: 10 }) }}>
      {/* Indented under the title only when there IS one; the calm state has no
          mark to line up under, so it takes the pane's own padding. */}
      <div style={{
        padding: wKitchenBusy ? "4px " + NOTIF_PAD_X + "px 4px " + NOTIF_GUTTER + "px" : "0 " + NOTIF_PAD_X + "px",
        fontSize: T.body, color: wKitchenBusy ? "var(--text-primary)" : S.muted
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span>
            <span style={{ fontWeight: FW.bold }}>Starting at this time: </span>
            {wKitchenStarts + " booking" + (wKitchenStarts !== 1 ? "s" : "")
              + " · " + wKitchenGuests + " guest" + (wKitchenGuests !== 1 ? "s" : "")}
          </span>
          {wKitchenBusy ? <OutlineChip tone="danger" size="small">Kitchen busy</OutlineChip> : null}
        </div>
        {/* v15.8.0 cont.4: the suggestion sub-panel eases in/out via Reveal — the same
            effect as the Summary panel. */}
        <Reveal show={!!wKitchenSugBlock}>{wKitchenSugBlock}</Reveal>
      </div>
    </AlertPanel>
  );

  // ── Stepper button style (size + duration +/-) ──
  // Repeated ~6× across the form — extracted as a const to avoid duplication.
  const stepperBtnStyle = {
    background: "var(--bg-stepper)",
    border: "1px solid var(--border-soft)",
    borderRadius: R.pill, width: H.control, height: H.control, fontSize: T.display,
    cursor: "pointer", color: S.text, fontWeight: FW.semi,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    boxShadow: "var(--shadow-input)"
  };
  // Helper for the centered stepper value display.
  const stepperValueStyle = {
    minWidth: 56, textAlign: "center",
    fontSize: T.lead, fontWeight: FW.bold, color: S.text
  };

  // v14.4.1: action row + error pinned via Overlay's `footer` slot (marginTop
  // dropped — the footer region's borderTop+padding separates it now). The
  // kitchen-busy suggestion panel (wKitchenSection) stays in the scrolling body.
  const footerEl=(
    <>
      {/* v17.12.0: always-mounted alert region — an alert announces a change to
          its CONTENT, so a region that arrives already holding its message is
          the live-region pitfall (see notifAnnounce in App). The walk-in form's
          errors are all form-level (capacity, no table), so there is no field
          to mark invalid here, unlike the booking form. */}
      <div role="alert">
        {/* v17.15.0: the shared InlineAlert — see atoms.jsx — eased in AND out,
            for the reason given at the booking form's copy of this. */}
        <Reveal show={!!error}>
          {error ? <InlineAlert style={{ marginBottom: 14 }}>{error}</InlineAlert> : null}
        </Reveal>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          className="mgt-hover-scale"
          style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--app-btn-slate)" })}
          onClick={onClose}
        >
          Back
        </button>
        <button
          onClick={onSave}
          disabled={!wOk}
          className="mgt-hover-scale"
          style={mkSolidBtn(wOk ? "var(--app-success-solid)" : "var(--btn-disabled)", {
            cursor: wOk ? "pointer" : "not-allowed",
            // v17.14.0: muted ink while disabled — see index.html.
            color: wOk ? "var(--text-on-accent)" : "var(--btn-disabled-ink)",
            boxShadow: wOk ? "var(--shadow-btn-success)" : "none"
          })}
        >
          Seat
        </button>
      </div>
    </>
  );

  return (
    <Overlay onClose={onClose} footer={footerEl}>
      <AutoHeight>
      <ModalTitle marginBottom={4} background="var(--app-walkin)">Walk-in</ModalTitle>
      <div style={{ fontSize: T.body, color: S.text, marginBottom: 16, textAlign: "center" }}>
        {"Walk-in " + walkinNum + " · Seated"}
      </div>

      <Section>
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: 12
        }}>
          <Fld label="Time">{(fid) => (
            <input
              id={fid}
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
          )}</Fld>
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
              <span style={{ fontSize: T.body, color: S.muted, marginLeft: 4 }}>
                {"End: " + toTime(toMins(wTime) + wDur)}
              </span>
              {wf.customDur ? (
                <button
                  className="mgt-hover-scale mgt-press"
                  style={mkBtn({ fontSize: T.body, background: BTN.reset })}
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
          <Fld label="Notes" style={{ marginTop: 12 }}>{(fid) => (
            <textarea
              id={fid}
              value={wf.notes}
              onChange={(e) => setDraft({ ...wf, notes: e.target.value })}
              rows={2}
              placeholder="Special requests..."
              className="mgt-hover-scale"
              style={mkArea()}
            />
          )}</Fld>
        </div>
      </Section>

      {wKitchenSection}

      <div style={{ fontSize: T.body, color: S.text, marginBottom: 14, textAlign: "center" }}>
        Tap tables to select / deselect.
      </div>

      <div style={{
        marginBottom: 14, padding: "12px 14px", borderRadius: R.card,
        background: "var(--bg-card)",
        border: "1px solid " + (wOk ? "var(--suggest-border)" : "var(--border-sheet)"),
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 8, flexWrap: "wrap",
        boxShadow: "var(--shadow-card)"
      }}>
        <div>
          <div style={{ fontSize: T.lead, fontWeight: FW.bold, color: S.text }}>
            {"Selected: " + (wSel.length ? wSel.join(" + ") : "none")}
          </div>
          <div style={{ fontSize: T.body, color: wSummaryColor, fontWeight: FW.medium, marginTop: 2 }}>
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
        <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border-soft)", borderRadius: R.card, padding: "10px 14px", marginBottom: 12, fontSize: T.body, fontWeight: FW.medium, color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><span aria-hidden="true" className="mgt-dot-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--text-muted)", flexShrink: 0 }} />Checking table availability…</div>
      </Reveal>
      {/* v17.15.2: Reveal-wrapped. This arrives when the deferred scan lands and
          leaves the instant you tap a table — both while you are looking at it,
          and both were hard cuts. It sits directly under the ⏳ row, which has
          eased since v16.3.0, so the cue faded and its own ANSWER snapped in. */}
      <Reveal show={!!(wAutoCheck && wSel.length === 0)}>
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
                /* v17.10.0: pending amber — the waitlist's colour, see App's badge. */
                style={mkBtn({ fontSize: T.body, background: BLOCK_BG.pending, minHeight: 40, padding: "8px 16px", display: "inline-flex", alignItems: "center", gap: 6 })}
                onClick={() => onAddToWaitlist()}
              >
                <WaitIcon size={IC.control} />Add to waitlist
              </button>
            </div>
          ) : null}
        </>
        ) : null}
      </Reveal>
      </AutoHeight>
    </Overlay>
  );
}
