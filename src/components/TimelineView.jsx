// src/components/TimelineView.jsx
// Timeline (Gantt-style) view of the day's bookings — horizontal scrollable
// grid with one row per table, blocks rendered as positioned divs along a
// time axis (OPEN – GRID_CLOSE, i.e. 13:00 – 23:00). Tap a block to edit,
// tap the assign handle on a block to manually assign tables, long-press to
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
// sits `followLeadMins` from the left edge, and bumps zoom to `followZoom` if
// it's below that (both per-device Settings since v17.2.0; were 30 min / 4×).
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
  ROW_H, LABEL_W, STATUS_COLORS, BLOCK_BG, BLOCK_INK,
  S, TBL, BTN, TIMELINE_TABLES, R, M, T, FW } from "../lib/constants";
import { toMins, toTime, isLocked, isIn, pct, liveBarDur } from "../lib/booking-logic";
import { noShowMap, normalizePhone } from "../lib/customers";
import { mkBtn, Presence, Reveal, useFlip } from "./atoms";
// v17.9.0: OverlapIcon is a REUSE, not a near-duplicate — the block's ex-"!!"
// and the notification strip's Overlap section render the same `warnings` entry.
import { StarIcon, WaitIcon, LockIcon, NoShowIcon, DepositIcon, OverlapIcon, AssignIcon } from "./Icons";
import { QuickStatusPopup } from "./QuickStatusPopup";
import { hourLabelAt, isHourMark } from "../lib/time-grid";

// A block moves in two ways at once and they are NOT the same kind of motion:
// left/width is the schedule changing (geometry — M.shift), transform is the
// hover/group lift answering a pointer (M.tap). One shared constant because
// four call sites paint a block or its ghost and they must lift in lockstep —
// the :has() ghost rule in index.html depends on exactly that.
// (Below the imports: it worked above them only because imports hoist, which is
// the kind of thing that stops being true the day a circular import appears.)
const TL_MOVE = "left " + M.shift + ", width " + M.shift + ", transform " + M.tap;

// v17.9.0: the hour-pill look, once. Three places in this file paint a time on
// --tl-hour-pill — the ruler's hour labels, a block's start-time chip, and a
// waitlist ghost's — and the two chips were byte-identical copies. The v17.8.0
// decision they encode is that a time is the same object wherever it appears, so
// the chip deliberately matches the ruler above it; that intent only survives if
// the fill, ink, radius and type live in ONE place.
//
// Deliberately NOT in lib/time-grid.js: every user is in this file, and there is
// no reason to export a style across a module boundary that nothing else reads.
// The two block chips drop to FW.medium — see the note at the block chip for why
// they are quieter than the ruler's, and why that is weight and not opacity.
const HOUR_PILL = {
  padding: "2px 4px", borderRadius: R.pill,
  fontSize: T.micro, fontWeight: FW.semi,
  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
  background: "var(--tl-hour-pill)", color: "var(--text-on-accent)",
  boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
};

// ── The party-size ring (v17.9.0) ────────────────────────────────────────────
// Shared by TimelineBlock and WaitGhost, for the reason the ghost exists at all:
// it is a DIMMED copy of the block, so anything the block specifies twice can
// drift out from under it. HOUR_PILL above is here for the same reason.
//
// The border alpha is 0.55, not `--blk-rule`'s 0.3, and the measurement is worth
// recording because it sets the ceiling. A white rule at 0.3 over the block
// fills is 1.43:1 confirmed and **1.21:1 pending** — not "subtle", absent; the
// ring simply did not render on the yellow blocks. 0.55 takes that to 1.82 /
// 1.38 / 2.78 seated / 2.97 cancelled.
//
// It does NOT reach WCAG 1.4.11's 3:1 for a component boundary on the two amber
// fills, and it cannot: pure white over the pending yellow tops out at 1.98:1.
// This is the same wall the amber exemption in constants.js records, hit one
// element further down — and the same answer applies, because the two ways out
// are both worse. A dark ring clears 3:1 and reads as DISABLED next to the
// white-inked name it encircles (tried and reverted at block level for exactly
// this, one commit after it shipped). An opaque fill clears it and turns a count
// into a second status chip competing with the time. So: transparent ring, best
// achievable white, number recorded. The DIGIT inside is `--text-on-accent` at
// the name's own contrast, which is what has to be legible.
//
// A literal rather than a token because BLOCK_BG is theme-invariant — the same
// reason the block's own `1px solid rgba(255,255,255,0.2)` border is one.
const SIZE_RING = {
  flexShrink: 0, boxSizing: "border-box",
  width: 18, height: 18, borderRadius: R.pill,
  border: "1px solid rgba(255,255,255,0.55)", background: "transparent",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: T.micro, fontWeight: FW.semi, lineHeight: 1,
  fontVariantNumeric: "tabular-nums", position: "relative"
};

// ── How wide a block must be before it may wear a start-time chip (v17.9.0) ──
// Everything on a block except the name is flexShrink:0, so the name gets
// whatever is left. These are the measured widths of the fixed parts; the rule
// is "the name must still have NAME_MIN after all of them".
const CHIP_PX = 42;      // the start-time chip + its margin
const HANDLE_PX = 41;    // the assign handle (28 min-width + padding + rule)
const RING_PX = 24;      // the party-size ring + its margin (v17.9.0)
const FLAG_PX = 15;      // one 11px flag icon + its 4px margin (v17.9.0)
const NAME_MIN_PX = 55;  // ~6 characters and an ellipsis

function chipRoomFor(b, noShows, warn) {
  const flags = ((Number(b.deposit) || 0) > 0 ? 1 : 0)
    + ((b.preferredTables && b.preferredTables.length) ? 1 : 0)
    + (isLocked(b) ? 1 : 0)
    + (noShows >= 2 ? 1 : 0)
    + (warn && warn.overdue ? 1 : 0);
  return CHIP_PX + HANDLE_PX + RING_PX + NAME_MIN_PX + FLAG_PX * flags;
}

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
// v17.9.0: one wrapper for every marker on the block's right-hand flag rail.
// Module scope, per the inline-sub-component rule — a component declared inside
// TimelineBlock's body would be a new TYPE on every render and remount all four
// flags each time. `title` carries what the glyph cannot: the deposit's amount,
// the no-show count, which booking an overstay is blocking.
//
// /code-review fix: `role="img"` + `aria-label`, not `title` alone. These four
// flags used to be TEXT inside the label string ("[L]", the currency symbol,
// "!!"), so a screen reader read them out as part of the block. As bare SVGs
// they are `aria-hidden` (every icon in Icons.jsx is, correctly — an icon beside
// its own label must not be announced twice), and a plain `<span title>` with no
// role gets no reliable accessible name, so the information simply left the
// accessibility tree. These are the block's EXCEPTION states — locked against
// the optimizer, money taken, someone sitting in a table the next booking needs
// — i.e. exactly what this whole change argued was too important to let the
// ellipsis eat. Losing them to a screen reader instead is the same loss by
// another route. The label text already existed; only the attribute was missing.
function BlockFlag({ title, children }) {
  return (
    <span role="img" aria-label={title} title={title} style={{
      flexShrink: 0, marginLeft: 4, display: "flex", alignItems: "center",
      position: "relative"
    }}>{children}</span>
  );
}

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
  // v17.9.0 (second pass): the label carries the NAME and nothing else.
  //
  // It used to accumulate four flags — " [L]" locked, " [!]" repeat no-show,
  // " €" deposit, " !!" overstaying — and the v17.9.0 first pass defended them
  // as "ASCII, not glyphs, and deliberately part of the truncating label
  // string" while moving ★ out for the opposite reason. Both halves of that
  // defence were wrong in the same way the emoji argument had been:
  //
  //   • Truncating with the name was never correct FOR THESE. They are the
  //     exception state — locked means the optimizer must not move this party,
  //     !! means someone is sitting in a table the next booking needs — and the
  //     ellipsis ate them first, so the flags vanished on exactly the crowded
  //     day when they matter. That is the argument that moved ★ out; it applies
  //     here with more force, because a preferred table is a preference and an
  //     overstay is a problem.
  //   • "It is ASCII" is not a reason to look different from every other mark
  //     on the same 36px surface. `[L]` in brackets beside a drawn star and a
  //     drawn hourglass is the "not one medium" complaint in a plainer costume.
  //
  // The deposit marker was the worst of the four: it printed the CURRENCY
  // SYMBOL from settings/general, so the flag for "money has been taken" was a
  // different shape per restaurant setting. It is a coin now, and the amount —
  // which the symbol never showed anyway — is in the hover title.
  // …and then the label stopped being a string at all: `name + " (size)"` is
  // now a name span and a size ring, so nothing is concatenated here.
  const depositAmt = Number(b.deposit) || 0;
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
      {/* v17.8.0 correction (Patryk): the chip now matches the HOUR PILLS on the
          ruler above the grid — same --tl-hour-pill fill, same white text, same
          radius. It used to be a translucent white wash, which meant its
          appearance was a function of whatever block it happened to sit on: pale
          on amber, bright on green, and legible on neither at 10px. A time is a
          time wherever it appears, so it should look identical to the ruler that
          labels the same axis. This is also what lets the amber blocks keep
          white ink at 1.8:1 without the START TIME becoming unreadable — the
          chip carries its own opaque background and is not affected.
          v17.8.0 held this at `opacity: 0.8`, because at full strength an opaque
          slate pill on every block out-shouted the guest NAME beside it — the
          thing you actually read a block for. The goal was right; the mechanism
          was not, and v17.9.0 measured why.

          Opacity conflates QUIET with FAINT. Composited over each block fill it
          put the chip at 3.72–4.62:1 in every status and both themes — below AA
          in all ten cases, on the one piece of INFORMATION a block carries and
          the exact element the amber exemption in constants.js leans on. At full
          strength the same chip is 5.15–6.10:1, comfortably AA, with no token
          touched.

          And the diagnosis underneath: the chip was not too loud in absolute
          terms. It out-shouted the name because the NAME sits at 1.86–2.97:1 on
          the amber fills (the recorded exemption). Dimming the one legible
          element to match the illegible ones is levelling down.

          So the hierarchy is set by WEIGHT instead, which is what separates the
          two ideas: the chip drops to FW.medium against the name's FW.bold, so
          it recedes without going faint. Type weight is the app's own answer to
          this — it is the whole argument behind the v17.8.0 `T`/`FW` scale, that
          weight carries emphasis so size (or here, opacity) does not have to. */}
      <span style={{
        ...HOUR_PILL,
        flexShrink: 0, marginLeft: 6, lineHeight: "12px", fontWeight: FW.medium,
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
    try { el.setPointerCapture(pid); } catch { /* no-op */ }
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
        position: "absolute", inset: 0, borderRadius: 10, pointerEvents: "none",   /* @canvas */
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
  // v17.2.0: group hover-lift — a multi-table booking renders one cell per row;
  // toggle .mgt-group-hover (index.html, hover-capable media guard) on ALL cells
  // sharing this booking's data-bk so they lift together. DOM-class approach on
  // purpose: React state here would re-render the whole memoized timeline per
  // hover. Booking ids are path-safe ([0-9a-z] + the r…_date recurring shape) —
  // no selector escaping needed. mouseenter/leave don't fire on touch taps
  // (and the CSS is guarded anyway), so touch behaviour is unchanged.
  function setGroupHover(on) {
    document.querySelectorAll('[data-bk="' + b.id + '"]').forEach(function (el) {
      el.classList.toggle("mgt-group-hover", on);
    });
  }

  return (
    <div
      className="mgt-hover-scale mgt-blk"
      data-flip-id={flipId || undefined}
      data-bk={b.id}
      onMouseEnter={() => setGroupHover(true)}
      onMouseLeave={() => setGroupHover(false)}
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
        background: bgc, borderRadius: 10, overflow: "hidden",   /* @canvas */
        // v17.8.0: the block owns its ink; every text child inherits it via
        // currentColor. Every fill takes white today (see BLOCK_INK) — the
        // indirection is here because fill and ink are ONE decision, not
        // because the values currently differ.
        color: BLOCK_INK[b.status] || BLOCK_INK.confirmed,
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
        boxShadow: dragDy != null ? "0 10px 24px rgba(0,0,0,0.3)" : "0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)",   /* @fixed-fill: BLOCK_BG[b.status], ~40 lines up */
        // v17.0.0: while dragging, the inline transform/zIndex/opacity lift the
        // block and follow the pointer (inline transform beats the hover class).
        ...(dragDy != null ? { transform: "translateY(" + dragDy + "px)", zIndex: 30, opacity: 0.85 } : null),
        // v15.8.0: reposition eases (seated-shift / reshuffle). v15.8.1: `transform`
        // re-added so the .mgt-hover-scale lift eases again — the inline transition had
        // been overriding the class's `transform 120ms`, making the hover scale instant.
        // The seated ghost outline mirrors this exact transition so the two lift together.
        transition: dragDy != null ? "none" : TL_MOVE
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
      {/* ── v17.9.0 (Patryk): WHO on the left, WHAT ABOUT THEM on the right ────
          The block used to interleave the two: a ★ between the time and the
          name, the party size in brackets inside the name string, and the rest
          of the flags appended after it. So the one line you scan a grid of
          blocks for — the name — began at a position that depended on whether
          this particular party had preferred tables, and ended wherever its
          flags happened to stop.

          Now the left is identity and never varies (time · name · size) and
          everything else is a fixed-width rail on the right. The name is the
          only element that shrinks, which is the correct thing to lose. */}
      {timeChip}
      {/* Name + size as ONE `flex: 1` group, and the `1 1 0%` basis is
          load-bearing rather than shorthand convenience. With a `0 1 auto`
          basis the group's content counts toward the line's base size, which
          tips a narrow block into flexbox's SHRINK phase — and shrink is
          distributed across every item with a non-zero basis, so the start-time
          chip gets squeezed too. It rendered "19:0" on a 144px block. A zero
          basis keeps the line in the GROW phase: the group takes whatever is
          left over, the name ellipsises inside it, and nothing else is touched.
          (This is exactly what the old `flex: 1` name span did; the regression
          came from splitting it in two without carrying the basis over.)

          The group also pushes the flag rail right on its own, so there is no
          spacer element and no marginLeft:auto that would have to be moved onto
          whichever conditional flag happens to render first. */}
      <span style={{
        flex: "1 1 0%", minWidth: 0, paddingLeft: 6,
        display: "flex", alignItems: "center", position: "relative"
      }}>
        <span style={{
          minWidth: 0, fontSize: T.small, fontWeight: FW.bold,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
        }}>{b.name}</span>
        {/* The party size. It was "(6)" inside the name string, which put a pair
            of parentheses in the middle of the block's one bold text run and
            made the size the first thing the ellipsis took after the name. A
            ring is the same fact at a glance and it is flexShrink:0, so it
            survives. Transparent fill: it is a count, not a status, and a
            filled pill here would compete with the time chip. */}
        <span
          title={b.size + " guest" + (b.size === 1 ? "" : "s")}
          style={{ ...SIZE_RING, marginLeft: 6 }}
        >{b.size}</span>
      </span>
      {/* v17.9.0: the flag rail — the four markers that used to be appended to
          the label string, plus the ★ that was floating on the left. Order is
          Patryk's: deposit, preferred, then the exception flags, then the
          Assign handle. All flexShrink:0 — the name truncates, these survive. */}
      {depositAmt > 0 ? (
        <BlockFlag title={"Deposit " + currency + depositAmt}><DepositIcon size={11} /></BlockFlag>
      ) : null}
      {hasPrefT ? (
        <BlockFlag title={"Preferred tables: " + b.preferredTables.join(", ")}><StarIcon size={11} /></BlockFlag>
      ) : null}
      {isLocked(b) ? (
        <BlockFlag title="Locked to these tables — the optimizer will not move it"><LockIcon size={11} /></BlockFlag>
      ) : null}
      {noShows >= 2 ? (
        <BlockFlag title={noShows + " past no-shows on this number"}><NoShowIcon size={11} /></BlockFlag>
      ) : null}
      {warn && warn.overdue ? (
        <BlockFlag title={"Overstaying — " + warn.next + " needs this table at " + warn.nextTime}><OverlapIcon size={11} /></BlockFlag>
      ) : null}
      {/* v16.3.0: table-turn countdown pill — a seated block within ~15 min of
          its scheduled end shows "~Nm" (translucent, like the start-time chip).
          Flex item before the assign handle (no absolute overlap of the name); the
          seated block is near full width this late, so there's room. */}
      {freeMin != null ? (
        <span style={{
          flexShrink: 0, marginRight: 2, padding: "2px 4px", borderRadius: R.pill,
          fontSize: T.micro, fontWeight: FW.bold, lineHeight: "12px", fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap", position: "relative",
          background: "var(--blk-wash)",
          pointerEvents: "none"
        }}>{"~" + freeMin + "m"}</span>
      ) : null}
      {/* The manual-assign handle. v17.9.0: the ASCII "=" became the AssignIcon
          the Assign buttons in the form and the List card already use — the same
          action reached from three surfaces should not be a drawn icon in two of
          them and an equals sign in the third. The divider went 1px → 2px
          (Patryk): at 1px against `--blk-rule`'s 0.3 white it disappeared into
          the saturated fills, so the handle read as part of the flag rail rather
          than as a separate control. */}
      <span
        onClick={(e) => { e.stopPropagation(); onManual(b.id); }}
        title="Assign tables"
        style={{
          padding: "0 6px", cursor: "pointer", position: "relative",
          marginLeft: 4, flexShrink: 0,
          borderLeft: "2px solid var(--blk-rule)",
          height: "100%", display: "flex", alignItems: "center", justifyContent: "center", minWidth: 28
        }}
      >
        <AssignIcon size={13} />
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
        const isH = isHourMark(m);
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
      borderRadius: 4, opacity: 0.6,   /* @canvas */
      display: "flex", alignItems: "center", justifyContent: "center",
      pointerEvents: "none"
    }}>
      <span style={{ fontSize: T.micro, fontWeight: FW.bold, color: "var(--text-on-accent)", textTransform: "uppercase", letterSpacing: 1 }}>
        blocked
      </span>
    </div>
  );
}

// ── v17.8.0: waitlist ghost block (restyled v17.8.0) ─────────────────────────
// A preview of where a waiting party WOULD go, drawn on the table row that
// waitAvail picked for them.
//
// v17.8.0: it IS a pending block now — same geometry, radius, border, shadow,
// label typography and label GRAMMAR ("Name (size)") as TimelineBlock, in
// BLOCK_BG.pending because a waiting party is precisely awaiting a decision —
// and the whole element is simply turned down with `opacity`.
//
// The v17.8.0 version instead layered a 0.3-alpha fill under a full-strength
// label, and got two things wrong. The label had to pick its own colour, so it
// used `--text-secondary` — a token that INVERTS between themes, which is why
// the ghost's text visibly changed colour on a theme flip while every real
// block's `--text-on-accent` stayed put. And with its own font size, weight and
// separator it read as a different kind of object rather than a quieter version
// of the same one. Dimming the whole block fixes both at once: nothing has to
// choose a second set of values, so nothing can drift from the block it mirrors.
//
// The ⏳ follows the block's own marker convention — preferred, repeat no-show,
// locked, deposit and overstay are all drawn marks on the same block (v17.9.0
// moved the last four off the label string) — rather than inventing a badge
// that only the ghost uses.
//
// `resh` = the match only exists AFTER re-optimising (the reshuffling trialFits
// branch in App's waitAvail effect). Those tables can be visibly occupied right
// now, so it is dimmer still and takes a dashed edge in the block's own
// rgba-white border family: "there is room here, once the day is re-shuffled".
//
// Hoisted to module scope per CLAUDE.md's inline-sub-component rule (a component
// defined inside another's body is a new TYPE every render → full remount).
function WaitGhost({ g, totalMins, onBook }) {
  const gS = toMins(g.time);
  // Clamp to the grid's right edge, exactly as the turnaround tail does — an
  // absolutely-positioned child past GRID_CLOSE still counts toward the
  // scroller's scrollWidth and would add empty scroll that grows with zoom.
  const gE = Math.min(gS + g.dur, GRID_CLOSE * 60);
  const mins = gE - gS;
  if (mins <= 0) return null;
  // v17.8.0 correction: group hover-lift, TimelineBlock's mechanism verbatim.
  // A ghost for a party that needs two tables renders one cell per row exactly
  // as a real multi-table booking does, so hovering one cell has to lift both —
  // otherwise the ghost breaks the very block behaviour it is a quiet copy of.
  // Own attribute rather than data-bk: a waitlist id and a booking id come from
  // the same genId(), and one shared namespace is one collision away from a
  // ghost lifting an unrelated booking.
  function setGroupHover(on) {
    document.querySelectorAll('[data-wg="' + g.id + '"]').forEach(function (el) {
      el.classList.toggle("mgt-group-hover", on);
    });
  }

  return (
    <div
      // mgt-appear: a ghost is a SUGGESTION that comes and goes as the day's
      // availability shifts — a party joins the waitlist, a table completes, the
      // clock crosses a quarter — so it should arrive rather than blink into
      // existence next to blocks that never move on their own. Deliberately
      // asymmetric: there is no matching fade-out, because a ghost disappears
      // when a REAL booking takes that table, and the eye should be on the block
      // that just appeared, not on the proposal it replaced.
      className="mgt-hover-scale mgt-appear mgt-blk"
      data-wg={g.id}
      onMouseEnter={() => setGroupHover(true)}
      onMouseLeave={() => setGroupHover(false)}
      onClick={() => onBook(g.id)}
      title={"Waiting: " + g.name + " (" + g.size + ") at " + g.time
        + (g.resh ? " — fits after re-optimising" : "") + ". Tap to book."}
      style={{
        // Geometry, radius, border, shadow: TimelineBlock's, verbatim.
        position: "absolute", top: 3, height: (ROW_H - 8) + "px",
        left: pct(gS), width: Math.max((mins / totalMins) * 100, 0.3) + "%",
        background: BLOCK_BG.pending, borderRadius: 10, overflow: "hidden",   /* @canvas */
        // Dims the real block, does not re-specify it — so it takes the pending
        // fill's ink too, or the v17.8.0 contrast pass would have fixed the
        // block and left its own ghost white-on-yellow.
        color: BLOCK_INK.pending,
        display: "flex", alignItems: "center", boxSizing: "border-box",
        border: g.resh ? "1px dashed rgba(255,255,255,0.55)" : "1px solid rgba(255,255,255,0.2)",
        boxShadow: "0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)",
        cursor: "pointer",
        // The one deliberate difference from a real block. A reshuffle-only match
        // is turned down further because it can sit over a table that is visibly
        // occupied right now.
        opacity: g.resh ? 0.4 : 0.55,
        transition: TL_MOVE
      }}
    >
      {/* The start-time chip, in TimelineBlock's exact chip style. A real block
          shows it only when the whole day's blocks are wide enough (the
          all-or-nothing `chipsOn` rule); a ghost always does, because the time
          is the entire proposal — a ghost without one says nothing useful. */}
      <span style={{
        ...HOUR_PILL,
        flexShrink: 0, marginLeft: 6, lineHeight: "12px", fontWeight: FW.medium
      }}>{g.time}</span>
      {/* v17.8.0 correction: the ⏳ sits BETWEEN the time and the name, not
          trailing it. Trailing, it was the first thing the ellipsis ate — the
          marker that says "this is a proposal, not a booking" vanished on
          exactly the narrow blocks where the dimming is hardest to read. Here
          it is fixed-width and unclippable, and it lines up with the marker
          column a real block uses for its preferred-tables star. */}
      <span aria-hidden="true" style={{
        flexShrink: 0, marginLeft: 6, display: "flex", alignItems: "center"
      }}><WaitIcon size={11} /></span>
      {/* v17.9.0: the name span and the size ring, TimelineBlock's verbatim —
          when the block stopped concatenating "(size)" into its label, the
          ghost had to stop too, or the "dims X, does not re-specify X" rule
          this component is built on would have lasted exactly one version. */}
      <span style={{
        flex: "1 1 0%", minWidth: 0, paddingLeft: 4, paddingRight: 8,
        display: "flex", alignItems: "center", position: "relative"
      }}>
        <span style={{
          minWidth: 0, fontSize: T.small, fontWeight: FW.bold,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
        }}>{g.name}</span>
        <span style={{ ...SIZE_RING, marginLeft: 6 }}>{g.size}</span>
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
  // v17.2.0: per-device Timeline settings (App's tlSettings — scalars, memo-safe).
  followZoom = 4,      // zoom the Follow button jumps to (was hard-coded 4)
  followLeadMins = 30, // minutes of past shown behind the now-line while Following
  maxZoom = 5,         // the + button's ceiling (was hard-coded 5)
  followNow, setFollowNow,
  scrollPosRef,
  autoOptimizer = true,
  setAutoOptimizer = () => {},
  currency = "€", // v17.0.0: settings/general deposit marker
  onDropOnTable = null, // v17.0.0 correction: drag&drop move/swap handler (App)
  onReshuffle = () => {},
  // v17.6.0: separation between bookings, in minutes (0 = feature off). A SCALAR
  // from App rather than the TURN_BUFFER live binding, because React.memo cannot
  // see a live binding — the same reason hoursSig/layoutSig exist.
  turnBuffer = 0,
  // v17.8.0: waitlist ghost blocks — one entry per waiting party the viewed day
  // currently has room for, [{id,name,size,time,dur,tables,resh}]. Computed and
  // MEMOISED in App (an inline array literal would defeat this component's
  // React.memo on every BookingApp render), scoped there to the viewed date.
  waitGhosts = [],
  onBookWait = () => {},
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
      const targetMins = Math.max(OPEN * 60, nowMins - followLeadMins);
      const fraction = (targetMins - OPEN * 60) / totalMins;
      centerNow(fraction);
      if (scrollPosRef) scrollPosRef.current = fraction * gridW;
    } else if (scrollPosRef && scrollPosRef.current > 0) {
      scrollRef.current.scrollLeft = scrollPosRef.current;
    }
    return () => cancelAnimationFrame(followRafRef.current);
  }, [followNow, isToday, nowMins, gridW, followLeadMins]);

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
  // keeps ≥~55px after the chip (~42px) and the fixed assign handle
  // (~41px), i.e. ≥140px. A per-block decision left a mixed grid, which read
  // messy in live QA; and scoping the every() to confirmed blocks means a
  // status change (seated/completed durations shrink/stretch) can never kill
  // the other bookings' chips (the reported bug). Each flip animates per block
  // via Presence.
  // v17.0.0: pending joins the chip family (treated same as confirmed).
  //
  // v17.9.0: the "140" above is gone, because the fixed cost it stood for is no
  // longer one number. The block's right-hand rail gained a size ring (always
  // present) and one marker per ACTIVE flag, every one of them flexShrink:0 —
  // so the room left for the name now depends on how flagged the booking is.
  // With the flat threshold, a 150px block carrying a deposit and a preferred
  // star kept its chip and rendered the guest name at literally zero width:
  // "18:30 ⑥ ⊙ ★ ▦", no name at all. That is worse than the crowding the chip
  // rule exists to prevent — the name is the thing you read a block FOR, and
  // dropping the chip gives 42px straight back to it.
  //
  // Same all-or-nothing shape as before (one mixed grid read messy in live QA);
  // the per-block part is only what each block needs, and the worst one decides.
  const confirmedDay = day.filter((b) => b.status === "confirmed" || b.status === "pending");
  const chipsOn = confirmedDay.length > 0 && confirmedDay.every(function (b) {
    return liveBarDur(b, nowMins) * pxPerMin >= chipRoomFor(b, nsMap[normalizePhone(b.phone)] || 0, warnings[b.id]);
  });

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
    const isH = isHourMark(m);
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
    .filter((m) => isHourMark(m) && m < GRID_CLOSE * 60)
    .map((m) => {
      const center = ((m + 30 - OPEN * 60) / totalMins) * 100;
      return (
        <span
          key={"h" + m}
          style={{
            ...HOUR_PILL,
            position: "absolute", top: 3, left: center + "%", transform: "translateX(-50%)",
            pointerEvents: "none", zIndex: 1
          }}
        >
          {hourLabelAt(m)}
        </span>
      );
    });

  // ── Labels column (left) — sticky table IDs + optional "unassigned" row ──
  const labelCol = (
    // v14.3.1 (Fix 3): paddingTop mirrors the grid scroller's padding so the
    // 24px header + ROW_H rows line up with the grid column after the pad.
    <div style={{ width: LABEL_W + "px", flexShrink: 0, paddingTop: 8 }}>
      <div style={{
        height: 24,   /* @canvas */ background: "var(--tl-header-strip)",
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
              fontSize: T.small, fontWeight: FW.semi, padding: "2px 0", borderRadius: R.pill,
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
          <span style={{ fontSize: T.micro, fontWeight: FW.semi, color: "var(--danger-text)" }}>
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
        {/* v17.8.0: waitlist ghosts — rendered BEFORE the real blocks so a live
            booking always paints on top of a preview. */}
        {waitGhosts.map((g) =>
          (g.tables || []).includes(id)
            ? <WaitGhost key={"wg" + g.id + id} g={g} totalMins={totalMins} onBook={onBookWait} />
            : null
        )}
        {/* v15.8.1: render each seated booking's dashed "ghost" (original-duration
            outline) IMMEDIATELY BEFORE its block, so the ghost mirrors EVERY cell
            effect: (1) reposition — same left/width + transform transition; (2) vertical
            reassign — FLIP on the PRIMARY cell only (distinct `__ghost` id namespace so
            it never collides with the block's data-flip-id={b.id}); (3) hover-lift — the
            ghost paints under its block but, being its immediate preceding sibling, is
            scaled by the `.mgt-tlghost:has(+ .mgt-hover-scale:hover)` rule (index.html)
            so it lifts in lockstep with the block. */}
        {rows.map((b) => {
          // v17.6.0: the turnaround tail — the table is held for `turnBuffer`
          // minutes after the party's end, so the separation is visible rather
          // than just being an invisible refusal when you try to book. Rendered
          // as its OWN low-opacity sibling instead of lengthening the block:
          // the block's width comes from liveBarDur, which also gates the
          // start-time chips and is read by List, so growing it would move
          // unrelated behaviour. Completed bookings get no tail — a completed
          // visit's table reads as free everywhere else in the app.
          let tail = null;
          if (turnBuffer > 0 && b.status !== "completed") {
            // /code-review: clamp the tail to the grid's right edge. A booking
            // that ends at (or past) GRID_CLOSE would otherwise place its tail
            // entirely OUTSIDE the grid — an absolutely-positioned child still
            // counts toward the scroller's scrollWidth, so it added a strip of
            // empty scroll past the end of the day that grew with zoom.
            const tStart = toMins(b.time) + liveBarDur(b, nowMins);
            const tEnd = Math.min(tStart + turnBuffer, GRID_CLOSE * 60);
            const tMins = tEnd - tStart;
            tail = tMins <= 0 ? null : (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute", top: 3, height: (ROW_H - 8) + "px",
                  left: pct(tStart),
                  width: Math.max((tMins / totalMins) * 100, 0.3) + "%",
                  background: BLOCK_BG[b.status] || BLOCK_BG.confirmed,
                  opacity: 0.28,
                  borderRadius: "0 10px 10px 0",
                  boxSizing: "border-box", pointerEvents: "none",
                  transition: "left " + M.shift + ", width " + M.shift
                }}
              />
            );
          }
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
                  background: "transparent", borderRadius: 10,   /* @canvas */
                  border: "2px dashed " + BLOCK_BG.seated,
                  boxSizing: "border-box", pointerEvents: "none",
                  transition: TL_MOVE
                }}
              />
            );
          }
          return (
            <Fragment key={b.id}>
              {tail}
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
        fontSize: T.micro, fontWeight: FW.semi, color: "var(--text-on-accent)",
        background: "var(--tl-now-pill)",
        padding: "2px 4px", borderRadius: R.pill, whiteSpace: "nowrap", zIndex: 11,
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
      <div ref={flipRef} style={{ width: gridW + "px", minWidth: "100%", position: "relative", transition: "width " + M.shift }}>
        <div style={{
          position: "relative",
          borderBottom: "2px solid var(--tl-header-border)",
          background: "var(--tl-header-strip)",
          borderRadius: "0 6px 0 0",
          height: 24,   /* @canvas */ overflow: "visible", boxSizing: "border-box"
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
          if (zoom < followZoom) setZoom(followZoom);
        } else {
          setFollowNow(false);
        }
      }}
      className="mgt-hover-scale mgt-press"
      style={mkBtn({
        minHeight: 36, padding: "4px 10px", fontSize: T.small,
        // v17.8.0: the idle fill was a hard-coded copy of --app-btn-grey's old
        // value, so the contrast pass fixed every other secondary button and
        // left this one at 1.82:1 — the lowest on the screen, on the control
        // that follows the clock during service. A literal duplicate of a token
        // is a token that cannot be fixed.
        background: followNow ? "rgba(0,0,0,0.6)" : "var(--app-btn-grey)"
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
        style={mkBtn({ minHeight: 36, minWidth: 36, padding: "4px 10px", fontSize: T.title, background: BTN.nav })}
      >
        -
      </button>
      {/* v17.2.0 follow-up: the reset label grows "1x" → "Nx → 1x" when zoomed —
          the widening used to SNAP and shove the whole toolbar group sideways.
          The "Nx → " prefix now rides a horizontal Reveal (the start-time-chip
          pattern) so the button width eases in/out instead of jumping. The
          constant "1x" tail keeps the button's identity while collapsed. */}
      <button
        onClick={() => { setZoom(1); setFollowNow(false); }}
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 36, padding: "4px 10px", fontSize: T.small, background: zoom === 1 ? "var(--btn-default)" : BTN.nav, display: "inline-flex", alignItems: "center", justifyContent: "center" })}
      >
        {/* NB the child must be NULL (not an empty span) at 1× — Reveal caches its
            last truthy children for the exit ease; an always-mounted span would
            overwrite that cache with empty text and the collapse would animate a
            blank box (the text snapping away instead of easing out). */}
        <Reveal horizontal show={zoom !== 1}>
          {zoom !== 1 ? <span style={{ whiteSpace: "pre" }}>{zoom + "x → "}</span> : null}
        </Reveal>
        1x
      </button>
      <button
        onClick={() => setZoom((z) => Math.min(maxZoom, z + 0.5))}
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 36, minWidth: 36, padding: "4px 10px", fontSize: T.title, background: BTN.nav })}
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
          minHeight: 36, padding: "4px 12px", fontSize: T.small,
          // v17.8.0 review fix: the OFF fill was the SAME hard-coded grey the
          // Follow button above was just cured of, in the same commit, eight
          // lines apart — 1.94:1 white-on-grey in light mode. Fixing one copy of
          // a literal does not fix the literal; grep the VALUE.
          background: autoOptimizer ? "var(--app-walkin)" : "var(--app-btn-grey)"
        })}
      >
        {"Optimizer: " + (autoOptimizer ? "ON" : "OFF")}
      </button>
      {/* v15.8.0: slides in L→R when Optimizer is toggled OFF, slides out →L when ON. */}
      <Presence show={!autoOptimizer} inClass="mgt-slide-in" outClass="mgt-slide-out" outMs={190} tag="span">
        <button
          onClick={onReshuffle}
          className="mgt-hover-scale"
          style={mkBtn({ minHeight: 36, padding: "4px 12px", fontSize: T.small, background: BTN.orange })}
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
          fontSize: T.small, padding: "2px 8px", borderRadius: R.pill,
          background: BLOCK_BG[s] || "#999",
          color: BLOCK_INK[s] || "var(--text-on-accent)",
          border: "1px solid rgba(255,255,255,0.2)",
          fontWeight: FW.semi, textTransform: "capitalize",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
        }}
      >
        {s}
      </span>
    );
  });
  legendEls.push(
    <span key="in" style={{ fontSize: T.small, padding: "2px 8px", borderRadius: R.pill, background: TBL.ind.bg, color: "var(--text-on-accent)", border: "1px solid rgba(255,255,255,0.2)", fontWeight: FW.semi }}>
      indoor
    </span>
  );
  legendEls.push(
    <span key="out" style={{ fontSize: T.small, padding: "2px 8px", borderRadius: R.pill, background: TBL.out.bg, color: "var(--text-on-accent)", border: "1px solid rgba(255,255,255,0.2)", fontWeight: FW.semi }}>
      outdoor
    </span>
  );
  legendEls.push(
    <span key="blocked" style={{ fontSize: T.small, padding: "2px 8px", borderRadius: R.pill, background: "var(--tl-blocked-badge)", color: "var(--text-on-accent)", border: "1px solid rgba(255,255,255,0.2)", fontWeight: FW.semi }}>
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
      borderRadius: R.sheet,
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
      {/* v17.8.0: the "Closed this day" notice that used to sit here moved to
          NotificationStrip. It was a day-level fact drawn per-view — here and,
          differently worded, in PlanView — while List had none. One section now
          says it once, above whichever view is showing. */}
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
        {/* v17.0.0 round 8: the 🔍/⚙ pair moved OUT of this legend, first to
            App's date-nav row and (v17.9.0) up into App's header, so it sits in
            one place for all three views. */}
      </div>
      {/* v17.9.0: this line said "= assign" and described a glyph that no longer
          exists — the block's handle is AssignIcon now. Exactly the trap
          CLAUDE.md records from the first icon pass ("update the COPY with the
          glyphs"), caught by a rendered-text sweep rather than by reading the
          diff, because nothing about the handle's change touches this file's
          hint string. It shows the icon inline instead of naming a character, so
          the two cannot come apart again. */}
      <div style={{ marginTop: 6, fontSize: T.small, color: S.muted, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <span>tap booking to edit</span>
        <span aria-hidden="true">·</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><AssignIcon size={12} />assign</span>
        <span aria-hidden="true">·</span>
        <span>hold to change status</span>
        <span aria-hidden="true">·</span>
        <span>tap table label to block</span>
      </div>
      {quickPopup}
    </div>
  );
}
);
