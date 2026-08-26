// src/components/BlockModal.jsx
// Modal for blocking off a single table on a single date for a specific
// time range. Two view states:
//
//   • view  — list any existing blocks for this table+date with an
//             "Unblock" button per row, plus "+ Add block" to enter add mode.
//   • add   — From / To time inputs and a "Block" button to create a new
//             block.
//
// The component holds only its own UI state. Persistence is delegated to
// the parent via `onSave` / `onRemove`. Default time range is the full
// service window (OPEN to GRID_CLOSE).
//
// Phase B2 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Behaviour, output markup, and all inline styles are byte-identical to the
// original.

import { useState, useEffect } from "react";
import { S, BTN, TBL, OPEN, GRID_CLOSE, R, T, FW } from "../lib/constants";
import { toMins, isIn } from "../lib/booking-logic";
import { hourLabel } from "../lib/time-grid";
import { Overlay, Section, Fld, mkBtn, mkSolidBtn, mkInp, Reveal, AutoHeight } from "./atoms";
import { AlertPanel, AlertRow } from "./AlertPanel";
import { ClosedIcon } from "./Icons";
import { useRevealRows } from "../hooks/useRevealRows";

export function BlockModal({ tableId, date, blocks = [], onSave, onRemove, onClose, onDirty }) {
  const existing = blocks.filter((bl) => bl.tableId === tableId && bl.date === date);
  const indoor = isIn(tableId);
  const tc = indoor ? TBL.ind : TBL.out;
  const [mode, setMode] = useState(existing.length > 0 ? "view" : "add");
  const [from, setFrom] = useState(OPEN + ":00");
  const [to, setTo] = useState(GRID_CLOSE + ":00");

  // v17.15.2: per-row ease-in/out for the blocked list, keyed on the block's own
  // id since v17.15.3 — before that a block had none, and this list identified a
  // row by its field set plus a duplicate-occurrence ordinal, which meant
  // unblocking one of two identical rows renumbered the survivor and collapsed a
  // row nobody touched. See sanitizeBlock in booking-logic.
  //
  // This version's first commit argued the pane sweep's lists are static and so
  // do NOT want `useRevealRows` — true of the two history panels, and **wrong
  // here**: Unblock removes a row IN PLACE, with the modal still open, whenever
  // the table has more than one block. That is exactly the arrival/departure
  // case this hook exists for, and it is the one list of the eight where the
  // distinction goes the other way.
  //
  // Called at the TOP, never inside the `mode === "view"` branch — that branch
  // returns early, so a hook there would change the hook count between renders.
  const ids = existing.map((bl) => bl.id);
  const { renderIds, openIds } = useRevealRows(ids);
  const byId = new Map(existing.map((bl) => [bl.id, bl]));

  // v17.8.0 unsaved-changes guard. The From/To times are component-local, so
  // this modal REPORTS its dirtiness up rather than App reaching in — the same
  // contract ManualModal uses. Dirty only in "add" mode with a time actually
  // changed from the default full-service window: merely opening the add form,
  // or browsing the existing-blocks list, must close silently.
  const dirty = mode === "add" && (from !== OPEN + ":00" || to !== GRID_CLOSE + ":00");
  useEffect(() => { if (onDirty) onDirty(dirty); }, [dirty, onDirty]);
  // Unmount-only reset. Without it a closed modal leaves the flag — and so
  // `beforeunload` — armed for the rest of the session (the ManualModal trap).
  useEffect(() => () => { if (onDirty) onDirty(false); }, [onDirty]);
  // Lint cleanup (2026-07-24): the null guard moved BELOW the hooks — an early
  // return above useState changes the hook count if tableId ever turns null on
  // a mounted instance (the v16.4.0 ListView crash class). All derivations
  // above are null-safe.
  if (!tableId) return null;

  function handleSave() {
    if (!from || !to || toMins(to) <= toMins(from)) return;
    onSave({ tableId, date, allDay: false, from, to });
  }

  // ── View mode: existing blocks listed with Unblock buttons ───────────────
  if (mode === "view" && existing.length > 0) {
    // v14.4.1: pinned footer via Overlay's `footer` slot.
    const footerViewEl=(
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          className="mgt-hover-scale"
          style={mkBtn({ minHeight: 40, padding: "8px 16px", background: "var(--app-btn-slate)" })}
          onClick={() => setMode("add")}
        >
          + Add block
        </button>
        <button
          className="mgt-hover-scale"
          style={mkBtn({ minHeight: 40, padding: "8px 16px", background: "var(--app-btn-slate)" })}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    );
    // v17.15.2: AutoHeight, so the card EASES instead of jumping. Two changes
    // need it — "+ Add block" swapping the list of blocks for a pair of time
    // inputs (measured 249 → 279px), and a row collapsing on Unblock.
    //
    // It is in BOTH branches at the same position on purpose: React reconciles
    // the two `return`s by type, so ONE AutoHeight instance survives the mode
    // flip and can measure across it. In one branch only it would unmount and
    // the swap would still jump.
    //
    // ("Back" is not the reverse of "+ Add block" — it calls `onClose`, so the
    // add form's exit belongs to ModalPresence, not here.)
    return (
      <Overlay onClose={onClose} footer={footerViewEl}><AutoHeight>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{
            fontSize: T.body, fontWeight: FW.bold, padding: "4px 10px", borderRadius: R.pill,
            background: tc.bg, color: tc.text, border: "1px solid " + tc.border
          }}>
            {tableId}
          </span>
          <span style={{ fontSize: T.title, fontWeight: FW.bold, color: S.text }}>
            {"Table " + tableId + " — " + date}
          </span>
        </div>
        {/* v17.15.2: ONE pane with N rows, where this drew N CARDS — each with
            its own danger fill, its own border in the matching hue, its own
            bold text in a third shade of it, and its own 8px margin. That is
            both DESIGN.md's banned label shape and, at the same time, the
            "N panes with N margins" that NotificationStrip exists to collapse
            — reproduced inside a modal, where the strip could not see it. Two
            blocks on one table took two cards and read as two unrelated
            alarms; they are one fact about one table.

            ClosedIcon is the strip's own "Closed this day" mark. A blocked
            table and a closed day are the same statement at two scales, so
            they take the same mark rather than inventing a second one. */}
        <AlertPanel role="danger" icon={ClosedIcon} title="Blocked" count={existing.length}>
          {renderIds.map((id) => {
            // `byId` no longer holds a row that has just been unblocked, but
            // `renderIds` keeps it mounted so its Reveal can collapse — so the
            // label comes from a snapshot the Reveal itself caches, and a
            // missing entry renders nothing rather than throwing.
            const bl = byId.get(id);
            // BannerRows' lesson: the hairline keys on this row's position
            // among the rows actually OPEN, not its index in renderIds — which
            // retains a departing row while it collapses. With the raw index,
            // unblocking the first of two leaves the survivor wearing a
            // borderTop flush under the section header: a line appearing
            // exactly where the design says none.
            const visible = renderIds.filter((x) => openIds.has(x));
            // `i < 1`, not `i === 0`: a DEPARTING row is not in `visible`, so
            // indexOf gives -1, and `-1 === 0` is false — which would hand it
            // the very borderTop this block exists to withhold. BannerRows
            // spells the same rule as `i > 0 ? border : none`, where -1 falls
            // on the no-border side for free; writing it as a `first` flag
            // inverts that, so the -1 case has to be named.
            const i = visible.indexOf(id);
            return (
              <Reveal key={id} show={openIds.has(id)}>
                {bl ? (
                  <AlertRow first={i < 1} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ color: "var(--danger-text)", fontWeight: FW.semi }}>
                      {bl.allDay ? hourLabel(OPEN) + " – " + hourLabel(GRID_CLOSE) : bl.from + " – " + bl.to}
                    </span>
                    <button
                      onClick={() => onRemove(bl)}
                      className="mgt-hover-scale"
                      style={mkBtn({ background: BTN.del, fontSize: T.body, flexShrink: 0 })}
                    >
                      Unblock
                    </button>
                  </AlertRow>
                ) : null}
              </Reveal>
            );
          })}
        </AlertPanel>
      </AutoHeight></Overlay>
    );
  }

  // ── Add mode: From / To inputs ───────────────────────────────────────────
  // v14.4.1: pinned footer via Overlay's `footer` slot.
  const footerAddEl=(
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button
        className="mgt-hover-scale"
        style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--app-btn-slate)" })}
        onClick={onClose}
      >
        Back
      </button>
      <button
        onClick={handleSave}
        className="mgt-hover-scale"
        // v17.8.0: deep red, deliberately — this Save BLOCKS a table out of
        // service rather than saving a booking. Tokenized onto the app's solid
        // danger fill instead of a one-off literal.
        style={mkSolidBtn("var(--app-danger-solid)")}
      >
        Block
      </button>
    </div>
  );
  return (
    <Overlay onClose={onClose} footer={footerAddEl}><AutoHeight>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: T.body, fontWeight: FW.bold, padding: "4px 10px", borderRadius: R.pill,
          background: tc.bg, color: tc.text, border: "1px solid " + tc.border
        }}>
          {tableId}
        </span>
        <span style={{ fontSize: T.title, fontWeight: FW.bold, color: S.text }}>
          {"Block table " + tableId}
        </span>
      </div>
      <div style={{ fontSize: T.body, color: S.muted, marginBottom: 16 }}>{date}</div>
      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Fld label="From">{(fid) => (
            <input
              id={fid}
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              min={String(OPEN).padStart(2, "0") + ":00"}
              max={GRID_CLOSE >= 24 ? "23:59" : String(GRID_CLOSE).padStart(2, "0") + ":00"}
              className="mgt-hover-scale"
              style={mkInp()}
            />
          )}</Fld>
          <Fld label="To">{(fid) => (
            <input
              id={fid}
              type="time"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              min={String(OPEN).padStart(2, "0") + ":00"}
              max={GRID_CLOSE >= 24 ? "23:59" : String(GRID_CLOSE).padStart(2, "0") + ":00"}
              className="mgt-hover-scale"
              style={mkInp()}
            />
          )}</Fld>
        </div>
      </Section>
    </AutoHeight></Overlay>
  );
}
