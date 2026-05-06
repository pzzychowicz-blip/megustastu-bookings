// src/components/TimelineView.jsx
// Timeline (Gantt-style) view of the day's bookings — horizontal scrollable
// grid with one row per table, blocks rendered as positioned divs along a
// time axis (OPEN – GRID_CLOSE, i.e. 13:00 – 23:00). Tap a block to edit,
// tap the "=" handle on a block to manually assign tables, long-press to
// change status, tap a table label on the left to block / unblock.
//
// Sub-components defined inline (close over parent state, must stay inside):
//   • GridLines — vertical hour / quarter-hour lines, drawn into each row.
//   • Block     — one booking, with touch handlers for long-press status
//                 popup (400ms hold) and short-tap edit. Holds its own
//                 timer / drag-detection refs (per-instance).
//   • BlockBar  — one table-block (date+from+to range) drawn as a striped
//                 red bar with a "blocked" caption.
//
// Follow-now mode (today only) auto-scrolls the grid so the current minute
// sits ~30 min from the left edge, and bumps zoom to 4× if it's below that.
// `scrollPosRef` (a ref owned by BookingApp) persists scroll position across
// renders without triggering re-renders on scroll — this is why the scroll
// handler writes directly to the ref rather than calling setState.
//
// Long-press status popup (`quickStatus`) is a fixed-position overlay at
// z-index 300 — sits above the timeline content but below all modals
// (Settings = 200 base, ReminderEditor = 250, popups = 300; modals win
// because they paint on top of the page after this in the React tree).
//
// Phase B4 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Behaviour, output markup, and all inline styles are byte-identical to the
// original. Notes:
//   • The `pct` and `liveDur` helpers are kept inline; `pct` could be
//     promoted to booking-logic.js in Phase C alongside `getCapOf` from B2.
//   • The `Block` sub-component declares an unused `useRef(null)` named
//     `blockEl` — preserved verbatim from the original to keep this a pure
//     structural extraction. Flagged for Phase C cleanup.
//   • The Follow-now button label is `followNow ? "Follow" : "Follow"` (yes,
//     both branches the same — also preserved verbatim; the visual state is
//     conveyed by the background colour, not the label).

import { useState, useRef, useEffect } from "react";
import {
  OPEN, GRID_CLOSE, QUARTER_HOURS,
  ROW_H, LABEL_W, STATUS_COLORS, BLOCK_BG,
  S, TBL, BTN, TIMELINE_TABLES
} from "../lib/constants";
import { toMins, toTime, isLocked, isIn } from "../lib/booking-logic";
import { mkBtn } from "./atoms";
import { CogIcon } from "./Settings";

export function TimelineView({
  bookings, date, onEdit, onManual, onStatus,
  blocks = [], onBlock, nowMins = 0, warnings = {},
  zoom = 1, setZoom,
  followNow, setFollowNow,
  scrollPosRef,
  autoOptimizer = true,
  setAutoOptimizer = () => {},
  onReshuffle = () => {},
  onOpenSettings = () => {}
}) {
  const scrollRef = useRef(null);
  const [quickStatus, setQuickStatus] = useState(null);
  const isToday = date === new Date().toISOString().slice(0, 10);
  const totalMins = (GRID_CLOSE - OPEN) * 60;
  const gridW = Math.max(320, totalMins * zoom * 1.2);

  // ── Follow-now scroll synchronisation ────────────────────────────────────
  // When followNow is on (today only), keep the current minute ~30 min from
  // the left edge. Otherwise restore the last known scroll position from the
  // ref — this lets the user navigate away and back without losing context.
  useEffect(() => {
    if (!scrollRef.current) return;
    if (followNow && isToday && nowMins >= OPEN * 60 && nowMins <= GRID_CLOSE * 60) {
      const targetMins = Math.max(OPEN * 60, nowMins - 30);
      const scrollPos = ((targetMins - OPEN * 60) / totalMins) * gridW;
      scrollRef.current.scrollLeft = scrollPos;
      if (scrollPosRef) scrollPosRef.current = scrollPos;
    } else if (scrollPosRef && scrollPosRef.current > 0) {
      scrollRef.current.scrollLeft = scrollPosRef.current;
    }
  }, [followNow, isToday, nowMins, gridW]);

  function onGridScroll() {
    if (scrollRef.current && scrollPosRef) {
      scrollPosRef.current = scrollRef.current.scrollLeft;
    }
    if (quickStatus) setQuickStatus(null);
  }

  const day = bookings.filter((b) => b.date === date && b.status !== "cancelled");
  const dayBlocks = blocks.filter((bl) => bl.date === date);
  const unassigned = day.filter((b) =>
    b.status !== "completed" && (!(b.tables || []).length || b._conflict)
  );

  // ── Helpers (closures — depend on totalMins / nowMins) ──────────────────
  function pct(mins) { return ((mins - OPEN * 60) / totalMins) * 100 + "%"; }
  function liveDur(b) {
    if (b.status === "seated") {
      const elapsed = nowMins - toMins(b.time);
      return Math.max(15, elapsed);
    }
    return b.duration;
  }

  // ── Sub-components (close over parent state — must stay inline) ─────────
  function GridLines() {
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        {QUARTER_HOURS.map((m) => {
          const isH = m % 60 === 0;
          return (
            <div
              key={m}
              style={{
                position: "absolute", top: 0, bottom: 0, left: pct(m),
                borderLeft: isH ? "2px solid rgba(120,130,155,0.45)" : "0.5px solid rgba(140,150,175,0.3)",
                opacity: 1
              }}
            />
          );
        })}
        <div style={{
          position: "absolute", top: 0, bottom: 0, right: 0,
          borderLeft: "2px solid rgba(120,130,155,0.45)"
        }} />
      </div>
    );
  }

  function Block({ b }) {
    const d = liveDur(b);
    const sm = toMins(b.time) - OPEN * 60;
    const left = pct(OPEN * 60 + sm);
    const w = Math.max((d / totalMins) * 100, 0.5) + "%";
    const warn = warnings[b.id];
    const bgc = BLOCK_BG[b.status] || BLOCK_BG.confirmed;
    const border = warn
      ? (warn.overdue ? "3px solid #dc2626" : "3px solid #f59e0b")
      : "none";
    const hasPrefT = b.preferredTables && b.preferredTables.length > 0;
    const lbl = b.name + " (" + b.size + ")"
      + (isLocked(b) ? " [L]" : "")
      + (hasPrefT ? " ★" : "")
      + (warn && warn.overdue ? " !!" : "");

    // Per-instance refs for long-press detection. `blockEl` is unused —
    // preserved verbatim from original; flagged for Phase C cleanup.
    const pressTimer = useRef(null);
    const didLong = useRef(false);
    const touchStartPos = useRef(null);
    const blockEl = useRef(null);

    function onTouchStart(e) {
      didLong.current = false;
      const t = e.touches[0];
      touchStartPos.current = { x: t.clientX, y: t.clientY };
      const el = e.currentTarget;
      pressTimer.current = setTimeout(() => {
        didLong.current = true;
        const rect = el.getBoundingClientRect();
        setQuickStatus({ booking: b, x: rect.left, y: rect.top, w: rect.width, h: rect.height });
      }, 400);
    }
    function onTouchMove(e) {
      if (!touchStartPos.current) return;
      const t = e.touches[0];
      const dx = Math.abs(t.clientX - touchStartPos.current.x);
      const dy = Math.abs(t.clientY - touchStartPos.current.y);
      if (dx > 8 || dy > 8) {
        clearTimeout(pressTimer.current);
        pressTimer.current = null;
      }
    }
    function onTouchEnd(e) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
      if (didLong.current) e.preventDefault();
    }
    function onCtx(e) { e.preventDefault(); }
    function handleClick() {
      if (didLong.current) return;
      onEdit(b);
    }

    return (
      <div
        onClick={handleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onContextMenu={onCtx}
        style={{
          position: "absolute", top: 3, height: ROW_H - 8 + "px",
          left, width: w,
          background: bgc, borderRadius: 10, overflow: "hidden",
          display: "flex", alignItems: "center", boxSizing: "border-box",
          cursor: "pointer",
          border: border || "1px solid rgba(255,255,255,0.2)",
          WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
          boxShadow: "0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"
        }}
      >
        <span style={{
          flex: 1, padding: "0 8px",
          fontSize: 11, fontWeight: 700, color: "#fff",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
        }}>
          {lbl}
        </span>
        <span
          onClick={(e) => { e.stopPropagation(); onManual(b.id); }}
          style={{
            padding: "0 6px", fontSize: 13, cursor: "pointer",
            color: "rgba(255,255,255,0.7)",
            borderLeft: "1px solid rgba(255,255,255,0.3)",
            height: "100%", display: "flex", alignItems: "center", minWidth: 28
          }}
        >
          =
        </span>
      </div>
    );
  }

  function BlockBar({ bl }) {
    const bS = bl.allDay ? OPEN * 60 : toMins(bl.from);
    const bE = bl.allDay ? GRID_CLOSE * 60 : toMins(bl.to);
    const left = pct(bS);
    const w = Math.max(((bE - bS) / totalMins) * 100, 0.5) + "%";
    return (
      <div style={{
        position: "absolute", top: 1, height: ROW_H - 4 + "px",
        left, width: w,
        background: "repeating-linear-gradient(45deg,#991b1b,#991b1b 4px,#7f1d1d 4px,#7f1d1d 8px)",
        borderRadius: 4, opacity: 0.6,
        display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "none"
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: 1 }}>
          blocked
        </span>
      </div>
    );
  }

  // ── Header lines + labels (drawn once at top of grid column) ─────────────
  const headerLines = QUARTER_HOURS.concat([GRID_CLOSE * 60]).map((m) => {
    const isH = m % 60 === 0;
    return (
      <div
        key={"l" + m}
        style={{
          position: "absolute", top: 0, left: pct(m), bottom: 0,
          borderLeft: isH ? "2px solid rgba(120,130,155,0.45)" : "0.5px solid rgba(140,150,175,0.3)"
        }}
      />
    );
  });

  const headerLabels = QUARTER_HOURS
    .filter((m) => m % 60 === 0 && m < GRID_CLOSE * 60)
    .map((m) => {
      const center = ((m + 30 - OPEN * 60) / totalMins) * 100;
      return (
        <span
          key={"h" + m}
          style={{
            position: "absolute", top: 3, left: center + "%", transform: "translateX(-50%)",
            fontSize: 10, fontWeight: 600, color: "#fff",
            whiteSpace: "nowrap", pointerEvents: "none",
            background: "rgba(90,100,120,0.9)",
            padding: "2px 5px", borderRadius: 6, zIndex: 1,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
          }}
        >
          {String(Math.floor(m / 60)).padStart(2, "0") + ":00"}
        </span>
      );
    });

  // ── Labels column (left) — sticky table IDs + optional "unassigned" row ──
  const labelCol = (
    <div style={{ width: LABEL_W + "px", flexShrink: 0 }}>
      <div style={{
        height: 24, background: "rgba(220,225,235,0.45)",
        borderRadius: "6px 0 0 0",
        borderBottom: "2px solid rgba(180,190,210,0.3)",
        boxSizing: "border-box"
      }} />
      {TIMELINE_TABLES.map((tbl) => {
        const id = tbl.id;
        const indoor = isIn(id);
        const hasBlock = dayBlocks.some((bl) => bl.tableId === id);
        return (
          <div
            key={id}
            onClick={() => { if (onBlock) onBlock(id); }}
            style={{
              height: ROW_H + "px",
              display: "flex", alignItems: "center", justifyContent: "flex-end",
              paddingRight: 6,
              borderBottom: "2px solid rgba(180,190,210,0.2)",
              cursor: "pointer", boxSizing: "border-box"
            }}
          >
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "3px 0", borderRadius: 8,
              background: hasBlock ? "rgba(153,27,27,0.85)" : indoor ? TBL.ind.bg : TBL.out.bg,
              color: hasBlock ? "#fff" : indoor ? TBL.ind.text : TBL.out.text,
              border: "1px solid " + (hasBlock ? "rgba(153,27,27,0.5)" : indoor ? TBL.ind.border : TBL.out.border),
              width: 32, textAlign: "center", display: "inline-block",
              boxSizing: "border-box",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
            }}>
              {id}
            </span>
          </div>
        );
      })}
      {unassigned.length > 0 ? (
        <div style={{
          height: ROW_H + "px",
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          paddingRight: 6,
          borderTop: "1px dashed rgba(220,60,60,0.4)",
          marginTop: 4, boxSizing: "border-box"
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#991b1b" }}>
            unassigned
          </span>
        </div>
      ) : null}
    </div>
  );

  // ── Grid rows (one per table) ────────────────────────────────────────────
  // Each row holds GridLines, the day's table-blocks for this table, ghost
  // outlines (showing original duration for seated bookings — the dashed
  // border helps staff see how long the guest was originally booked for vs.
  // how long they've actually stayed), and the actual booking blocks.
  const gridRows = TIMELINE_TABLES.map((tbl) => {
    const id = tbl.id;
    const rows = day.filter((b) => (b.tables || []).includes(id));
    const tblBlocks = dayBlocks.filter((bl) => bl.tableId === id);
    return (
      <div
        key={id}
        style={{
          height: ROW_H + "px", position: "relative",
          borderBottom: "2px solid rgba(180,190,210,0.2)",
          boxSizing: "border-box"
        }}
      >
        <GridLines />
        {tblBlocks.map((bl, i) => <BlockBar key={"blk" + i} bl={bl} />)}
        {rows.filter((b) => b.status === "seated").map((b) => {
          const origD = b.originalDuration || b.duration;
          const sm = toMins(b.time) - OPEN * 60;
          const gLeft = pct(OPEN * 60 + sm);
          const gW = Math.max((origD / totalMins) * 100, 0.5) + "%";
          return (
            <div
              key={"ghost_" + b.id}
              style={{
                position: "absolute", top: 3, height: (ROW_H - 8) + "px",
                left: gLeft, width: gW,
                background: "transparent", borderRadius: 10,
                border: "2px dashed " + BLOCK_BG.seated,
                boxSizing: "border-box", pointerEvents: "none"
              }}
            />
          );
        })}
        {rows.map((b) => <Block key={b.id} b={b} />)}
      </div>
    );
  });

  // ── Unassigned grid row (parallels the unassigned label row in labelCol) ─
  const unassignedGrid = unassigned.length > 0 ? (
    <div style={{
      height: ROW_H + "px", position: "relative",
      borderTop: "1px dashed rgba(220,60,60,0.4)",
      marginTop: 4, boxSizing: "border-box"
    }}>
      <GridLines />
      {unassigned.map((b) => <Block key={b.id} b={b} />)}
    </div>
  ) : null;

  // ── Now line (today only) ────────────────────────────────────────────────
  const nowInRange = isToday && nowMins >= OPEN * 60 && nowMins <= GRID_CLOSE * 60;
  const nowLine = nowInRange ? (
    <div
      key="now"
      style={{
        position: "absolute", top: 0, bottom: 0, left: pct(nowMins),
        zIndex: 10, pointerEvents: "none"
      }}
    >
      <div style={{
        position: "absolute", top: 3, left: "50%", transform: "translateX(-50%)",
        fontSize: 10, fontWeight: 600, color: "#fff",
        background: "rgba(0,0,0,0.9)",
        padding: "2px 5px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 11,
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)"
      }}>
        {toTime(nowMins)}
      </div>
      <div style={{
        position: "absolute", top: 11, bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: 2, background: "rgba(0,0,0,0.6)"
      }} />
    </div>
  ) : null;

  // ── Grid column (right, scrollable) ──────────────────────────────────────
  const gridCol = (
    <div
      ref={scrollRef}
      onScroll={onGridScroll}
      style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}
    >
      <div style={{ width: gridW + "px", minWidth: "100%", position: "relative" }}>
        <div style={{
          position: "relative",
          borderBottom: "2px solid rgba(180,190,210,0.3)",
          background: "rgba(220,225,235,0.45)",
          borderRadius: "0 6px 0 0",
          height: 24, overflow: "visible", boxSizing: "border-box"
        }}>
          {headerLines}
          {headerLabels}
        </div>
        {gridRows}
        {unassignedGrid}
        {nowLine}
      </div>
    </div>
  );

  // ── Header controls (top row above the grid) ─────────────────────────────
  // Follow-now button: today only. Both label branches read "Follow" — visual
  // state is conveyed by the background colour. Preserved verbatim from
  // the original.
  const followBtn = isToday ? (
    <button
      onClick={() => {
        if (!followNow) {
          setFollowNow(true);
          if (zoom < 4) setZoom(4);
        } else {
          setFollowNow(false);
        }
      }}
      style={mkBtn({
        minHeight: 32, padding: "4px 10px", fontSize: 11,
        background: followNow ? "rgba(0,0,0,0.6)" : "rgba(120,130,150,0.5)"
      })}
    >
      {followNow ? "Follow" : "Follow"}
    </button>
  ) : null;

  // Zoom buttons (− · 1×/reset · +) — minimum 1× (i.e. never zoom below the
  // "fit one full service into the screen" baseline).
  const zoomBtns = (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {followBtn}
      <button
        onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
        style={mkBtn({ minHeight: 32, minWidth: 32, padding: "4px 10px", fontSize: 16, background: BTN.nav })}
      >
        -
      </button>
      <button
        onClick={() => { setZoom(1); setFollowNow(false); }}
        style={mkBtn({ minHeight: 32, padding: "4px 10px", fontSize: 11, background: zoom === 1 ? "#64748b" : BTN.nav })}
      >
        {zoom === 1 ? "1x" : zoom + "x → 1x"}
      </button>
      <button
        onClick={() => setZoom((z) => Math.min(5, z + 0.5))}
        style={mkBtn({ minHeight: 32, minWidth: 32, padding: "4px 10px", fontSize: 16, background: BTN.nav })}
      >
        +
      </button>
    </div>
  );

  // Optimizer toggle + Reshuffle (today only). Reshuffle is only shown when
  // the optimizer is OFF — when ON it runs continuously, no manual trigger
  // needed.
  const optBtns = isToday ? (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button
        onClick={() => setAutoOptimizer(!autoOptimizer)}
        style={mkBtn({
          minHeight: 32, padding: "4px 12px", fontSize: 11,
          background: autoOptimizer ? "rgba(22,101,52,0.75)" : "rgba(120,130,150,0.55)"
        })}
      >
        {"Optimizer: " + (autoOptimizer ? "ON" : "OFF")}
      </button>
      {!autoOptimizer ? (
        <button
          onClick={onReshuffle}
          style={mkBtn({ minHeight: 32, padding: "4px 12px", fontSize: 11, background: BTN.orange })}
        >
          Reshuffle
        </button>
      ) : null}
    </div>
  ) : null;

  // ── Legend chips (status colours + indoor/outdoor + blocked) ─────────────
  const legendEls = [];
  Object.keys(STATUS_COLORS).forEach((s) => {
    legendEls.push(
      <span
        key={s}
        style={{
          fontSize: 11, padding: "3px 8px", borderRadius: 8,
          background: BLOCK_BG[s] || "#999",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          fontWeight: 600, textTransform: "capitalize",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
        }}
      >
        {s}
      </span>
    );
  });
  legendEls.push(
    <span key="in" style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, background: TBL.ind.bg, color: "#fff", border: "1px solid rgba(255,255,255,0.2)", fontWeight: 600 }}>
      indoor
    </span>
  );
  legendEls.push(
    <span key="out" style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, background: TBL.out.bg, color: "#fff", border: "1px solid rgba(255,255,255,0.2)", fontWeight: 600 }}>
      outdoor
    </span>
  );
  legendEls.push(
    <span key="blocked" style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, background: "rgba(153,27,27,0.85)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", fontWeight: 600 }}>
      blocked
    </span>
  );

  // ── Quick-status popup (long-press → choose new status) ──────────────────
  const quickPopup = quickStatus ? (
    <div
      onClick={() => setQuickStatus(null)}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.18)"
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#eef1f7", borderRadius: 20,
          border: "1px solid " + S.border,
          boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
          padding: "20px 24px",
          minWidth: 240, maxWidth: 320, zIndex: 301
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: S.text, marginBottom: 16 }}>
          {quickStatus.booking.name}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {["confirmed", "seated", "completed", "cancelled"]
            .filter((st) => st !== quickStatus.booking.status)
            .map((st) => (
              <button
                key={st}
                style={{
                  background: BLOCK_BG[st], border: "none",
                  borderRadius: 12, padding: "10px 18px",
                  fontSize: 14, fontWeight: 700, color: "#fff",
                  cursor: "pointer", textTransform: "capitalize",
                  minHeight: 44, flex: "1 1 auto"
                }}
                onClick={() => {
                  onStatus(quickStatus.booking.id, st);
                  setQuickStatus(null);
                }}
              >
                {st}
              </button>
            ))}
        </div>
      </div>
    </div>
  ) : null;

  // ── Final assembly ───────────────────────────────────────────────────────
  return (
    <div style={{
      background: "rgba(255,255,255,0.4)",
      backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
      borderRadius: 20,
      border: "1px solid rgba(255,255,255,0.45)",
      padding: "10px 12px",
      boxShadow: "0 2px 16px rgba(0,0,0,0.06), inset 0 1px 1px rgba(255,255,255,0.6)"
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 8, gap: 8, flexWrap: "wrap"
      }}>
        {optBtns || <div />}
        {zoomBtns}
      </div>
      <div style={{ display: "flex" }}>
        {labelCol}
        {gridCol}
      </div>
      <div style={{
        marginTop: 10, display: "flex", gap: 8, alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap"
      }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", flex: "1 1 auto", minWidth: 0 }}>
          {legendEls}
        </div>
        <button
          onClick={onOpenSettings}
          title="Settings & keyboard shortcuts"
          style={{
            background: "rgba(120,130,150,0.4)",
            border: "1px solid rgba(255,255,255,0.45)",
            borderRadius: 10, width: 34, height: 34,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, padding: 0,
            color: S.text,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08), inset 0 1px 1px rgba(255,255,255,0.4)"
          }}
        >
          <CogIcon />
        </button>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: S.muted }}>
        tap booking to edit  ·  = assign  ·  hold to change status  ·  tap table label to block
      </div>
      {quickPopup}
    </div>
  );
}
