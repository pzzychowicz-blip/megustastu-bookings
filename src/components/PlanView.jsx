// src/components/PlanView.jsx
//
// v17.0.0 — the Plan view: a top-down map of the restaurant (the 3rd main
// view, between List and Walk-in). Renders settings/layout.floorPlan (room,
// walls, doors, tables + chairs — see useLayout.sanitizeFloorPlan; shapes via
// FloorPlanEditor's shared TableGlyph/DoorGlyph so the editor and the live
// view draw identical geometry).
//
// Occupancy coloring — driven by the TIME SLIDER above the canvas (15-min
// steps across the viewed day's hours; defaults to NOW on today, opening time
// on other dates — Patryk's chosen model, so any date/evening can be
// previewed). A table takes the color of the booking occupying it at the
// slider time: seated green · confirmed blue · pending yellow · free neutral;
// a table under an active tableBlock renders grey with a dashed border.
// Completed bookings never occupy (the "completed = table free" rule); a
// SEATED overstayer occupies until now via occupancyEnd.
//
// Interactions:
//   • tap a table  → popover listing that day's bookings queued on it
//                    (time · name · pax · status chip); tap a row → onEdit.
//                    A FREE table on today also offers "Walk-in here" →
//                    onWalkin(tableId) (pre-selected walk-in form).
//   • RMB / long-press a table → the shared QuickStatusPopup targeting the
//     booking occupying it at the slider time, else the next upcoming one
//     (current-else-next, Patryk-confirmed).
//   • wheel / pinch zooms, background drag pans, double-tap/click resets —
//     all gated on `gesturesEnabled` (v17.1.2 per-device Settings toggle).
//   • seated tables show the v16.3.0 freeing-soon countdown ("~Nm") when the
//     slider sits at NOW (predictions are a "right now" read).
//
// Blur budget: no backdrop-filter here — popovers use the opaque popup tokens.

import { useState, useRef, useEffect, memo } from "react";
import { createPortal } from "react-dom";
import { S, BLOCK_BG, BLOCK_INK, hoursFor, R, M, T, FW, IC, RIM_SOLID } from "../lib/constants";
import { toMins, toTime, getBlockSlots, statusOrder, getDur, describeBooking } from "../lib/booking-logic";
import { TableGlyph, DoorGlyph } from "./FloorGlyphs"; // v17.1.0: glyphs extracted so the editor can lazy-load
import { QuickStatusPopup } from "./QuickStatusPopup";
import { StatusIcon } from "./Icons"; // v17.15.7: the one status→mark source
import { TimeAxis } from "./TimeAxis"; // v17.5.0: the time-block strip that replaced the slider
import { mkBtn, Reveal, SBadge } from "./atoms";
import { EmptyDay } from "./EmptyDay";

// Neutral (free) table fill — theme tokens, matches the editor's look.
const FREE_FILL = "var(--bg-card)";
const FREE_STROKE = "var(--fp-outline)";

// v17.15.7: the status mark's TOP edge inside TableGlyph's counter-rotated <g> —
// the id pill's bottom (y=9) plus 2. Units are centimetres, so at IC.control the
// mark ends at y=25: inside the 60cm tables sanitizeFloorPlan actually places,
// outside the editor's 30cm floor, exactly like the freeing-soon pill above it.
const MARK_TOP = 11;

// v17.1.0 perf: React.memo — function props are App's stable VA wrappers.
// `layout` (the whole config object) is already a prop, so a layout edit busts
// the memo naturally; `hoursSig` (the parent's weekHours state) is an
// identity-only prop that busts it on an operating-hours edit, because
// hoursFor(date) reads a live module binding the memo can't see.
export const PlanView = memo(function PlanView({
  bookings, date, layout, blocks = [],
  nowMins = 0, late = {}, freeing = {},
  onEdit, onStatus, onNoShow, onWalkin = () => {},
  // v17.11.0: the empty-day prompt (EmptyDay.jsx), which shipped in List only.
  // `emptyWalkin` is separate from `onWalkin` above: that one is this view's own
  // per-table handler and is always present, while the prompt's button must
  // disappear on any day but today — so they are different questions with
  // different answers, and folding them into one prop would have made the
  // Walk-in button appear on next month's empty plan.
  onNew = null, emptyWalkin = null, dayClosed = false, isEmpty = false,
  // v17.1.2: per-device master switch for zoom/pan/double-tap-reset (Settings →
  // General "Plan zoom & pan", localStorage-backed in App — scalar, memo-safe).
  gesturesEnabled = true,
  // v17.6.0: separation between bookings, in minutes (0 = off). Scalar from App
  // rather than the TURN_BUFFER live binding — React.memo can't see a live
  // binding (same reason hoursSig exists).
  turnBuffer = 0
}) {
  const fp = (layout && layout.floorPlan) || { room: { w: 900, h: 600 }, tables: {}, walls: [], doors: [] };
  const tables = (layout && Array.isArray(layout.tables)) ? layout.tables : [];
  const h = hoursFor(date);
  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday = date === todayStr;
  const openM = (h.closed ? 13 : h.open) * 60;
  // v17.5.0: the upper bound is now GRID_CLOSE (one hour past closing), not
  // CLOSE — matching the Timeline axis exactly, which is what lets TimeAxis
  // reuse pct()/QUARTER_HOURS unchanged. It also lets you scrub into the tail
  // where a late booking actually runs out, which the old slider couldn't reach.
  const closeM = (h.closed ? 23 : h.gridClose) * 60;

  // ── Time scrubber (defaults: now on today, opening time otherwise) ─────────
  // Absolute minutes-since-midnight, clamped to the day's span and NOT rounded.
  //
  // v17.6.0: this used to round to the nearest 15, and that rounding is gone.
  // While FOLLOWING the clock the selection is now the exact minute, so the
  // badge reads the real time and the tape centre lands on the same minute as
  // the Timeline's now-line — the two views no longer disagree about where
  // "now" is by up to 7 minutes. Hand-scrubbing is unchanged: TimeAxis snaps
  // its OWN scroll to the quarter grid, which is where the 15-min stepping
  // always actually came from. (The old rounding was also described as
  // load-bearing for the seated-start clamp in the occupancy scan below; it
  // only ever compensated for the follow position being rounded away from the
  // clock, so with an exact follow there is nothing left to compensate for.)
  const clampExact = (m) => Math.max(openM, Math.min(closeM, m));
  const [slider, setSlider] = useState(() => clampExact(isToday ? nowMins : openM));
  const [sliderTouched, setSliderTouched] = useState(false);
  // v17.5.0: bumped ONLY at the programmatic scrub sites (date change, clock
  // follow, the Now button) so TimeAxis re-centres then — and never yanks the
  // strip while the user is scrolling it or tapping a block.
  // v17.6.0: the bump carries HOW to move as well as when. `k` is the trigger
  // (TimeAxis keys its layout effect on it); `smooth` says whether that re-centre
  // glides. Kept in ONE state object so the two can never arrive out of step —
  // two separate states would let a stale `smooth` ride along with a fresh `k`.
  const [autoScroll, setAutoScroll] = useState({ k: 0, smooth: false });
  const reCentre = (smooth) => setAutoScroll((s) => ({ k: s.k + 1, smooth: !!smooth }));
  // Re-anchor when the date changes; follow the clock on today until touched.
  // Both effects key on ONE trigger on purpose — re-running them on every
  // dependency would yank the selection out from under a hand scrub.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSlider(clampExact(isToday ? nowMins : openM)); setSliderTouched(false); reCentre(); }, [date]);
  // Follows per MINUTE now rather than per quarter. `nowMins` only changes value
  // once a minute (the 15s tick re-sets the same number and React bails), and
  // the occupancy pass below is one linear loop over the day — nowhere near the
  // heavy-scan class CLAUDE.md warns about.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isToday && !sliderTouched) { setSlider(clampExact(nowMins)); reCentre(); } }, [nowMins]);
  const atNow = isToday && Math.abs(slider - clampExact(nowMins)) < 1;

  // ── Occupancy at the slider time ────────────────────────────────────────────
  const day = bookings.filter((b) => b && b.date === date && b.status !== "cancelled");

  // v17.5.0: per-quarter occupancy for the ruler's heat band — the share of
  // tables taken at each 15-minute mark, so the rush is visible BEFORE you
  // scrub to it. Deliberately a plain linear pass (one loop over the day's
  // bookings, marking the quarters each one spans): nothing here calls
  // trialFits/findTimes, so it is nowhere near the heavy-scan class CLAUDE.md
  // warns about, and it needs no memo.
  const occupancyByQuarter = (() => {
    const tableCount = tables.length || 1;
    const acc = {};
    day.forEach((b) => {
      if (b.status === "completed") return;   // completed = table free, everywhere
      const n = (b.tables || []).length;
      if (!n) return;
      const s = toMins(b.time);
      const e = s + (b.duration || 90);
      for (let m = Math.floor(s / 15) * 15; m < e; m += 15) acc[m] = (acc[m] || 0) + n;
    });
    Object.keys(acc).forEach((k) => { acc[k] = Math.min(1, acc[k] / tableCount); });
    return acc;
  })();
  const occupying = {};   // tableId → booking occupying it at `slider`
  day.forEach((b) => {
    if (b.status === "completed") return; // completed = table free, everywhere
    let s = toMins(b.time);
    let e = s + (b.duration || 90);
    // A seated party occupies until AT LEAST now (overstayers included) — the
    // occupancyEnd/v15.1.1 semantics, applied to the slider timeline. Widening
    // the window to `now` in BOTH directions fixes two bugs at once:
    //   • an overstayer used to drop out of `occupying` the moment it passed
    //     its scheduled end, so Plan showed the table free while Timeline and
    //     List still showed it seated (v17.1.0);
    //   • seating runs the seated-shift (time → now, e.g. "14:03"), and the
    //     table stayed free-coloured until the selection caught up — the "Plan
    //     shows the status change with a delay" bug (v17.1.1).
    //
    // v17.6.0: both clamps are now keyed on the RAW `nowMins`. They used to
    // round to the slider's 15-min grid, purely because the auto-following
    // selection was itself rounded and could sit up to ~7 min either side of
    // the real clock; following is exact now, so the rounding has nothing left
    // to compensate for. The clamps only ever widen the window TOWARD now, so
    // hand-scrubbing into the viewed past (before the party sat down) still
    // correctly shows the table free.
    if (b.status === "seated" && isToday) {
      s = Math.min(s, nowMins);
      e = Math.max(e, nowMins + 1);
    }
    if (slider >= s && slider < e) {
      (b.tables || []).forEach((id) => {
        const cur = occupying[id];
        if (!cur || statusOrder(b.status) < statusOrder(cur.status)) occupying[id] = b;
      });
    }
  });
  // v17.6.0: tables inside a turnaround tail at the selected time — the party
  // has left but the separation has not elapsed, so the table is not bookable
  // yet. Only meaningful for tables that are NOT currently occupied; a table
  // still holding a party shows that party's colour, not the reset shade.
  const resetting = {};
  if (turnBuffer > 0) {
    day.forEach((b) => {
      if (b.status === "completed") return;   // completed = table free, everywhere
      let e = toMins(b.time) + (b.duration || 90);
      if (b.status === "seated" && isToday) e = Math.max(e, nowMins + 1);
      if (slider >= e && slider < e + turnBuffer) {
        (b.tables || []).forEach((id) => { if (!occupying[id]) resetting[id] = true; });
      }
    });
  }
  const blockSlots = getBlockSlots(blocks, date);
  const isBlocked = (id) => blockSlots.some((sl) => sl.tables.indexOf(id) >= 0 && slider >= sl.s && slider < sl.e);

  // freeing-soon: {bookingId: inMin} → tableId → inMin (only meaningful at NOW).
  const freeSoonOf = {};
  if (atNow) {
    day.forEach((b) => { if (freeing[b.id] != null) (b.tables || []).forEach((id) => { freeSoonOf[id] = freeing[b.id]; }); });
  }

  // current-else-next: the RMB/long-press target for a table.
  function targetBookingFor(id) {
    if (occupying[id]) return occupying[id];
    const upcoming = day
      .filter((b) => (b.status === "confirmed" || b.status === "pending") && (b.tables || []).indexOf(id) >= 0 && toMins(b.time) >= slider)
      .sort((a, b) => toMins(a.time) - toMins(b.time));
    return upcoming[0] || null;
  }

  // ── Popups ───────────────────────────────────────────────────────────────────
  const [tablePop, setTablePop] = useState(null);   // table id → booking-list popover
  const [quick, setQuick] = useState(null);         // booking → QuickStatusPopup

  // ── Zoom / pan (transform on the inner <g>) ─────────────────────────────────
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const svgRef = useRef(null);
  const panRef = useRef(null);        // {x,y,tx,ty} while background-dragging
  const pinchRef = useRef(null);      // {d0,k0} while two-pointer pinching
  const pointersRef = useRef({});     // active pointers for pinch
  const movedRef = useRef(false);     // suppress tap-select after a drag
  const pressRef = useRef(null);      // long-press timer for touch quick-status

  function toSvg(e) {
    const svg = svgRef.current;
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (fp.room.w / r.width), y: (e.clientY - r.top) * (fp.room.h / r.height) };
  }
  function onWheel(e) {
    if (!gesturesEnabled) return; // no preventDefault → the page scrolls normally
    e.preventDefault();
    const p = toSvg(e);
    setView((v) => {
      const k = Math.max(0.5, Math.min(5, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      // keep the cursor point stationary: p_screen = k*p_world + t
      const wx = (p.x - v.tx) / v.k, wy = (p.y - v.ty) / v.k;
      return { k: k, tx: p.x - k * wx, ty: p.y - k * wy };
    });
  }
  function bgPointerDown(e) {
    // v17.0.0 round 8 (Patryk): a NON-PRIMARY button never arms a pan. The RMB
    // press used to arm one, and its pointerUP then landed on the popup's scrim
    // (portalled above) — so the svg never saw the release and panRef stayed
    // armed. The next mouse move over the canvas (no button held) panned the
    // plan by the whole delta from that old RMB point: closing the popup read
    // as a stray "tap" that dragged the floor. Pair with the buttons===0 bail
    // in bgPointerMove so a stale ref can never pan.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!gesturesEnabled) return; // v17.1.2: no pan/pinch arming — taps untouched (movedRef stays false)
    pointersRef.current[e.pointerId] = { x: e.clientX, y: e.clientY };
    const pts = Object.values(pointersRef.current);
    if (pts.length === 2) {
      const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchRef.current = { d0: d0, k0: view.k };
      panRef.current = null;
      return;
    }
    movedRef.current = false;
    panRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    // NO setPointerCapture here — capturing redirects the subsequent `click`
    // to the svg, which silently killed the table-tap popover (found live).
    // Panning tracks fine while the pointer stays over the canvas.
  }
  function bgPointerMove(e) {
    if (!gesturesEnabled) return;
    // A mouse move with NO button held can never be a pan — belt-and-braces for
    // any release the svg misses (a pointerup swallowed by a portalled scrim).
    if (e.pointerType === "mouse" && e.buttons === 0) { panRef.current = null; return; }
    if (pointersRef.current[e.pointerId]) pointersRef.current[e.pointerId] = { x: e.clientX, y: e.clientY };
    const pts = Object.values(pointersRef.current);
    if (pinchRef.current && pts.length === 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      // v17.0.0 correction round 6: dampen pinch — the raw finger-distance ratio
      // felt hair-trigger. 0.5 = half sensitivity (a 2× spread → 1.5× zoom).
      const ratio = 1 + (d / pinchRef.current.d0 - 1) * 0.5;
      const k = Math.max(0.5, Math.min(5, pinchRef.current.k0 * ratio));
      setView((v) => ({ ...v, k: k }));
      return;
    }
    const pan = panRef.current;
    if (!pan) return;
    const svg = svgRef.current;
    const r = svg.getBoundingClientRect();
    const sx = fp.room.w / r.width, sy = fp.room.h / r.height;
    const dx = (e.clientX - pan.x) * sx, dy = (e.clientY - pan.y) * sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current = true;
    if (movedRef.current) { clearPress(); setView((v) => ({ ...v, tx: pan.tx + dx, ty: pan.ty + dy })); }
  }
  function bgPointerUp(e) {
    delete pointersRef.current[e.pointerId];
    if (Object.keys(pointersRef.current).length < 2) pinchRef.current = null;
    panRef.current = null;
    clearPress();
  }
  function resetView() { setView({ k: 1, tx: 0, ty: 0 }); }
  // Turning gestures OFF resets the view — a zoomed/panned plan must not get
  // stuck with no gesture left to un-zoom it — AND clears every gesture ref:
  // movedRef is only ever reset in bgPointerDown (which now bails when off), so
  // a stale `true` from a drag made just before the toggle would suppress the
  // table-tap onClick (`!movedRef.current`) forever (/code-review catch).
  useEffect(() => {
    if (!gesturesEnabled) {
      setView({ k: 1, tx: 0, ty: 0 });
      movedRef.current = false;
      panRef.current = null;
      pinchRef.current = null;
      pointersRef.current = {};
    }
  }, [gesturesEnabled]);

  // touch long-press → quick status (RMB parity for tablets, the timeline's 400ms).
  function startPress(id) {
    clearPress();
    pressRef.current = setTimeout(() => {
      pressRef.current = null;
      const b = targetBookingFor(id);
      if (b) { setTablePop(null); setQuick(b); }
    }, 450);
  }
  function clearPress() { if (pressRef.current) { clearTimeout(pressRef.current); pressRef.current = null; } }

  function fillFor(id) {
    // v17.0.0 correction: blocked = the Timeline BlockBar identity (red 45°
    // stripes, --tl-blocked-a/b), not grey-dashed — one "blocked" look app-wide.
    if (isBlocked(id)) return { fill: "url(#pv-blocked)", stroke: "var(--tl-blocked-badge-border)", dash: undefined };
    const b = occupying[id];
    // v17.6.0: resetting — free of guests, still inside the separation window.
    // A muted dashed outline over the free fill: clearly not occupied, but
    // clearly not offerable either.
    if (!b && resetting[id]) return { fill: FREE_FILL, stroke: "var(--text-muted)", dash: "4 3" };
    if (!b) return { fill: FREE_FILL, stroke: FREE_STROKE, dash: undefined };
    return { fill: BLOCK_BG[b.status] || BLOCK_BG.confirmed, stroke: "rgba(255,255,255,0.5)", /* @fixed-fill */ dash: undefined };
  }

  // ── Table-tap popover: the day's queue on this table ────────────────────────
  const popover = tablePop ? (() => {
    const id = tablePop;
    const queue = day
      .filter((b) => (b.tables || []).indexOf(id) >= 0)
      .sort((a, b) => toMins(a.time) - toMins(b.time));
    const occ = occupying[id];
    // v17.1.2 (Patryk): a table with ANY current occupant — including a seated
    // party — never offers "Walk-in here" (the v17.1.1 "seated-takeover" was
    // removed: an occupied table must not take another walk-in at that time).
    // v17.6.0: a table inside its turnaround tail is not free for a walk-in —
    // the optimizer would refuse the placement, so Plan must not offer it.
    const freeNow = !occ && !isBlocked(id) && !resetting[id];
    // v17.0.0 correction round 6: only OFFER a walk-in when the table can
    // actually seat one now — free at the slider AND a real window before the
    // next booking/block/close (≥ a minimal walk-in duration). A table free now
    // but booked in 10 min used to still show "Walk-in here" → dead-end form.
    const nextBusy = Math.min(
      closeM,
      ...day.filter((b) => (b.status === "confirmed" || b.status === "pending") && (b.tables || []).indexOf(id) >= 0 && toMins(b.time) > slider).map((b) => toMins(b.time)),
      ...blockSlots.filter((sl) => sl.tables.indexOf(id) >= 0 && sl.s > slider).map((sl) => sl.s)
    );
    // NB getDur reads the DUR_TIERS live binding, which neither `layout` nor
    // `hoursSig` covers — after a Settings duration-tier edit this gate can be
    // stale for up to ONE MINUTE (the next nowMins tick busts the memo).
    // Accepted (/code-review #5): self-healing, cosmetic, not worth a third
    // sig prop.
    // v17.6.0: …and must still fit the separation BEFORE the next booking, or
    // the walk-in form would open on a slot the placement check then refuses.
    const canWalkin = freeNow && isToday && (nextBusy - slider) >= getDur(2) + turnBuffer;
    // v17.0.0 correction round 4: portalled to <body> like QuickStatusPopup —
    // SlideView's transform makes an in-tree position:fixed scrim center on
    // the container, not the viewport.
    return createPortal(
      <div onClick={() => setTablePop(null)} className="mgt-scrim-in"
        style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--tl-popup-scrim)" }}>
        <div onClick={(e) => e.stopPropagation()} className="mgt-card-in"
          style={{ background: "var(--tl-popup-bg)", borderRadius: R.sheet, border: "1px solid " + S.border, boxShadow: "var(--shadow-popover)", padding: "18px 18px", minWidth: 260, maxWidth: 360, maxHeight: "70vh", overflowY: "auto", zIndex: 301 }}>
          <div style={{ fontSize: T.title, fontWeight: FW.bold, color: S.text, marginBottom: 12 }}>{"Table " + id}</div>
          {queue.length === 0 ? (
            <div style={{ fontSize: T.body, color: S.muted, marginBottom: 4 }}>No bookings on this table today.</div>
          ) : queue.map((b) => {
            return (
              <div key={b.id} className="mgt-hover-scale"
                onClick={() => { setTablePop(null); onEdit(b); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: R.inset, cursor: "pointer", marginBottom: 6, background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
                <span style={{ fontSize: T.body, fontWeight: FW.bold, color: S.text, fontVariantNumeric: "tabular-nums" }}>{b.time}</span>
                <span style={{ fontSize: T.body, fontWeight: FW.semi, color: S.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name + " (" + b.size + ")"}</span>
                {/* v17.15.6: it IS `SBadge` now, rather than a copy whose comment
                    pointed at `SBadge`. That comment ("solid, like every other
                    status label") was true about the fill and silently false
                    about everything else: the atom gained `StatusIcon` in
                    v17.15.5 and this copy could not follow it, so the popover
                    named a status with a word while the block behind it named
                    the same status with a mark. */}
                <SBadge status={b.status} />
              </div>
            );
          })}
          {canWalkin ? (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
              <button className="mgt-hover-scale"
                onClick={() => { setTablePop(null); onWalkin(id); }}
                style={mkBtn({ minHeight: 40, padding: "8px 18px", background: "var(--app-walkin)" })}>Walk-in here</button>
            </div>
          ) : null}
        </div>
      </div>,
      document.body
    );
  })() : null;

  // ── Legend + slider row ─────────────────────────────────────────────────────
  // v17.15.6: deliberately NOT `SBadge`, though it is the same fill. This is a
  // key for what the FILL painted on the floor plan means, and the plan draws
  // no icons — a mark here would promise the room shows something it does not.
  // The day-queue popover above is the opposite case: its rows are BOOKINGS,
  // and a booking's status is named the same way everywhere.
  const legend = ["seated", "confirmed", "pending"].map((s) => (
    <span key={s} style={{ fontSize: T.small, padding: "2px 8px", borderRadius: R.pill, background: BLOCK_BG[s], color: BLOCK_INK[s] || "var(--text-on-accent)", border: RIM_SOLID, fontWeight: FW.semi, textTransform: "capitalize" }}>{s}</span>
  ));

  return (
    <div style={{
      background: "var(--tl-card-bg)",
      backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
      borderRadius: R.sheet, border: "1px solid var(--tl-card-border)",
      padding: "10px 12px", boxShadow: "var(--shadow-soft)"
    }}>
      {/* v17.11.0: the empty-day prompt, above the floor rather than instead of
          it — the plan is a picture of the room, and an empty room is precisely
          what you want to see on an empty day. See EmptyDay.jsx. */}
      {/* v17.15.0: eased, not snapped — same `Reveal` as the notification strip.
          The `null` on the false branch is what lets the exit animate at all
          (Reveal caches only truthy children and collapses that cache). */}
      <Reveal show={isEmpty}>{isEmpty ? <EmptyDay closed={dayClosed} onNew={onNew} onWalkin={emptyWalkin} /> : null}</Reveal>
      {/* v17.5.0: Now + selected time + legend on one row, the ruler directly
          below it. The ruler is a SIBLING above the <svg>, so it sits outside
          the svg's touchAction:"none" and never fights the plan's pan/pinch
          gestures.
          v17.5.0 correction: the accent badge reads the scrubbed time and lives
          HERE rather than on its own lane above the tape — this row was mostly
          empty, so folding it in cost nothing and let the tape start directly
          under the status chips (~30px saved off the whole header).
          v17.5.0 correction 2: the badge is CENTRED, directly above the tape's
          fixed centre marker, so it labels the mark it belongs to instead of
          floating loose on the left. The grid that does it lives in index.html
          as `.mgt-plan-headrow` — it needs a media query (no room to centre on a
          phone) and PlanView takes no width prop. A grid rather than an
          absolutely positioned badge because, unlike an overlay, it can never
          collide with the legend. */}
      <div className="mgt-plan-headrow">
        <span>
          {isToday ? (
            <button className="mgt-hover-scale"
              onClick={() => { setSliderTouched(false); setSlider(clampExact(nowMins)); reCentre(true); }}
              style={mkBtn({ fontSize: T.small, minHeight: 28, padding: "2px 10px", background: atNow ? S.accent : "var(--app-btn-grey)" })}>Now</button>
          ) : null}
        </span>
        <span style={{
          background: S.accent, color: "var(--text-on-accent)",
          fontSize: T.body, fontWeight: FW.bold, fontVariantNumeric: "tabular-nums",
          padding: "2px 10px", borderRadius: R.pill, whiteSpace: "nowrap",
          boxShadow: "var(--shadow-btn)",
        }}>{toTime(slider)}</span>
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>{legend}</span>
      </div>
      {h.closed ? null : (
        <TimeAxis
          selected={slider}
          onSelect={(m) => { setSliderTouched(true); setSlider(m); }}
          nowMins={nowMins}
          isToday={isToday}
          occupancy={occupancyByQuarter}
          autoScrollKey={autoScroll.k}
          autoScrollSmooth={autoScroll.smooth} />
      )}
      {/* v17.8.0: the closed-day line moved to NotificationStrip — see the note
          in TimelineView. */}
      <div style={{ borderRadius: R.card, overflow: "hidden", border: "1px solid var(--border-soft)", background: "var(--bg-soft)" }}>
        <svg ref={svgRef} viewBox={"0 0 " + fp.room.w + " " + fp.room.h}
          style={{ display: "block", width: "100%", touchAction: gesturesEnabled ? "none" : "auto" }}
          onWheel={onWheel}
          onPointerDown={bgPointerDown} onPointerMove={bgPointerMove}
          onPointerUp={bgPointerUp} onPointerCancel={bgPointerUp}
          onDoubleClick={gesturesEnabled ? resetView : undefined}>
          {/* the Timeline table-block stripe pattern (45°, --tl-blocked-a/b) */}
          <defs>
            <pattern id="pv-blocked" width={11.3} height={11.3} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={11.3} height={11.3} fill="var(--tl-blocked-a)" />
              <rect width={5.65} height={11.3} fill="var(--tl-blocked-b)" />
            </pattern>
          </defs>
          <g transform={"translate(" + view.tx + "," + view.ty + ") scale(" + view.k + ")"}>
            {(fp.walls || []).map((wl, i) => (
              <line key={"w" + i} x1={wl.x1} y1={wl.y1} x2={wl.x2} y2={wl.y2} stroke="var(--text-muted)" strokeWidth={7} strokeLinecap="round" />
            ))}
            {(fp.doors || []).map((d, i) => <DoorGlyph key={"d" + i} door={d} />)}
            {tables.map((t) => {
              const e = fp.tables[t.id];
              if (!e) return null;
              const f = fillFor(t.id);
              const soon = freeSoonOf[t.id];
              // v17.12.0: the spoken version of the fill. The colour of a table
              // IS its state here, so without this a screen-reader user gets a
              // room full of identical "Table 5A" buttons. It describes the
              // table at the SELECTED time, exactly like the fill it mirrors.
              const occ = occupying[t.id];
              // v17.15.7: hoisted, because the spoken label and the drawn mark
              // must not disagree about whether this table is blocked — they
              // are two renderings of one fact, and `fillFor` reads it a third
              // time. See the mark below for why the precedence matters.
              const blocked = isBlocked(t.id);
              // /code-review: the occupant clause is `describeBooking` with the
              // table dropped — the table is already the subject of this
              // sentence. Same source as the List card and the timeline block,
              // so the three cannot word a booking differently.
              const a11yLabel = "Table " + t.id + ", " + (
                blocked ? "blocked"
                  : occ ? describeBooking(occ, { tables: false })
                    : resetting[t.id] ? "free after turnaround"
                      : "free"
              ) + (soon != null ? ", free in about " + soon + " minutes" : "");
              return (
                <TableGlyph key={t.id} id={t.id} entry={e} ariaLabel={a11yLabel}
                  fill={f.fill} stroke={f.stroke} strokeWidth={2} strokeDasharray={f.dash}
                  // v17.1.1: occupancy colour changes fade with the timeline's
                  // Seated→Completed timing (.mgt-fade-overlay). CSS can't
                  // interpolate the blocked url(#pv-blocked) pattern fill, so
                  // entering/leaving a table block snaps — accepted.
                  // v17.9.1: `filter` is in the list because the hover halo
                  // (.mgt-glyph-shape) is a filter, and an INLINE `transition`
                  // beats the stylesheet's outright — omitting it would leave
                  // the halo snapping here while easing in the editor, which
                  // passes no shapeStyle. Any inline transition on an element
                  // that also has a class-driven one must name both properties.
                  shapeStyle={{ transition: "fill " + M.status + ", stroke " + M.status + ", filter " + M.tap }}
                  onClick={() => { if (!movedRef.current) setTablePop(t.id); }}
                  onPointerDown={(ev) => { if (ev.pointerType === "touch") startPress(t.id); }}
                  onContextMenu={(ev) => {
                    ev.preventDefault(); ev.stopPropagation();
                    const b = targetBookingFor(t.id);
                    if (b) setQuick(b);
                  }}>
                  {/* v17.15.7: the status MARK — a second channel for a fill that
                      was the status and nothing else. The same WCAG 1.4.1 defect
                      v17.11.0 fixed on the timeline block, sitting unnoticed four
                      versions longer on the view where it bites hardest: a block
                      at least carries the guest's name, a table carries a table id.

                      Drawn ONLY where the fill says a status. `isBlocked` wins in
                      `fillFor`, and a blocked table CAN still hold a booking — so
                      keyed on `occ` alone this would paint a mark on top of the red
                      stripes, contradicting its own fill, and `blocked` is not a
                      booking status anyway. Free and resetting each already have a
                      second channel (the neutral fill; the dashed rim). What is
                      left is seated / confirmed / pending — exactly the legend's
                      three chips, because `completed` never occupies (completed =
                      table free) and `cancelled` is filtered out of `day`.

                      BELOW the id pill, which owns y ±9, mirroring the freeing-soon
                      pill above it. Centre, never a corner: TableGlyph's inner <g>
                      cancels the rotation, so a child is drawn TRANSLATED but not
                      ROTATED — a corner offset lands on a different edge of the
                      shape at every table rotation, while the centre column is the
                      one place rotation cannot move it. That is why the id pill
                      already lives there.

                      `color` on the wrapper rather than on the icon, because `Svg`
                      in Icons.jsx destructures `size`/`stroke`/`children` and DROPS
                      every other prop — no style, x, y or pointerEvents reaches the
                      element, which is what makes this <g> structural rather than
                      decoration. Same currentColor arrangement as the timeline
                      block, whose ink its children inherit. Without the `color`,
                      currentColor would resolve to the inherited S.text and paint
                      near-black on a saturated fill in light mode — silent, and it
                      would look deliberate.

                      No transition, and that is the honest answer rather than a
                      missing one: the mark MOUNTS and unmounts with the occupant,
                      and CSS cannot fade an element that is not there, so easing it
                      in while it snaps out is the one-way transition DESIGN.md
                      bans. The fill still fades over M.status, so for one M.status
                      the fill is mid-way while the mark is already the new one —
                      exactly what the timeline block does. */}
                  {!blocked && occ ? (
                    <g transform={"translate(" + (-IC.control / 2) + "," + MARK_TOP + ")"}
                      style={{ color: BLOCK_INK[occ.status] || "var(--text-on-accent)", pointerEvents: "none" }}>
                      <StatusIcon status={occ.status} size={IC.control} />
                    </g>
                  ) : null}
                  {soon != null ? (
                    <g transform="translate(0,-22)">
                      <rect x={-22} y={-9} width={44} height={16} rx={8} fill="var(--tl-block-warn-soon)" />
                      <text x={0} y={3} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--text-on-accent)" style={{ pointerEvents: "none" }}>{"~" + soon + "m"}</text>
                    </g>
                  ) : null}
                </TableGlyph>
              );
            })}
          </g>
        </svg>
      </div>
      <div style={{ fontSize: T.small, color: "var(--text-faint)", marginTop: 8, textAlign: "center" }}>
        {"scrub the time strip above · tap a table for its bookings · right-click / hold for quick status" + (gesturesEnabled ? " · scroll or pinch to zoom, drag to pan, double-tap to reset" : "")}
      </div>
      {popover}
      {quick ? (
        <QuickStatusPopup booking={quick} late={late} onStatus={onStatus} onNoShow={onNoShow} onClose={() => setQuick(null)} />
      ) : null}
    </div>
  );
}
);
