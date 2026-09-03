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

import { useState, useRef, useEffect, useLayoutEffect, useMemo, memo, Fragment } from "react";
import {
  OPEN, GRID_CLOSE, QUARTER_HOURS,
  ROW_H, LABEL_W, STATUS_COLORS, BLOCK_BG, BLOCK_INK,
  S, TBL, BTN, TIMELINE_TABLES, R, M, T, FW, IC, RIM_SOLID } from "../lib/constants";
import { toMins, toTime, isLocked, isIn, pct, liveBarDur, describeBooking, isReadableBlock } from "../lib/booking-logic";
import { noShowMap, identityKey } from "../lib/customers";
import { mkBtn, Presence, Reveal, useFlip, SizeRing } from "./atoms";
import { useRevealRows } from "../hooks/useRevealRows";
// v17.9.0: OverlapIcon is a REUSE, not a near-duplicate — the block's ex-"!!"
// and the notification strip's Overlap section render the same `warnings` entry.
import { StarIcon, WaitIcon, LockIcon, NoShowIcon, DepositIcon, OverlapIcon, ClashIcon, AssignIcon, StatusIcon } from "./Icons";
import { QuickStatusPopup } from "./QuickStatusPopup";
import { beginHold } from "../lib/holdSelection";
import { EmptyDay } from "./EmptyDay";
import { hourLabelAt, isHourMark } from "../lib/time-grid";
import { visibleRail } from "../lib/block-layout";

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
  boxShadow: "var(--shadow-flat)"
};

// ── The party-size ring (v17.9.0) ────────────────────────────────────────────
// v17.15.5: `SIZE_RING` moved to atoms.jsx as the `SizeRing` component — the
// List card is now a third consumer, and a style object imported from one view
// into another is not sharing, it is coupling. The recorded 0.55 white rim, and
// the measurements behind it, travelled with it; the block and the ghost pass
// no `rim` and are unchanged.


// ── How wide a block must be before it may wear a start-time chip (v17.9.0) ──
// Everything on a block except the name is flexShrink:0, so the name gets
// whatever is left. These are the measured widths of the fixed parts; the rule
// is "the name must still have NAME_MIN after all of them".
const CHIP_PX = 42;      // the start-time chip + its margin
const HANDLE_PX = 41;    // the assign handle (28 min-width + padding + rule)
const RING_PX = 24;      // the party-size ring + its margin (v17.9.0)
const FLAG_PX = 18;      // one IC.control (14px) flag icon + its 4px margin (v17.9.1)
const FREE_PX = 36;      // the "~Nm" table-turn pill + its margin (v17.9.1)
const CLASH_PX = 18;     // the double-booked marker + its margin (v17.11.0)
const STATUS_PX = 18;    // the status mark + its margin (v17.11.0) — on EVERY block
const NAME_MIN_PX = 55;  // ~6 characters and an ellipsis

function chipRoomFor(b, noShows, warn, clash) {
  const flags = ((Number(b.deposit) || 0) > 0 ? 1 : 0)
    + ((b.preferredTables && b.preferredTables.length) ? 1 : 0)
    + (isLocked(b) ? 1 : 0)
    + (noShows >= 2 ? 1 : 0)
    + (warn && warn.overdue ? 1 : 0);
  return CHIP_PX + HANDLE_PX + RING_PX + NAME_MIN_PX + STATUS_PX + (clash ? CLASH_PX : 0) + FLAG_PX * flags;
}

// v17.9.1: what a block can afford to show at its current width is decided by
// `visibleRail` (src/lib/block-layout.js) — a priority ladder, extracted so it
// is reachable by a test. The five measured widths above are what this file
// feeds it; the ladder itself, and the reasoning for its order, live there.
//
// One consequence worth stating where the render is: this produces a MIXED grid
// by design — two blocks side by side can carry different numbers of markers —
// which is the opposite of the all-or-nothing rule `chipsOn` follows two hundred
// lines down. Both are right. The chip rule exists so the DAY reads
// consistently; this one exists so an individual block stays legible; and where
// they disagree, the block wins, because an unreadable block is not consistent
// with anything.

// v15.8.0: module-level status-change animation state (survives the inline Block
// remount + any TimelineView remount during the save flow). Single timeline, so
// module scope is safe; entries are keyed by booking id and expire by timestamp.
let __prevStatus = null;
const __statusAnims = {};

// v17.11.0: the word for each status, for the status mark's accessible name and
// hover title. It is the LIST CARD's vocabulary, not a new one — the badge there
// has always said "Seated" / "Confirmed", and the whole point of putting a mark
// on the block is that the two views stop describing one attribute two ways.
// `cancelled` is here for completeness; the timeline filters those out.
const STATUS_LABEL = {
  pending: "Pending — awaiting confirmation",
  confirmed: "Confirmed",
  seated: "Seated",
  completed: "Completed",
  cancelled: "Cancelled",
};

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

function TimelineBlock({ b, anim, flipId, nowMins, today, totalMins, warnings, clash = null, late = null, noShows = 0, showChip = false, freeMin = null, currency = "€", pxPerMin = 1, onEdit, onManual, setQuickStatus, homeTable = null, tableAtY = null, setDragHover = null, onDropOnTable = null }) {
  const d = liveBarDur(b, nowMins, today);
  const sm = toMins(b.time) - OPEN * 60;
  const left = pct(OPEN * 60 + sm);
  const w = Math.max((d / totalMins) * 100, 0.5) + "%";
  const warn = warnings[b.id];
  const bgc = BLOCK_BG[b.status] || BLOCK_BG.confirmed;
  // v16.1.0: running-late amber border (confirmed booking past its time — the
  // `late` prop is "warn"/"noshow" from App's lateMap). Seated-overstay
  // warnings keep precedence (they carry the more urgent red tier).
  // v17.11.0: a DOUBLE-BOOKING outranks both. It is not a prediction like the
  // overstay warning or the late timer — it is the schedule already being
  // wrong, and one of these two parties is going to be turned away.
  //
  // It reuses the overstay's danger red rather than introducing a sixth block
  // border colour. The two are told apart by the things that carry the meaning:
  // the ClashIcon on the rail, and the hatched band drawn across the minutes
  // both bookings claim. Adding a red-adjacent hue here would have made the
  // border the distinguishing signal, which is the colour-only-status mistake
  // this release exists to fix.
  const border = clash
    ? "3px solid var(--tl-block-warn)"
    : warn
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
  // different shape per restaurant setting. It is a banknote now (v17.9.1 —
  // v17.9.0's coin read as a target at 11px), and the amount — which the symbol
  // never showed anyway — is in the hover title.
  // …and then the label stopped being a string at all: `name + " (size)"` is
  // now a name span and a size ring, so nothing is concatenated here.
  const depositAmt = Number(b.deposit) || 0;
  // v17.9.1: the rail's flags as DATA, so "how many fit" and "which ones
  // survive" are two questions with two separate answers.
  //
  // TWO ORDERS, ONE LIST. The ARRAY order is the RAIL order — unchanged from
  // v17.9.0, so a block wide enough for everything looks exactly as it did.
  // `keep` is the DROP priority (lowest survives longest); see block-layout.js.
  // They are one literal on purpose: held apart, they drift.
  const allFlags = [
    depositAmt > 0
      ? { k: "dep", keep: 5, title: "Deposit " + currency + depositAmt, icon: <DepositIcon size={IC.control} /> } : null,
    hasPrefT
      ? { k: "pref", keep: 4, title: "Preferred tables: " + b.preferredTables.join(", "), icon: <StarIcon size={IC.control} /> } : null,
    isLocked(b)
      ? { k: "lock", keep: 3, title: "Locked to these tables — the optimiser will not move it", icon: <LockIcon size={IC.control} /> } : null,
    noShows >= 2
      ? { k: "ns", keep: 2, title: noShows + " past no-shows on this number", icon: <NoShowIcon size={IC.control} /> } : null,
    warn && warn.overdue
      ? { k: "over", keep: 1, title: "Overstaying — " + warn.next + " needs this table at " + warn.nextTime, icon: <OverlapIcon size={IC.control} /> } : null
  ].filter(Boolean);
  // v17.9.1 review fix: the freeing-soon pill is part of the FIXED cost when it
  // is showing. It is `flexShrink: 0` like everything else on the rail, and the
  // comment at its render site — "the seated block is near full width this late,
  // so there's room" — only holds at the DEFAULT 15-minute window. `freeSoonWindow`
  // goes to 60, and `freeingSoon` shows the pill whenever `end - now <= window`,
  // so on a 60-minute booking with a 60-minute window it is on screen from the
  // first minute of the visit, when a seated block is a few pixels wide. Leaving
  // it out reproduced the exact pile-up this budget exists to prevent.
  // v17.11.0: the clash marker is part of the FIXED cost, not a rail flag, so
  // it can never be dropped. The ladder in block-layout.js sheds informational
  // flags first and exception flags last, and a double-booking is not on that
  // scale at all: it is the one marker that says this booking's table is
  // already promised to somebody else. A seated block starts a few pixels wide
  // and grows, so anything droppable is invisible for the first stretch of
  // every visit — which for this marker would mean it disappears exactly while
  // a host is deciding where to put the party who just walked in.
  const { showRing, flags: railFlags } = visibleRail(
    d * pxPerMin,
    HANDLE_PX + NAME_MIN_PX + (showChip ? CHIP_PX : 0) + (freeMin != null ? FREE_PX : 0)
      + STATUS_PX + (clash ? CLASH_PX : 0),
    RING_PX, FLAG_PX, allFlags
  );
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
    // v17.16.12: the click-suppression flag is re-armed HERE — on the one event
    // every input path fires, and ABOVE the early returns. It was set in
    // `beginDrag` and cleared ONLY in `onTouchStart`, so a MOUSE drag set it and
    // nothing ever put it back: `handleClick` then returned early for the whole
    // life of the component instance, and the block sat there looking perfectly
    // normal while refusing to open the edit form until a page refresh. Reached
    // by every drag that leaves the block mounted — a refused drop, a drop back
    // on its own row, or a swap that keeps one of the booking's tables.
    // The ordering is pointerdown → move → beginDrag(true) → pointerup → click,
    // so the click that ENDS a drag is still suppressed; only the next press
    // starts clean. (`onTouchStart` keeps its own reset — both write `false`,
    // so the two cannot disagree, and touch has a second entry point in the
    // 400ms press timer.)
    didLong.current = false;
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
    // v17.16.12: TEAR DOWN FIRST, DISPATCH LAST — and the order is the fix.
    // `onDropOnTable` reaches App's `dropOnTable`, which walks up to 8 candidate
    // table sets running a full `bookingsAfterAction` trial on each; a throw
    // anywhere in there is a throw inside a React EVENT HANDLER, which no error
    // boundary catches (CLAUDE.md's Gotchas). With the dispatch sitting ABOVE
    // these two setStates, one such throw skipped both and left `dragDy`
    // non-null for good: the block kept its `translateY`, `zIndex: 30`, 0.85
    // opacity and drag shadow AND kept `didLong` true — misdrawn and unclickable
    // at once, from one cause, curable only by a page refresh. Clearing first
    // makes the block's resting state independent of whether the drop succeeds.
    // The target is READ before the clear (it measures live row geometry, which
    // the pending setState has not touched yet) and USED after it.
    const target = d && d.active && commit ? tableAtY(e.clientY) : null;
    setDragDy(null);
    if (setDragHover) setDragHover(null);
    if (target && target !== homeTable) {
      // Swallowed deliberately, and only here: the teardown above has already
      // run, so the block recovers either way, and an uncaught handler error
      // would be just as silent in production while risking the batch these
      // setStates are in. The console line is what makes it findable.
      try { onDropOnTable(b.id, target); }
      catch (err) { console.error("[drag] drop on " + target + " failed", err); }
    }
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
    // v17.16.12: nothing in the document is selectable for the duration of this
    // hold — see lib/holdSelection for why the at-rest `user-select` rule on
    // controls could not be enough. Self-terminating on release, so there is no
    // matching call here or on any of the four other paths out of a hold.
    beginHold();
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

  // v17.12.0: what the block SAYS. Unlike the List card this is a leaf control
  // — its flags are decorative spans, not buttons — so `role="button"` is both
  // correct and safe here, and ARIA's children-presentational rule costs
  // nothing because every mark's meaning is folded into this string instead.
  //
  // It carries the two states v17.11.0 made visible, since they are the whole
  // reason a host looks at this block twice: a clash means two parties are
  // already promised one table, and late is the prediction that leads to one.
  // /code-review: the identity half comes from `describeBooking` — the one
  // source ListView's card and PlanView's table read too. Only the STATE
  // clauses are local, and correctly so: they describe how this block is being
  // drawn right now, not what the booking is.
  const a11yLabel =
    describeBooking(b) +
    (clash ? ", double-booked" : "") +
    (warn ? ", overstaying" : "") +
    (late === "warn" ? ", running late" : late === "noshow" ? ", not arrived" : "");

  return (
    <div
      className="mgt-hover-scale mgt-blk"
      data-flip-id={flipId || undefined}
      data-bk={b.id}
      /* v17.12.0 fix: focusable by KEYBOARD, not by pointer. The browser
         focuses on mousedown and focusing scrolls the element into view — and
         this scroller is the TIMELINE, so the measured jump was 1000–2000px
         SIDEWAYS on a single click. `preventDefault` here suppresses only the
         focus; it does not cancel the click and does not touch pointer events,
         so the 6px drag threshold and the touch hold are untouched (both are
         armed on `pointerdown`, which has already fired). Tab still focuses. */
      onMouseDown={(e) => { e.preventDefault(); }}
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
      /* v17.16.12: the third way a drag can end — belt-and-braces for capture
         lost while this element STAYS MOUNTED, which is the only case it can
         actually help with. /code-review corrected the first version of this
         comment, which justified itself with a mid-drag re-parent (a reshuffle
         moving the booking to another row): that case needs no net and this
         handler could not provide one anyway. React unmounts the Fragment in
         the old row, so `dragDy` is destroyed with the component and nothing
         can strand — and the node is detached before `lostpointercapture`
         fires, where React's root-container listener does not see it. Kept
         because it costs nothing and the teardown is idempotent: on the normal
         path it fires AFTER `pointerup`, by which point `dragRef` is null, so
         it re-clears already-cleared state and commits nothing. */
      onLostPointerCapture={(e) => endDrag(e, false)}
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
        border: border || RIM_SOLID,
        WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
        // v17.0.0 round 7 (Android fix): without this, the browser claims any
        // vertical touch movement on a block for page scroll and fires
        // pointercancel BEFORE the 800ms drag-hold arms — drag never started on
        // MagicOS/Chrome. pan-x keeps horizontal timeline scrolling from a block
        // while reserving vertical gestures for the drag.
        touchAction: "pan-x",
        // v17.10.1: the resting shadow is --shadow-btn-solid (raised, on a
        // theme-invariant BLOCK_BG fill — exactly what that token is for), so
        // the old /* @fixed-fill */ marker is gone with the white-inset literal
        // it was blessing. The DRAG shadow stays a literal: a block lifted under
        // a finger is a one-off depth, not a member of the scale.
        boxShadow: dragDy != null ? "0 10px 24px rgba(0,0,0,0.3)" /* @shadow */ : "var(--shadow-btn-solid)",
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
            borderTop: "14px solid rgba(255,255,255,0.95)",  /* @fixed-fill */
            borderRight: "14px solid transparent",
            pointerEvents: "none"
          }} />
          <svg viewBox="0 0 24 24" width="8" height="8" style={{
            position: "absolute", top: "0.5px", left: "0.5px", pointerEvents: "none"
          }}>
            <path
              d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
              fill={"#1f2937" /* @fixed-fill */}
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
      {/* v17.12.0 (/code-review): `role="button"` lives HERE, on everything
          except the assign handle — not on the block itself.
          ARIA makes a button's children PRESENTATIONAL, and this block CONTAINS
          a control: the manual-assign handle below. Putting the role on the
          outer element hid that control from assistive technology, which is the
          precise rule this same version wrote into CLAUDE.md after refusing to
          make the List card a button for the identical reason. The first pass
          justified it with "its flags are decorative spans, not buttons" — true
          of the flags, false of the handle four elements further down.
          Splitting it costs nothing in layout: this wrapper takes the same
          `1 1 0%` the name group used to take against the handle, and the name
          group keeps that basis inside it, so the grow/shrink distribution is
          arithmetically what it was. The absolutely-positioned children (the
          status overlay, the note dog-ear) stay OUTSIDE it — they are painted
          against the block's own box and have nothing to do with its name.
          Enter and Space go through `handleClick`, so they inherit its
          `didLong` guard and cannot fire the edit form on the tail of a
          press-and-hold. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={a11yLabel}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          handleClick();
        }}
        style={{ flex: "1 1 0%", minWidth: 0, height: "100%", display: "flex", alignItems: "center" }}
      >
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
        {showRing ? <SizeRing n={b.size} style={{ marginLeft: 6 }} /> : null}
      </span>
      {/* v17.9.0: the flag rail — the four markers that used to be appended to
          the label string, plus the ★ that was floating on the left. Order is
          Patryk's: deposit, preferred, then the exception flags, then the
          Assign handle. All flexShrink:0 — the name truncates, these survive.
          v17.9.1: …up to the point where they stop fitting, at which they are
          dropped rather than clipped on top of each other. See blockBudget. */}
      {/* v17.11.0: the STATUS mark leads the rail — on every block, never
          dropped, and the one marker here that is not conditional.

          A block's status was `BLOCK_BG[b.status]` and nothing else: no text,
          no mark, a WCAG 1.4.1 failure that three of the review's seven passes
          found independently. The legend at the bottom of the view is a lookup,
          not an in-context indicator, and it does nothing at all for a screen
          reader. `StatusIcon` shipped in v17.10.0 for exactly this and went
          onto buttons only.

          It leads because it is not a flag: the flags say what is unusual about
          a booking, and this says what the booking IS. It is also the only part
          of the rail that answers the question the three views used to answer
          three different ways — List names the status in a badge, Plan uses
          occupancy fills, and Timeline said it in colour alone.

          Fixed cost, like the clash marker, for the same reason: a seated block
          is drawn at its LIVE duration, so it starts a few pixels wide and
          grows, and a droppable status mark would be missing from every block
          for the first stretch of every visit — i.e. exactly while the party is
          being seated. `role="img"` + `aria-label` come from BlockFlag, so the
          status finally reaches the accessibility tree too. */}
      <BlockFlag title={STATUS_LABEL[b.status] || b.status}>
        <StatusIcon status={b.status} size={IC.control} />
      </BlockFlag>
      {railFlags.map((f) => (
        <BlockFlag key={f.k} title={f.title}>{f.icon}</BlockFlag>
      ))}
      {/* The double-booked marker sits LAST among the markers, nearest the
          handle. v17.9.0's rail order is facts first, exception states last
          (deposit, preferred, then locked / repeat-no-show / overstaying), and
          a clash is the most severe exception of all — so it takes the end of
          that run rather than jumping the queue to the front. Outside
          `railFlags` because it is never dropped; the title names the other
          party, which is the question anyone who sees this marker asks next and
          the one thing the stripe cannot say. */}
      {clash ? (
        <BlockFlag title={"Double-booked with " + clash.names.join(", ")
          + (clash.tables.length ? " on " + (clash.tables.length === 1 ? "table " : "tables ") + clash.tables.join(", ") : "")}>
          <ClashIcon size={IC.control} />
        </BlockFlag>
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
      </div>
      {/* v17.12.0 (/code-review): a real <button>, and OUTSIDE the button-role
          wrapper above. It was a bare `<span onClick>` — no role, no tab stop,
          `title` its only name — so it has never been reachable or even
          announced; moving the role off the block is what makes fixing that
          possible at all. `type="button"` because this is not a form.
          The reset (`background:none;border:0;font:inherit;color:inherit`) is
          what keeps a UA button from repainting the handle: everything visual
          here is unchanged from the span, `borderLeft` included. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onManual(b.id); }}
        title="Assign tables"
        aria-label={"Assign tables for " + b.name}
        style={{
          padding: "0 6px", cursor: "pointer", position: "relative",
          marginLeft: 4, flexShrink: 0,
          background: "none", border: 0, borderLeft: "2px solid var(--blk-rule)",
          font: "inherit", color: "inherit",
          // A <button> resolves `min-width` against its BORDER box where the
          // <span> resolved it against its content box, so without this the
          // handle silently narrows from 42px to 28 — measured. `box-sizing` is
          // the one property a UA button stylesheet changes that the visual
          // reset above does not cover.
          boxSizing: "content-box",
          height: "100%", display: "flex", alignItems: "center", justifyContent: "center", minWidth: 28
        }}
      >
        <AssignIcon size={IC.control} />
      </button>
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

// ── ClashBand (v17.11.0) — the minutes two bookings both claim ───────────────
// The review's finding was not that a double-booking is unlabelled; it is that
// the timeline actively DRAWS IT AS SOMETHING ELSE. The two blocks share a row,
// the later one paints over the earlier, and what is left on screen is two tidy
// consecutive sittings. Measured on a seeded day: 288px of overlap, hidden.
//
// A marker on each block says "this booking is in a clash". Only a band across
// the shared span says WHICH MINUTES are double-claimed, which is the thing the
// painting-over destroyed and the thing a host needs to decide what to move.
//
// Drawn AFTER the blocks, so it paints on top of whichever one is hiding the
// other — being underneath would reproduce the very problem.
//
// It is an UNDERLINE, not a wash, and the first version was the wash. Full
// height at 0.55 with a hatch, it marked the span correctly and sat directly on
// the later booking's name and start-time chip: "20:30 Rita Ca…" went behind
// diagonal stripes. A marker that obscures the label it is warning about has
// traded one unreadable block for another, which is the same defect this whole
// change is about — and there is no opacity that fixes it, because anything
// faint enough to read through is too faint to be the alarm.
//
// So it is a 5px stripe INSIDE the block, low enough to clear the label (which
// is vertically centred, measured to end ~4px above it) and high enough to
// clear the block's own 3px border. That gap is the whole point of the
// placement: the border is ALSO danger red, so a stripe flush against it just
// read as a thicker border and added nothing. Tried at the row's bottom edge
// first, where the 5px of gutter left by the blocks' `top: 3` / `ROW_H - 8`
// inset is not enough to separate them.
//
// Solid rather than the blocked bar's hatch: at 5px a 45° stripe reads as
// noise, and the two bands mean different things anyway — blocked is a table
// taken out of service, this is two parties promised the same minutes.
//
// What it is actually FOR, which the border cannot do: the stripe runs from the
// later booking's start to the EARLIER one's end, so its right-hand edge is the
// exact minute the earlier booking finishes — the fact the later block is
// painting over. Verified live: the stripe ends at Pau's right edge, 72px short
// of Rita's, on a pair where Pau is otherwise invisible past 20:30.
function ClashBand({ from, to, totalMins }) {
  const left = pct(from);
  const w = Math.max(((to - from) / totalMins) * 100, 0.5) + "%";
  return (
    <div aria-hidden="true" style={{
      position: "absolute", bottom: 8, height: 4,   /* @canvas */
      left, width: w,
      background: "var(--tl-clash-a)",
      // /code-review fix: a 1px casing, because the red core does NOT contrast
      // with the fills it is drawn on — 1.02:1 on a seated block, 1.34 on a
      // confirmed one. A zero-blur ring is not a drop shadow (check:style's
      // rule 6 matches non-zero blur by construction) and it is the standard
      // way to make a marker read over a variable background: the boundary
      // carries 1.4.11's 3:1, the fill carries the meaning.
      boxShadow: "0 0 0 1px var(--tl-clash-edge)",
      borderRadius: R.pill,
      pointerEvents: "none"
    }} />
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
function WaitGhost({ g, totalMins, pxPerMin = 1, onBook, leaving = false, focusFallbackRef = null }) {
  // v17.15.3: a LEAVING cell is still mounted (useRevealRows holds it so this
  // fade can finish) but its ghost is already gone from waitGhosts, so `g` is
  // undefined. Cache the last real one, the `last.current` idiom Presence uses
  // — BlockModal gets the same thing free because Reveal caches its children,
  // and there is no Reveal here.
  const last = useRef(null);
  const elRef = useRef(null);
  if (g) last.current = g;
  g = g || last.current;
  // /code-review: hand focus back when a ghost leaves while HOLDING it. Going
  // inert means `aria-hidden`, and an element that is focused AND hidden from
  // the a11y tree is a state assistive tech is not required to make sense of —
  // then it unmounts and focus falls to <body>, dropping the keyboard user at
  // the top of the document. Reachable: Tab onto a ghost to consider it, and
  // the match evaporates (the quarter ticks, the party is booked from the
  // panel, the table gets blocked) before you press Enter.
  //
  // The target is the grid SCROLLER, which takes tabIndex={-1} for exactly this
  // — the `<main tabIndex={-1}>` skip-link precedent: programmatically
  // focusable, never in the tab order. Focus lands in the timeline, so the next
  // Tab continues from here instead of restarting. `preventScroll` because
  // focusing otherwise scrolls the target into view, which on a horizontal
  // scroller would yank the grid sideways under the user.
  //
  // Must sit ABOVE the two early returns below — hooks run unconditionally.
  useLayoutEffect(() => {
    if (!leaving) return;
    const el = elRef.current;
    if (!el || document.activeElement !== el) return;
    const fb = focusFallbackRef && focusFallbackRef.current;
    if (fb) fb.focus({ preventScroll: true });
    else el.blur();
  }, [leaving, focusFallbackRef]);
  if (!g) return null;
  const gS = toMins(g.time);
  // Clamp to the grid's right edge, exactly as the turnaround tail does — an
  // absolutely-positioned child past GRID_CLOSE still counts toward the
  // scroller's scrollWidth and would add empty scroll that grows with zoom.
  const gE = Math.min(gS + g.dur, GRID_CLOSE * 60);
  const mins = gE - gS;
  if (mins <= 0) return null;
  // v17.9.1: the ring follows the block's width budget, for the reason this whole
  // component exists — a quieter version of X dims X, it does not re-specify it.
  // A ghost that kept piling its ring where the block it mirrors had stopped
  // would be re-specifying by omission. Only the ring half applies: a ghost has
  // no flags and no handle, and its time chip is unconditional because the time
  // IS the proposal (a ghost without one says nothing).
  const { showRing } = visibleRail(
    mins * pxPerMin, CHIP_PX + FLAG_PX + NAME_MIN_PX, RING_PX, FLAG_PX, []
  );
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
      // existence next to blocks that never move on their own.
      //
      // v17.15.3: and it now LEAVES the same way. v17.8.0 called the asymmetry
      // deliberate, on the grounds that a ghost disappears when a real booking
      // takes that table and the eye belongs on the block that appeared. That
      // argument is sound and covers exactly ONE of the four ways a ghost goes;
      // in the other three — the party leaves the waitlist, the clock crosses a
      // quarter, the table gets blocked, the match moves to another table —
      // nothing replaces it and it simply blinked out.
      //
      // The booking case still needs no special handling, and not by luck: the
      // ghosts in a row are rendered BEFORE the real blocks (see the row below),
      // so a ghost fading underneath the block that replaced it is hidden by
      // paint order. Measured in DEV, not assumed.
      //
      // mgt-ghost-out is mgt-appear's exact mirror — see index.css for why it
      // alone takes `forwards`.
      ref={elRef}
      className={"mgt-blk " + (leaving ? "mgt-ghost-out" : "mgt-hover-scale mgt-appear")}
      data-wg={g.id}
      /* v17.12.0: a ghost is a proposal you can accept, so it is a button like
         the blocks around it. Its name says WAITING first — the dimming and the
         ⏳ are the only things separating it from a real booking visually, and
         neither survives being read aloud. */
      /* v17.15.3: a departing ghost is INERT. For the length of its hold it
         would otherwise still be a focusable button offering to book a party
         that may have just left the waitlist. */
      role={leaving ? undefined : "button"}
      tabIndex={leaving ? -1 : 0}
      aria-hidden={leaving ? true : undefined}
      aria-label={leaving ? undefined
        : "Waiting: " + g.name + ", " + g.size + (g.size === 1 ? " guest" : " guests")
        + ", " + g.time + (g.resh ? ", fits after re-optimising" : "") + ". Book this table."}
      onKeyDown={leaving ? undefined : (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onBook(g.id);
      }}
      /* Same as TimelineBlock above: keyboard-focusable, not pointer-focusable. */
      onMouseDown={(e) => { e.preventDefault(); }}
      onMouseEnter={leaving ? undefined : () => setGroupHover(true)}
      onMouseLeave={leaving ? undefined : () => setGroupHover(false)}
      onClick={leaving ? undefined : () => onBook(g.id)}
      title={"Waiting: " + g.name + " (" + g.size + ") at " + g.time
        + (g.resh ? " — fits after re-optimising" : "") + ". Tap to book."}
      style={{
        // Geometry, radius, border, shadow: TimelineBlock's, verbatim.
        position: "absolute", top: 3, height: (ROW_H - 8) + "px",
        left: pct(gS), width: Math.max((mins / totalMins) * 100, 0.3) + "%",
        background: BLOCK_BG.pending, borderRadius: 10, overflow: "hidden",   /* @canvas */
        // v17.15.3: the other half of "inert while leaving" — the handlers are
        // gone above, this stops it swallowing a press aimed at what is behind.
        pointerEvents: leaving ? "none" : undefined,
        // Dims the real block, does not re-specify it — so it takes the pending
        // fill's ink too, or the v17.8.0 contrast pass would have fixed the
        // block and left its own ghost white-on-yellow.
        color: BLOCK_INK.pending,
        display: "flex", alignItems: "center", boxSizing: "border-box",
        border: g.resh ? "1px dashed var(--rim-solid-strong)" : RIM_SOLID,
        boxShadow: "var(--shadow-btn-solid)",
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
      }}><WaitIcon size={IC.control} /></span>
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
        {showRing ? <SizeRing n={g.size} style={{ marginLeft: 6 }} /> : null}
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
  // v17.11.0: double-bookings on the viewed day, from App's findClashes memo.
  //   clashes    {bookingId: {names:[…], tables:[…]}} — the block's marker/border
  //   clashSpans {tableId: [{from,to}…]}              — the hatched overlap bands
  // Two shapes because they answer two questions: which BOOKINGS are in a clash,
  // and which MINUTES of which ROW are double-claimed. Deriving one from the
  // other here would mean re-running the pair scan in the render path.
  clashes = {}, clashSpans = {},
  // v17.11.0: the empty-day prompt (EmptyDay.jsx), which shipped in List only.
  // v17.14.0: `emptyWalkin`, not `onWalkin` — PlanView already had an
  // `onWalkin(tableId)` of its own for its table popover, so the empty-day
  // callback had two names across three views and the next surface would have
  // guessed wrong and got a silently missing button. One input, one name.
  onNew = null, emptyWalkin = null, dayClosed = false, isEmpty = false,
  // v17.16.2: TODAY (App's single `todayStr()`), which is NOT `date` — that is
  // the day being VIEWED. liveBarDur needs both to put now on a booking's axis.
  today = "",
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
  const isToday = date === today;
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
  // v17.16.6 (/code-review): filtered through the SAME predicate getBlockSlots
  // uses, because BlockBar below calls toMins(bl.from) itself. Guarding only the
  // placement path left an unreadable block throwing during RENDER, where the
  // error boundary unmounts the whole app — the day stayed unusable and the
  // crash simply moved somewhere worse.
  const dayBlocks = blocks.filter((bl) => isReadableBlock(bl) && bl.date === date);

  // ── v17.15.3: the waitlist ghost's departure ────────────────────────────────
  // A ghost draws one CELL per matched table, so the tracked identity is the
  // cell — waitlist id + table — not the ghost. That is what makes a match
  // MOVING from table 3 to table 5 read correctly: a departure on 3 and an
  // arrival on 5, which is exactly what it looks like on screen.
  //
  // The separator is the ASCII unit separator, written as the ESCAPE and never
  // the raw byte (undoKey / clashRowId's rule — a raw control character is
  // invisible in every editor, grep and diff). A table id cannot contain it.
  //
  // ONE hook call for the whole grid, deliberately not one per row: 13 rows
  // would mean 13 independent lifecycles, and a two-table ghost would be
  // tracked twice.
  //
  // `date` is the resetKey, and it is mandatory rather than tidy — a date
  // change REPLACES the ghost list wholesale, which is the exact case v17.15.0
  // added resetKey for. Without it, stepping to the next day fades yesterday's
  // ghosts out under today's grid.
  //
  // Accepted, and stated rather than hidden: useRevealRows prunes at
  // REVEAL_EXIT_MS (540ms) while this fade runs for --t-move (240ms), so a
  // departed cell stays mounted ~300ms longer than it strictly needs. That is
  // not the failure those holds guard against — they exist to stop a hold being
  // SHORTER than its animation and truncating it. The extra node is invisible
  // and inert (see WaitGhost's `leaving`), so the hook is left alone; if it ever
  // matters the fix is a `speed` param mirroring Reveal's.
  const GHOST_SEP = "\u001f";
  const ghostCells = [];
  waitGhosts.forEach((g) => {
    (g.tables || []).forEach((t) => { ghostCells.push({ key: g.id + GHOST_SEP + t, table: t, g: g }); });
  });
  // `openIds` is deliberately NOT destructured. v17.15.3's own /code-review
  // replaced the one place that read it with the `!cell` test documented at the
  // WaitGhost call site below, and left the binding behind — where it was an
  // unused variable, i.e. a lint ERROR, and lint is a hard CI gate here.
  const { renderIds: ghostRenderIds } = useRevealRows(
    ghostCells.map((c) => c.key), date
  );
  const ghostByKey = new Map(ghostCells.map((c) => [c.key, c]));
  // Rows read this: every cell still MOUNTED for this table, live or leaving.
  const ghostKeysFor = (tableId) => ghostRenderIds.filter(
    (k) => k.slice(k.indexOf(GHOST_SEP) + 1) === tableId
  );
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
    return liveBarDur(b, nowMins, today) * pxPerMin >= chipRoomFor(b, nsMap[identityKey(b)] || 0, warnings[b.id], !!clashes[b.id]);
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
              // --shadow-btn, matching atoms' TBadge (/code-review fix). This is
              // the SAME badge over the same theme-flipping TBL fill, and it is
              // itself a .mgt-hover-scale control, so it takes the raised
              // treatment; shipping the two on different tokens put one table
              // label at two elevations depending on which view you were in.
              boxShadow: "var(--shadow-btn)"
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
        {ghostKeysFor(id).map((k) => {
          const cell = ghostByKey.get(k);
          // A departed cell is no longer in ghostByKey — it renders from the
          // snapshot WaitGhost cached, and `leaving` puts it on the fade out.
          //
          // /code-review: `leaving` is the ABSENCE OF A LIVE CELL, deliberately
          // NOT `!ghostOpenIds.has(k)`. useRevealRows adds a NEWCOMER to
          // renderIds one commit BEFORE its rAF opener adds it to openIds, so
          // the openIds test called an ARRIVING ghost "leaving" for exactly one
          // frame — which painted it at full 0.55 on the exit keyframe, inert
          // and aria-hidden, before mgt-appear restarted it from 0. A pop, then
          // a fade. `!cell` is also right on the opposite edge: a cell that has
          // just left starts fading in the same commit rather than waiting for
          // the openIds removal.
          return (
            <WaitGhost
              key={"wg" + k}
              g={cell ? cell.g : null}
              leaving={!cell}
              focusFallbackRef={scrollRef}
              pxPerMin={pxPerMin}
              totalMins={totalMins}
              onBook={onBookWait}
            />
          );
        })}
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
            const tStart = toMins(b.time) + liveBarDur(b, nowMins, today);
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
              <TimelineBlock b={b} pxPerMin={pxPerMin} anim={statusAnimOf(b.id)} flipId={(b.tables || [])[0] === id ? b.id : null} nowMins={nowMins} today={today} totalMins={totalMins} warnings={warnings} clash={clashes[b.id] || null} currency={currency} late={late[b.id] || null} noShows={nsMap[identityKey(b)] || 0} showChip={chipsOn && (b.status === "confirmed" || b.status === "pending")} freeMin={(b.tables || [])[0] === id ? (freeing[b.id] != null ? freeing[b.id] : null) : null} onEdit={onEdit} onManual={onManual} setQuickStatus={setQuickStatus} homeTable={id} tableAtY={tableForClientY} setDragHover={setDragHover} onDropOnTable={onDropOnTable} />
            </Fragment>
          );
        })}
        {/* LAST in the row, so it paints over the blocks — the whole point is
            that it marks the span the later block is hiding the earlier one on. */}
        {(clashSpans[id] || []).map((sp, i) => (
          <ClashBand key={"cb" + i} from={sp.from} to={sp.to} totalMins={totalMins} />
        ))}
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
      {unassigned.map((b) => <TimelineBlock key={b.id} b={b} pxPerMin={pxPerMin} anim={statusAnimOf(b.id)} flipId={(b.tables || []).length ? null : b.id} nowMins={nowMins} today={today} totalMins={totalMins} warnings={warnings} clash={clashes[b.id] || null} currency={currency} late={late[b.id] || null} noShows={nsMap[identityKey(b)] || 0} showChip={chipsOn && (b.status === "confirmed" || b.status === "pending")} onEdit={onEdit} onManual={onManual} setQuickStatus={setQuickStatus} homeTable={null} tableAtY={tableForClientY} setDragHover={setDragHover} onDropOnTable={onDropOnTable} />)}
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
        boxShadow: "var(--shadow-btn)"
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
      /* /code-review (v17.15.3): programmatic focus target, never in the tab
         order — where focus goes when a ghost leaves while holding it (see
         WaitGhost). The `<main tabIndex={-1}>` pattern; `.mgt-tl-scroll` in
         index.css suppresses the ring, because this is a container and not a
         control. */
      tabIndex={-1}
      className="mgt-tl-scroll"
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
        background: followNow ? "var(--app-btn-dark)" : "var(--app-btn-grey)"
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
        {"Optimiser: " + (autoOptimizer ? "ON" : "OFF")}
      </button>
      {/* v15.8.0: slides in L→R when Optimizer is toggled OFF, slides out →L when ON. */}
      <Presence show={!autoOptimizer} inClass="mgt-slide-in" outClass="mgt-slide-out" tag="span">
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
          background: BLOCK_BG[s] || BLOCK_BG.confirmed,
          color: BLOCK_INK[s] || "var(--text-on-accent)",
          border: RIM_SOLID,
          fontWeight: FW.semi, textTransform: "capitalize",
          boxShadow: "var(--shadow-flat)",
          display: "inline-flex", alignItems: "center", gap: 4
        }}
      >
        {/* v17.11.0: the legend chip carries the MARK as well as the colour and
            the word, so it teaches the pairing a block now uses. A legend that
            listed only colours while the blocks had gained a second encoding
            would explain the half that never needed explaining. */}
        <StatusIcon status={s} size={IC.inline} />
        {s}
      </span>
    );
  });
  legendEls.push(
    <span key="in" style={{ fontSize: T.small, padding: "2px 8px", borderRadius: R.pill, background: TBL.ind.bg, color: "var(--text-on-accent)", border: RIM_SOLID, fontWeight: FW.semi }}>
      indoor
    </span>
  );
  legendEls.push(
    <span key="out" style={{ fontSize: T.small, padding: "2px 8px", borderRadius: R.pill, background: TBL.out.bg, color: "var(--text-on-accent)", border: RIM_SOLID, fontWeight: FW.semi }}>
      outdoor
    </span>
  );
  legendEls.push(
    <span key="blocked" style={{ fontSize: T.small, padding: "2px 8px", borderRadius: R.pill, background: "var(--tl-blocked-badge)", color: "var(--text-on-accent)", border: RIM_SOLID, fontWeight: FW.semi }}>
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
      today={today}
      nowMins={nowMins}
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
      {/* v17.11.0: the empty-day prompt, which until now existed only in List.
          ABOVE the grid rather than instead of it — the grid is a picture of the
          room and an empty room is what you want to see on an empty day, plus
          the label column still lets you block a table. See EmptyDay.jsx. */}
      {/* v17.15.0: eased, not snapped — same `Reveal` as the notification strip.
          The `null` on the false branch is what lets the exit animate at all
          (Reveal caches only truthy children and collapses that cache). */}
      <Reveal show={isEmpty}>{isEmpty ? <EmptyDay closed={dayClosed} onNew={onNew} onWalkin={emptyWalkin} /> : null}</Reveal>
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><AssignIcon size={IC.inline} />assign</span>
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
