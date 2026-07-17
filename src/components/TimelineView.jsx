// src/components/TimelineView.jsx
// Timeline (Gantt-style) view of the day's bookings — horizontal scrollable
// grid with one row per table, blocks rendered as positioned divs along a
// time axis (OPEN – GRID_CLOSE, i.e. 13:00 – 23:00). Tap a block to edit,
// tap the "=" handle on a block to manually assign tables, long-press to
// change status, tap a table label on the left to block / unblock.
//
// Sub-components (ALL module-scope as of v17.1.0 — an inline component is a
// new type every render and React remounts its whole subtree):
//   • GridLines     — vertical hour / quarter-hour lines, drawn into each row.
//   • TimelineBlock — one booking, with touch handlers for long-press status
//                     popup (400ms hold) and short-tap edit. Holds its own
//                     timer / drag-detection refs (per-instance).
//   • BlockBar      — one table-block (date+from+to range) drawn as a striped
//                     red bar with a "blocked" caption.
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
// original.
//
// Phase C1 (v15-refactor): helper consolidation + cleanup.
//   • `pct` and `liveDur` (now `liveBarDur`) moved to booking-logic.js.
//   • Unused `blockEl = useRef(null)` dropped from the `Block` sub-component.
//   • Follow-now button now reads "Following" when active and "Follow" when
//     idle — fixes the previous "Follow"/"Follow" duplicate that relied on
//     colour alone to convey state.

import { useState, useRef, useEffect, useMemo, memo, Fragment } from "react";
import {
  OPEN, GRID_CLOSE, QUARTER_HOURS,
  ROW_H, LABEL_W, STATUS_COLORS, BLOCK_BG,
  S, TBL, BTN, TIMELINE_TABLES, hoursFor
} from "../lib/constants";
import { toMins, toTime, isLocked, isIn, pct, liveBarDur } from "../lib/booking-logic";
import { noShowMap, normalizePhone } from "../lib/customers";
import { mkBtn, Presence, Reveal, useFlip } from "./atoms";
import { QuickStatusPopup } from "./QuickStatusPopup";

// v15.8.0: module-level status-change animation state (survives the inline Block
// remount + any TimelineView remount during the save flow). Single timeline, so
// module scope is safe; entries are keyed by booking id and expire by timestamp.
let __prevStatus = null;
const __statusAnims = {};

// ── TimelineBlock — one booking block (v15.8.0: hoisted to module scope) ───────
// Previously an inline component inside TimelineView, which made React remount it
// every render (new function identity) — so its DOM node was recreated each time,
// breaking CSS position transitions and per-instance long-press refs. As a stable
// module-level component the node persists, so `transition: left/width` eases a
// reposition (seated-shift / reshuffle) and the wipe/fill overlays + long-press
// work reliably. Former closures are now props.
function TimelineBlock({ b, anim, flipId, nowMins, totalMins, warnings, late = null, noShows = 0, showChip = false, freeMin = null, currency = "€", onEdit, onManual, setQuickStatus, homeTable = null, tableAtY = null, setDragHover = null, onDropOnTable = null }) {
  const d = liveBarDur(b, nowMins);
  const sm = toMins(b.time) - OPEN * 60;
  const left = pct(OPEN * 60 + sm);
  const w = Math.max((d / totalMins) * 100, 0.5) + "%";
  const warn = warnings[b.id];
  const bgc = BLOCK_BG[b.status] || BLOCK_BG.confirmed;
  // v16.1.0: running-late amber border (confirmed booking past its time — the
  // `late` prop is "warn"/"noshow" from App's lateMap). Seated-overstay
  // warnings keep precedence (they carry the more urgent red tier).
  const border = warn
    ? (warn.overdue ? "3px solid var(--tl-block-warn)" : "3px solid var(--tl-block-warn-soon)")
    : (late ? "3px solid var(--tl-block-late)" : "none");
  const hasPrefT = b.preferredTables && b.preferredTables.length > 0;
  // v15.8.2: note marker — bookings with a note get a subtle "dog-ear" folded
  // corner. Kept OUT of the label string so it never truncates on narrow blocks.
  const hasNote = b.notes && b.notes.trim();
  // v16.0.0: repeat no-show offender marker (2+ past no-shows on this phone).
  const lbl = b.name + " (" + b.size + ")"
    + (isLocked(b) ? " [L]" : "")
    + (hasPrefT ? " ★" : "")
    + (noShows >= 2 ? " ⚠" : "")
    + ((Number(b.deposit) || 0) > 0 ? " " + currency : "")   // v16.3.0 deposit marker (v17.0.0: currency from settings/general)
    + (warn && warn.overdue ? " !!" : "");
  // v16.0.0: at-a-glance start-time chip. Compact translucent pill before the
  // name. The show/hide decision (`showChip`) is made ONCE at the TimelineView
  // level for the WHOLE day — all blocks show chips or none do (a mixed grid
  // read messy in live QA). marginLeft clears the v15.8.2 dog-ear corner so a
  // noted booking's fold never overlaps.
  // v16.1.1: wrapped in a HORIZONTAL Reveal (eases occupied width 0↔full) rather
  // than Presence (transform slide). Presence only translated the chip, so the
  // flexbox reserved/released the chip's width in one frame and the sibling name
  // span SNAPPED. With the width easing, the flex:1 name slides in lockstep.
  const timeChip = (
    <Reveal show={showChip} horizontal style={{ pointerEvents: "none" }}>
      <span style={{
        flexShrink: 0, marginLeft: 6, padding: "1px 4px", borderRadius: 5,
        fontSize: 9, fontWeight: 700, lineHeight: "12px", fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        background: "rgba(255,255,255,0.25)", color: "var(--text-on-accent)",
        pointerEvents: "none", position: "relative"
      }}>{b.time}</span>
    </Reveal>
  );

  // Per-instance refs for long-press detection.
  const pressTimer = useRef(null);
  const didLong = useRef(false);
  const touchStartPos = useRef(null);

  // ── v17.0.0 correction: drag & drop to another table row ──────────────────
  // Mouse: vertical movement > 6px starts the drag (below it, click→edit wins).
  // Touch: the 400ms long-press opens quick-status as before; KEEP HOLDING to
  // ~800ms (unmoved) and the popup is dismissed — the block lifts and follows
  // the finger. Dropping on a row calls onDropOnTable(bookingId, tableId); App
  // decides move vs swap. Vertical offset lives in local state (translateY);
  // the horizontal position (time) never changes.
  const dragRef = useRef(null);            // {y0, pid, el, active, lastY}
  const [dragDy, setDragDy] = useState(null);
  const dragHoldTimer = useRef(null);      // touch: the 800ms drag-mode timer
  const preventScrollRef = useRef(null);   // native non-passive touchmove blocker
  const dragRafRef = useRef(0);            // v17.0.0 review fix #4: coalesce moves to one render/frame

  function beginDrag(el, pid) {
    dragRef.current = { ...(dragRef.current || {}), active: true };
    didLong.current = true;                // suppress the click→edit on release
    // Capturing on the block itself is safe (the PlanView gotcha was capturing
    // on a PARENT, which redirects child clicks) — and needed so a fast mouse
    // that leaves the block mid-drag keeps sending us moves.
    try { el.setPointerCapture(pid); } catch (_e) { /* no-op */ }
  }
  function onDragPointerDown(e) {
    if (!onDropOnTable || !tableAtY) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { y0: e.clientY, pid: e.pointerId, el: e.currentTarget, active: false };
    if (e.pointerType !== "mouse") {
      clearTimeout(dragHoldTimer.current);
      dragHoldTimer.current = setTimeout(() => {
        const d = dragRef.current;
        if (!d || d.active) return;
        setQuickStatus(null);              // the 400ms popup opened — drag wins
        beginDrag(d.el, d.pid);
        // React 17+ roots attach touchmove passively — a native non-passive
        // listener is the only way to stop the page scrolling mid-drag.
        const prevent = (ev) => { ev.preventDefault(); };
        d.el.addEventListener("touchmove", prevent, { passive: false });
        preventScrollRef.current = { el: d.el, fn: prevent };
      }, 800);
    }
  }
  function onDragPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    if (!d.active) {
      if (e.pointerType === "mouse" && Math.abs(e.clientY - d.y0) > 6) beginDrag(e.currentTarget, d.pid);
      else return;
    }
    // v17.0.0 review fix #4: coalesce the render+hover work to one rAF/frame —
    // a raw pointermove fires far more often than the display refreshes, and
    // each one setState-d. (A drag only runs while the tab is visible, so the
    // "rAF never fires when hidden" trap doesn't apply here.)
    d.lastY = e.clientY;
    if (dragRafRef.current) return;
    dragRafRef.current = requestAnimationFrame(function () {
      dragRafRef.current = 0;
      const dd = dragRef.current;
      if (!dd || !dd.active) return;
      setDragDy(dd.lastY - dd.y0);
      if (setDragHover) setDragHover(tableAtY(dd.lastY));
    });
  }
  function endDrag(e, commit) {
    clearTimeout(dragHoldTimer.current);
    if (dragRafRef.current) { cancelAnimationFrame(dragRafRef.current); dragRafRef.current = 0; }
    if (preventScrollRef.current) {
      preventScrollRef.current.el.removeEventListener("touchmove", preventScrollRef.current.fn);
      preventScrollRef.current = null;
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.active) {
      const target = commit ? tableAtY(e.clientY) : null;
      if (target && target !== homeTable) onDropOnTable(b.id, target);
    }
    setDragDy(null);
    if (setDragHover) setDragHover(null);
  }

  // v15.8.0: status-change overlay. `anim` ('wipe' Confirmed→Seated / 'fill'
  // Seated→Completed) is detected at the TimelineView level and passed in; the
  // overlay of the OLD colour animates away (keyframe on mount), revealing the new
  // status colour underneath. wipe = left-to-right clip (v15.9.0: unified with
  // the List/form wipes — ltr, 760ms); fill = fade-out.
  const animOverlay = anim ? (
    <div
      className={anim === "wipe" ? "mgt-wipe-ltr" : "mgt-fade-overlay"}
      style={{
        position: "absolute", inset: 0, borderRadius: 10, pointerEvents: "none",
        background: anim === "wipe" ? BLOCK_BG.confirmed : BLOCK_BG.seated
      }}
    />
  ) : null;

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
      // moving before the 800ms drag-hold fires = a scroll, not a drag
      if (!(dragRef.current && dragRef.current.active)) clearTimeout(dragHoldTimer.current);
    }
  }
  function onTouchEnd(e) {
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
    if (didLong.current) e.preventDefault();
  }
  // v15.8.0: right-click opens the same quick-action menu as long-press/tap.
  // v17.0.0 round 7 (Android fix): the native LONG-PRESS also fires contextmenu
  // (~500ms, MagicOS/Chrome) — mid-hold it must not reopen the popup the 800ms
  // drag-arm just dismissed, and must not cancel the pointer stream. A pending
  // or active drag (dragRef set) swallows it.
  function onCtx(e) {
    e.preventDefault();
    if (dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setQuickStatus({ booking: b, x: rect.left, y: rect.top, w: rect.width, h: rect.height });
  }
  function handleClick() {
    if (didLong.current) return;
    onEdit(b);
  }

  return (
    <div
      className="mgt-hover-scale"
      data-flip-id={flipId || undefined}
      onClick={handleClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onContextMenu={onCtx}
      onPointerDown={onDragPointerDown}
      onPointerMove={onDragPointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
      style={{
        position: "absolute", top: 3, height: ROW_H - 8 + "px",
        left, width: w,
        background: bgc, borderRadius: 10, overflow: "hidden",
        display: "flex", alignItems: "center", boxSizing: "border-box",
        cursor: dragDy != null ? "grabbing" : "pointer",
        border: border || "1px solid rgba(255,255,255,0.2)",
        WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
        // v17.0.0 round 7 (Android fix): without this, the browser claims any
        // vertical touch movement on a block for page scroll and fires
        // pointercancel BEFORE the 800ms drag-hold arms — drag never started on
        // MagicOS/Chrome. pan-x keeps horizontal timeline scrolling from a block
        // while reserving vertical gestures for the drag.
        touchAction: "pan-x",
        boxShadow: dragDy != null ? "0 10px 24px rgba(0,0,0,0.3)" : "0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)",
        // v17.0.0: while dragging, the inline transform/zIndex/opacity lift the
        // block and follow the pointer (inline transform beats the hover class).
        ...(dragDy != null ? { transform: "translateY(" + dragDy + "px)", zIndex: 30, opacity: 0.85 } : null),
        // v15.8.0: reposition eases (seated-shift / reshuffle). v15.8.1: `transform`
        // re-added so the .mgt-hover-scale lift eases again — the inline transition had
        // been overriding the class's `transform 120ms`, making the hover scale instant.
        // The seated ghost outline mirrors this exact transition so the two lift together.
        transition: dragDy != null ? "none" : "left 320ms ease, width 320ms ease, transform 120ms ease"
      }}
    >
      {animOverlay}
      {/* v15.8.2: top-LEFT dog-ear note marker (clear of the right-edge "=" handle). The
          block's overflow:hidden + borderRadius clip it into a clean folded corner. The
          white triangle (14px) sits in the top ~14px of the 36px block, so it never
          overlaps the vertically-centred guest name. A small dark note/pencil glyph nests
          in the corner where the triangle is thickest. Near-solid white + dark icon give
          strong contrast on every saturated BLOCK_BG fill in both themes. */}
      {hasNote ? (
        <>
          <div style={{
            position: "absolute", top: 0, left: 0, width: 0, height: 0,
            borderTop: "14px solid rgba(255,255,255,0.95)",
            borderRight: "14px solid transparent",
            pointerEvents: "none"
          }} />
          <svg viewBox="0 0 24 24" width="8" height="8" style={{
            position: "absolute", top: "0.5px", left: "0.5px", pointerEvents: "none"
          }}>
            <path
              d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
              fill="#1f2937"
            />
          </svg>
        </>
      ) : null}
      {timeChip}
      <span style={{
        flex: 1, padding: "0 8px 0 6px", position: "relative",
        fontSize: 11, fontWeight: 700, color: "var(--text-on-accent)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
      }}>
        {lbl}
      </span>
      {/* v16.3.0: table-turn countdown pill — a seated block within ~15 min of
          its scheduled end shows "~Nm" (translucent, like the start-time chip).
          Flex item before the "=" handle (no absolute overlap of the name); the
          seated block is near full width this late, so there's room. */}
      {freeMin != null ? (
        <span style={{
          flexShrink: 0, marginRight: 2, padding: "1px 5px", borderRadius: 5,
          fontSize: 9, fontWeight: 700, lineHeight: "12px", fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap", position: "relative",
          background: "rgba(255,255,255,0.28)", color: "var(--text-on-accent)",
          pointerEvents: "none"
        }}>{"~" + freeMin + "m"}</span>
      ) : null}
      <span
        onClick={(e) => { e.stopPropagation(); onManual(b.id); }}
        style={{
          padding: "0 6px", fontSize: 13, cursor: "pointer", position: "relative",
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

// ── GridLines / BlockBar — hoisted to module scope (v17.1.0 perf) ────────────
// These were inline components inside TimelineView, which made React see a NEW
// component TYPE every render — so their entire subtrees (≈40 grid-line divs ×
// 13 rows) were UNMOUNTED and REBUILT on every render (every form keystroke,
// every 15s tick). Same bug class as the v15.8.0 TimelineBlock hoist. Both read
// the live bindings (QUARTER_HOURS / OPEN / GRID_CLOSE via pct) at render time,
// so hoisting preserves the operating-hours reactivity; BlockBar's former
// `totalMins` closure is now a prop.
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
              borderLeft: isH ? "2px solid var(--tl-gridline-hour)" : "0.5px solid var(--tl-gridline-quarter)",
              opacity: 1
            }}
          />
        );
      })}
      <div style={{
        position: "absolute", top: 0, bottom: 0, right: 0,
        borderLeft: "2px solid var(--tl-gridline-hour)"
      }} />
    </div>
  );
}

function BlockBar({ bl, totalMins }) {
  const bS = bl.allDay ? OPEN * 60 : toMins(bl.from);
  const bE = bl.allDay ? GRID_CLOSE * 60 : toMins(bl.to);
  const left = pct(bS);
  const w = Math.max(((bE - bS) / totalMins) * 100, 0.5) + "%";
  return (
    <div style={{
      position: "absolute", top: 1, height: ROW_H - 4 + "px",
      left, width: w,
      background: "repeating-linear-gradient(45deg,var(--tl-blocked-a),var(--tl-blocked-a) 4px,var(--tl-blocked-b) 4px,var(--tl-blocked-b) 8px)",
      borderRadius: 4, opacity: 0.6,
      display: "flex", alignItems: "center", justifyContent: "center",
      pointerEvents: "none"
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-on-accent)", textTransform: "uppercase", letterSpacing: 1 }}>
        blocked
      </span>
    </div>
  );
}

// v17.1.0 perf: React.memo — BookingApp re-renders on every form keystroke /
// banner tick, and the timeline is its heaviest subtree. All function props are
// the stable VA wrappers (App.jsx viewActionsRef pattern); `hoursSig` and
// `layoutSig` are identity-only props that bust the memo when the operating
// hours or table layout change (this component reads OPEN/GRID_CLOSE/
// QUARTER_HOURS/TIMELINE_TABLES as live module bindings the memo can't see).
export const TimelineView = memo(function TimelineView({
  bookings, date, onEdit, onManual, onStatus,
  blocks = [], onBlock, nowMins = 0, warnings = {},
  late = {}, freeing = {}, onNoShow = () => {},
  zoom = 1, setZoom,
  followNow, setFollowNow,
  scrollPosRef,
  autoOptimizer = true,
  setAutoOptimizer = () => {},
  currency = "€", // v17.0.0: settings/general deposit marker
  onDropOnTable = null, // v17.0.0 correction: drag&drop move/swap handler (App)
  onReshuffle = () => {},
}) {
  const scrollRef = useRef(null);
  const followRafRef = useRef(0);   // v15.8.1: pending rAF id for the follow re-assert loop
  const [quickStatus, setQuickStatus] = useState(null);
  // v17.0.0 correction: the table row a drag currently hovers (highlight).
  const [dragHover, setDragHover] = useState(null);
  const isToday = date === new Date().toISOString().slice(0, 10);
  const totalMins = (GRID_CLOSE - OPEN) * 60;
  const gridW = Math.max(320, totalMins * zoom * 1.2);
  // v16.0.0: px-per-minute estimate for the time-chip decision (gridW is a
  // lower bound — minWidth:100% can stretch wider — so the hide errs
  // conservative) + the repeat-no-show map (full bookings list, all dates).
  const pxPerMin = gridW / totalMins;
  // v17.1.0 perf: noShowMap walks EVERY booking (all dates — grows with
  // history); memo on the bookings ref so it no longer reruns per render.
  const nsMap = useMemo(() => noShowMap(bookings), [bookings]);

  // ── Follow-now scroll synchronisation ────────────────────────────────────
  // When followNow is on (today only), keep the current minute ~30 min from
  // the left edge. Otherwise restore the last known scroll position from the
  // ref — this lets the user navigate away and back without losing context.
  //
  // v15.8.1: centre the now-line, in LOCKSTEP with the grid's `width` transition.
  // Both Follow (zoom 1×→4×) and the +/- zoom buttons ease the grid width over
  // ~340ms (the v15.8.0 zoom transition). Pinning scrollLeft to a target computed
  // from the FINAL width fights the still-transitioning width — the scroll clamps,
  // jumps, and corrects, so the grid visibly jitters back and forth (the reported
  // bug). `centerNow` instead takes a FRACTION and re-derives scrollLeft from the
  // grid's CURRENT (live, mid-transition) width each frame, so the scroll and the
  // width animate together and the now-line stays put — the zoom eases smoothly
  // around it with no fighting. Runs for a short window (covers the transition) then
  // stops. On a mount / 15s tick the width is already final, so each frame writes
  // the same value (idempotent — no visible motion). prefers-reduced-motion zeroes
  // the width transition, so the grid is final immediately and this stays instant.
  function centerNow(fraction) {
    cancelAnimationFrame(followRafRef.current);
    const start = performance.now();
    function step() {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollLeft = fraction * el.scrollWidth;
      if (performance.now() - start < 500) {
        followRafRef.current = requestAnimationFrame(step);
      }
    }
    step();
  }
  useEffect(() => {
    if (!scrollRef.current) return undefined;
    if (followNow && isToday && nowMins >= OPEN * 60 && nowMins <= GRID_CLOSE * 60) {
      const targetMins = Math.max(OPEN * 60, nowMins - 30);
      const fraction = (targetMins - OPEN * 60) / totalMins;
      centerNow(fraction);
      if (scrollPosRef) scrollPosRef.current = fraction * gridW;
    } else if (scrollPosRef && scrollPosRef.current > 0) {
      scrollRef.current.scrollLeft = scrollPosRef.current;
    }
    return () => cancelAnimationFrame(followRafRef.current);
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

  // v16.0.0 follow-up: start-time chips are CONFIRMED-ONLY (a seated/completed
  // party has arrived — the start time is no longer at-a-glance info, so those
  // blocks never carry a chip) and ALL-OR-NOTHING across the day's CONFIRMED
  // blocks — shown only when every confirmed block is wide enough that its name
  // keeps ≥~55px after the chip (~42px) and the fixed "=" assign handle
  // (~41px), i.e. ≥140px. A per-block decision left a mixed grid, which read
  // messy in live QA; and scoping the every() to confirmed blocks means a
  // status change (seated/completed durations shrink/stretch) can never kill
  // the other bookings' chips (the reported bug). Each flip animates per block
  // via Presence.
  // v17.0.0: pending joins the chip family (treated same as confirmed).
  const confirmedDay = day.filter((b) => b.status === "confirmed" || b.status === "pending");
  const chipsOn = confirmedDay.length > 0 && confirmedDay.every((b) => liveBarDur(b, nowMins) * pxPerMin >= 140);

  // v15.8.0 cont.4: FLIP the blocks so a table REASSIGNMENT (a vertical row move the
  // CSS left/width transition can't cover — the block re-parents into a new row) eases
  // into place. Keyed on the assignment signature ONLY, so it fires on a table change —
  // never on the 15s width/nowMins tick or a horizontal time-shift (those stay pure
  // CSS). useFlip matches by data-flip-id (translateY only), so a re-parented block
  // still eases from its old row to the new one.
  // cont.4 fix: a booking on N tables renders N cells — tagging every cell with the
  // same b.id made useFlip's id→top map collide (last cell wins), so on EVERY change
  // (open/date/view switch, add/edit) the booking spuriously animated. So only the
  // booking's PRIMARY cell (its first table, or the unassigned cell when it has none)
  // carries data-flip-id — one element per id, no collision, animates only a real move.
  const assignSig = day.map((b) => b.id + "@" + (b.tables || []).join("-")).join(",");
  const flipRef = useFlip([assignSig]);

  // ── Status-change animations (v15.8.0) ──────────────────────────────────
  // Detection uses MODULE-level maps (__prevStatus / __statusAnims) so a stamp
  // survives the inline `Block` remounting AND any TimelineView re-render/remount
  // during the multi-commit save flow. On a confirmed→seated / seated→completed
  // transition we stamp `id → {type, until}` and pass `anim` to that Block for
  // ~700ms; the Block plays a keyframe overlay (fires on mount). bumpAnim forces
  // the render that first shows it + a timeout forces one render to clear it.
  const [, bumpAnim] = useState(0);
  useEffect(function () {
    const prev = __prevStatus;
    const now = Date.now();
    if (prev) {
      let changed = false;
      day.forEach(function (b) {
        const p = prev[b.id];
        // v15.9.0: window 700→800ms so it outlives the slowed 760ms wipe keyframe
        // (an early unmount would pop the last sliver of the old colour off).
        if (p === "confirmed" && b.status === "seated") { __statusAnims[b.id] = { type: "wipe", until: now + 800 }; changed = true; }
        else if (p === "seated" && b.status === "completed") { __statusAnims[b.id] = { type: "fill", until: now + 800 }; changed = true; }
      });
      if (changed) { bumpAnim(function (n) { return n + 1; }); setTimeout(function () { bumpAnim(function (n) { return n + 1; }); }, 820); }
    }
    const m = {};
    day.forEach(function (b) { m[b.id] = b.status; });
    __prevStatus = m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the bookings array
  }, [bookings]);
  function statusAnimOf(id) {
    const a = __statusAnims[id];
    return a && a.until > Date.now() ? a.type : null;
  }

  // GridLines / BlockBar / TimelineBlock are all HOISTED to module scope (top
  // of file) so their DOM nodes persist across TimelineView re-renders — the
  // v15.8.0 TimelineBlock lesson, extended to the grid chrome in v17.1.0
  // (inline component = new type every render = full subtree remount).

  // ── Header lines + labels (drawn once at top of grid column) ─────────────
  // v14.4.1: map over QUARTER_HOURS only (NOT concat([GRID_CLOSE*60])). The
  // right-edge line is now drawn separately as a `right:0` div in the header
  // strip below — matching the grid rows' GridLines convention so the rightmost
  // header line aligns with the body's (the old left:pct(100%) line sat ~2px to
  // the right of the body's right:0 line).
  const headerLines = QUARTER_HOURS.map((m) => {
    const isH = m % 60 === 0;
    return (
      <div
        key={"l" + m}
        style={{
          position: "absolute", top: 0, left: pct(m), bottom: 0,
          borderLeft: isH ? "2px solid var(--tl-gridline-hour)" : "0.5px solid var(--tl-gridline-quarter)"
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
            fontSize: 10, fontWeight: 600, color: "var(--text-on-accent)",
            whiteSpace: "nowrap", pointerEvents: "none",
            background: "var(--tl-hour-pill)",
            padding: "2px 5px", borderRadius: 6, zIndex: 1,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
          }}
        >
          {String(Math.floor(m / 60) % 24).padStart(2, "0") + ":00"}
        </span>
      );
    });

  // ── Labels column (left) — sticky table IDs + optional "unassigned" row ──
  const labelCol = (
    // v14.3.1 (Fix 3): paddingTop mirrors the grid scroller's padding so the
    // 24px header + ROW_H rows line up with the grid column after the pad.
    <div style={{ width: LABEL_W + "px", flexShrink: 0, paddingTop: 8 }}>
      <div style={{
        height: 24, background: "var(--tl-header-strip)",
        borderRadius: "6px 0 0 0",
        borderBottom: "2px solid var(--tl-header-border)",
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
              borderBottom: "2px solid var(--tl-row-border)",
              cursor: "pointer", boxSizing: "border-box"
            }}
          >
            <span className="mgt-hover-scale" style={{
              fontSize: 11, fontWeight: 600, padding: "3px 0", borderRadius: 8,
              background: hasBlock ? "var(--tl-blocked-badge)" : indoor ? TBL.ind.bg : TBL.out.bg,
              color: hasBlock ? "var(--text-on-accent)" : indoor ? TBL.ind.text : TBL.out.text,
              border: "1px solid " + (hasBlock ? "var(--tl-blocked-badge-border)" : indoor ? TBL.ind.border : TBL.out.border),
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
          borderTop: "1px dashed var(--tl-unassigned-border)",
          marginTop: 4, boxSizing: "border-box"
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--danger-text)" }}>
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
  // v17.0.0 correction: map a pointer's clientY to the table row under it —
  // rows are exactly ROW_H tall inside the grid body (flipRef.current), after
  // the 24px header strip. Returns null outside the table rows (header /
  // unassigned row / off-grid) so a drop there is a no-op snap-back.
  function tableForClientY(clientY) {
    const el = flipRef.current;
    if (!el) return null;
    const top = el.getBoundingClientRect().top + 24;
    const idx = Math.floor((clientY - top) / ROW_H);
    return idx >= 0 && idx < TIMELINE_TABLES.length ? TIMELINE_TABLES[idx].id : null;
  }

  const gridRows = TIMELINE_TABLES.map((tbl) => {
    const id = tbl.id;
    const rows = day.filter((b) => (b.tables || []).includes(id));
    const tblBlocks = dayBlocks.filter((bl) => bl.tableId === id);
    return (
      <div
        key={id}
        style={{
          height: ROW_H + "px", position: "relative",
          borderBottom: "2px solid var(--tl-row-border)",
          boxSizing: "border-box",
          // drag&drop target highlight (subtle accent tint while hovered)
          background: dragHover === id ? "var(--bg-ac-hover)" : undefined
        }}
      >
        <GridLines />
        {tblBlocks.map((bl, i) => <BlockBar key={"blk" + i} bl={bl} totalMins={totalMins} />)}
        {/* v15.8.1: render each seated booking's dashed "ghost" (original-duration
            outline) IMMEDIATELY BEFORE its block, so the ghost mirrors EVERY cell
            effect: (1) reposition — same left/width + transform transition; (2) vertical
            reassign — FLIP on the PRIMARY cell only (distinct `__ghost` id namespace so
            it never collides with the block's data-flip-id={b.id}); (3) hover-lift — the
            ghost paints under its block but, being its immediate preceding sibling, is
            scaled by the `.mgt-tlghost:has(+ .mgt-hover-scale:hover)` rule (index.html)
            so it lifts in lockstep with the block. */}
        {rows.map((b) => {
          let ghost = null;
          if (b.status === "seated") {
            const origD = b.originalDuration || b.duration;
            const sm = toMins(b.time) - OPEN * 60;
            const gLeft = pct(OPEN * 60 + sm);
            const gW = Math.max((origD / totalMins) * 100, 0.5) + "%";
            ghost = (
              <div
                className="mgt-tlghost"
                data-flip-id={(b.tables || [])[0] === id ? b.id + "__ghost" : undefined}
                style={{
                  position: "absolute", top: 3, height: (ROW_H - 8) + "px",
                  left: gLeft, width: gW,
                  background: "transparent", borderRadius: 10,
                  border: "2px dashed " + BLOCK_BG.seated,
                  boxSizing: "border-box", pointerEvents: "none",
                  transition: "left 320ms ease, width 320ms ease, transform 120ms ease"
                }}
              />
            );
          }
          return (
            <Fragment key={b.id}>
              {ghost}
              <TimelineBlock b={b} anim={statusAnimOf(b.id)} flipId={(b.tables || [])[0] === id ? b.id : null} nowMins={nowMins} totalMins={totalMins} warnings={warnings} currency={currency} late={late[b.id] || null} noShows={nsMap[normalizePhone(b.phone)] || 0} showChip={chipsOn && (b.status === "confirmed" || b.status === "pending")} freeMin={(b.tables || [])[0] === id ? (freeing[b.id] != null ? freeing[b.id] : null) : null} onEdit={onEdit} onManual={onManual} setQuickStatus={setQuickStatus} homeTable={id} tableAtY={tableForClientY} setDragHover={setDragHover} onDropOnTable={onDropOnTable} />
            </Fragment>
          );
        })}
      </div>
    );
  });

  // ── Unassigned grid row (parallels the unassigned label row in labelCol) ─
  const unassignedGrid = unassigned.length > 0 ? (
    <div style={{
      height: ROW_H + "px", position: "relative",
      borderTop: "1px dashed var(--tl-unassigned-border)",
      marginTop: 4, boxSizing: "border-box"
    }}>
      <GridLines />
      {unassigned.map((b) => <TimelineBlock key={b.id} b={b} anim={statusAnimOf(b.id)} flipId={(b.tables || []).length ? null : b.id} nowMins={nowMins} totalMins={totalMins} warnings={warnings} currency={currency} late={late[b.id] || null} noShows={nsMap[normalizePhone(b.phone)] || 0} showChip={chipsOn && (b.status === "confirmed" || b.status === "pending")} onEdit={onEdit} onManual={onManual} setQuickStatus={setQuickStatus} homeTable={null} tableAtY={tableForClientY} setDragHover={setDragHover} onDropOnTable={onDropOnTable} />)}
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
        fontSize: 10, fontWeight: 600, color: "var(--text-on-accent)",
        background: "var(--tl-now-pill)",
        padding: "2px 5px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 11,
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)"
      }}>
        {toTime(nowMins)}
      </div>
      <div style={{
        position: "absolute", top: 11, bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: 2, background: "var(--tl-now-line)"
      }} />
    </div>
  ) : null;

  // ── Grid column (right, scrollable) ──────────────────────────────────────
  const gridCol = (
    <div
      ref={scrollRef}
      onScroll={onGridScroll}
      // v14.3.1 (Fix 3): pad the scroller so a hover-scaled block at the grid
      // edges (first/last minute, top/bottom row) doesn't clip on any side.
      // labelCol gets a matching paddingTop so its rows stay aligned with the grid.
      style={{ flex: 1, overflowX: "auto", overflowY: "hidden", padding: 8 }}
    >
      {/* v15.8.0: width transitions so a zoom change (+/− / 1× / Follow) eases to
          the new scale. Blocks/gridlines are %-positioned against this width, so
          they re-scale with it for free. (The one layout-bound animation — see
          REFACTOR_LOG perf note; the global prefers-reduced-motion guard zeroes it.) */}
      <div ref={flipRef} style={{ width: gridW + "px", minWidth: "100%", position: "relative", transition: "width 340ms ease-in-out" }}>
        <div style={{
          position: "relative",
          borderBottom: "2px solid var(--tl-header-border)",
          background: "var(--tl-header-strip)",
          borderRadius: "0 6px 0 0",
          height: 24, overflow: "visible", boxSizing: "border-box"
        }}>
          {headerLines}
          <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, borderLeft: "2px solid var(--tl-gridline-hour)" }} />
          {headerLabels}
        </div>
        {gridRows}
        {unassignedGrid}
        {nowLine}
      </div>
    </div>
  );

  // ── Header controls (top row above the grid) ─────────────────────────────
  // Follow-now button: today only. Phase C1 — label flips between "Following"
  // and "Follow" so screen-readers and quick visual scans get the state from
  // the text, not just the background colour. Background still flips for
  // emphasis.
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
      className="mgt-hover-scale mgt-press"
      style={mkBtn({
        minHeight: 32, padding: "4px 10px", fontSize: 11,
        background: followNow ? "rgba(0,0,0,0.6)" : "rgba(120,130,150,0.5)"
      })}
    >
      {followNow ? "Following" : "Follow"}
    </button>
  ) : null;

  // Zoom buttons (− · 1×/reset · +) — minimum 1× (i.e. never zoom below the
  // "fit one full service into the screen" baseline).
  const zoomBtns = (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {followBtn}
      <button
        onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 32, minWidth: 32, padding: "4px 10px", fontSize: 16, background: BTN.nav })}
      >
        -
      </button>
      <button
        onClick={() => { setZoom(1); setFollowNow(false); }}
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 32, padding: "4px 10px", fontSize: 11, background: zoom === 1 ? "var(--btn-default)" : BTN.nav })}
      >
        {zoom === 1 ? "1x" : zoom + "x → 1x"}
      </button>
      <button
        onClick={() => setZoom((z) => Math.min(5, z + 0.5))}
        className="mgt-hover-scale mgt-press"
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
        className="mgt-hover-scale"
        style={mkBtn({
          minHeight: 32, padding: "4px 12px", fontSize: 11,
          background: autoOptimizer ? "rgba(22,101,52,0.75)" : "rgba(120,130,150,0.55)"
        })}
      >
        {"Optimizer: " + (autoOptimizer ? "ON" : "OFF")}
      </button>
      {/* v15.8.0: slides in L→R when Optimizer is toggled OFF, slides out →L when ON. */}
      <Presence show={!autoOptimizer} inClass="mgt-slide-in" outClass="mgt-slide-out" outMs={190} tag="span">
        <button
          onClick={onReshuffle}
          className="mgt-hover-scale"
          style={mkBtn({ minHeight: 32, padding: "4px 12px", fontSize: 11, background: BTN.orange })}
        >
          Reshuffle
        </button>
      </Presence>
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
          color: "var(--text-on-accent)",
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
    <span key="in" style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, background: TBL.ind.bg, color: "var(--text-on-accent)", border: "1px solid rgba(255,255,255,0.2)", fontWeight: 600 }}>
      indoor
    </span>
  );
  legendEls.push(
    <span key="out" style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, background: TBL.out.bg, color: "var(--text-on-accent)", border: "1px solid rgba(255,255,255,0.2)", fontWeight: 600 }}>
      outdoor
    </span>
  );
  legendEls.push(
    <span key="blocked" style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, background: "var(--tl-blocked-badge)", color: "var(--text-on-accent)", border: "1px solid rgba(255,255,255,0.2)", fontWeight: 600 }}>
      blocked
    </span>
  );

  // ── Quick-status popup (long-press → choose new status) ──────────────────
  // v17.0.0: the popup body moved VERBATIM to QuickStatusPopup.jsx so PlanView
  // shares the same status-gating (pending → Confirmed/Cancel; late no-show).
  const quickPopup = quickStatus ? (
    <QuickStatusPopup
      booking={quickStatus.booking}
      late={late}
      onStatus={onStatus}
      onNoShow={onNoShow}
      onClose={() => setQuickStatus(null)} />
  ) : null;

  // ── Final assembly ───────────────────────────────────────────────────────
  return (
    <div style={{
      background: "var(--tl-card-bg)",
      backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
      borderRadius: 20,
      border: "1px solid var(--tl-card-border)",
      padding: "10px 12px",
      boxShadow: "var(--shadow-soft)"
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 8, gap: 8, flexWrap: "wrap"
      }}>
        {optBtns || <div />}
        {zoomBtns}
      </div>
      {/* v15.0.0: per-weekday hours — a "Closed" notice over the (still-dimensioned)
          grid when the viewed day is marked closed in Settings → Opening hours. */}
      {hoursFor(date).closed ? (
        <div style={{
          background: "var(--warn-bg)", border: "1px solid var(--warn-border)",
          borderRadius: 12, padding: "8px 14px", marginBottom: 8,
          fontSize: 13, fontWeight: 700, color: "var(--warn-text)", textAlign: "center"
        }}>
          Closed this day — no bookings or walk-ins. Adjust in Settings → Opening hours.
        </div>
      ) : null}
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
        {/* v17.0.0 round 8: the 🔍/⚙ pair moved OUT to App's date-nav row
            (ViewTools.jsx) so it sits in one place for all three views. */}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: S.muted }}>
        tap booking to edit  ·  = assign  ·  hold to change status  ·  tap table label to block
      </div>
      {quickPopup}
    </div>
  );
}
);
