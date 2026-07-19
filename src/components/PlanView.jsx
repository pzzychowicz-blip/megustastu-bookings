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
import { S, STATUS_COLORS, BLOCK_BG, hoursFor } from "../lib/constants";
import { toMins, toTime, getBlockSlots, statusOrder, getDur } from "../lib/booking-logic";
import { TableGlyph, DoorGlyph } from "./FloorGlyphs"; // v17.1.0: glyphs extracted so the editor can lazy-load
import { QuickStatusPopup } from "./QuickStatusPopup";
import { mkBtn } from "./atoms";

// Neutral (free) table fill — theme tokens, matches the editor's look.
const FREE_FILL = "var(--bg-card)";
const FREE_STROKE = "var(--fp-outline)";

// v17.1.0 perf: React.memo — function props are App's stable VA wrappers.
// `layout` (the whole config object) is already a prop, so a layout edit busts
// the memo naturally; `hoursSig` (the parent's weekHours state) is an
// identity-only prop that busts it on an operating-hours edit, because
// hoursFor(date) reads a live module binding the memo can't see.
export const PlanView = memo(function PlanView({
  bookings, date, layout, blocks = [],
  nowMins = 0, late = {}, freeing = {},
  onEdit, onStatus, onNoShow, onWalkin = () => {},
  // v17.1.2: per-device master switch for zoom/pan/double-tap-reset (Settings →
  // General "Plan zoom & pan", localStorage-backed in App — scalar, memo-safe).
  gesturesEnabled = true
}) {
  const fp = (layout && layout.floorPlan) || { room: { w: 900, h: 600 }, tables: {}, walls: [], doors: [] };
  const tables = (layout && Array.isArray(layout.tables)) ? layout.tables : [];
  const h = hoursFor(date);
  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday = date === todayStr;
  const openM = (h.closed ? 13 : h.open) * 60;
  const closeM = (h.closed ? 22 : h.close) * 60;

  // ── Time slider (defaults: now on today, opening time otherwise) ───────────
  const clampSlider = (m) => Math.max(openM, Math.min(closeM, Math.round(m / 15) * 15));
  const [slider, setSlider] = useState(() => clampSlider(isToday ? nowMins : openM));
  const [sliderTouched, setSliderTouched] = useState(false);
  // Re-anchor when the date changes; follow the clock on today until touched.
  useEffect(() => { setSlider(clampSlider(isToday ? nowMins : openM)); setSliderTouched(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date]);
  useEffect(() => { if (isToday && !sliderTouched) setSlider(clampSlider(nowMins)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [nowMins]);
  const atNow = isToday && Math.abs(slider - clampSlider(nowMins)) < 15;

  // ── Occupancy at the slider time ────────────────────────────────────────────
  const day = bookings.filter((b) => b && b.date === date && b.status !== "cancelled");
  const occupying = {};   // tableId → booking occupying it at `slider`
  day.forEach((b) => {
    if (b.status === "completed") return; // completed = table free, everywhere
    let s = toMins(b.time);
    let e = s + (b.duration || 90);
    // A seated party occupies until AT LEAST now (overstayers included) — the
    // occupancyEnd/v15.1.1 semantics, applied to the slider timeline.
    // v17.1.0 fix: extend to the SLIDER's 15-min granularity, not raw now —
    // the auto-following slider is clampSlider(nowMins) (rounded to NEAREST
    // 15), so it can sit up to ~7 min AHEAD of now; with e = nowMins+1 an
    // overstayer dropped out of `occupying` the moment it passed its scheduled
    // end (slider < e failed) and the table flipped free/next-booking in Plan
    // while Timeline/List still showed it seated. clampSlider(nowMins)+1
    // always covers the rounded "now" position; sliding into the future still
    // frees the table correctly.
    // v17.1.1 fix: clamp the START to the slider grid too. Seating a booking
    // runs the seated-shift (time → now, e.g. "14:03"), but the auto-following
    // slider is clampSlider(nowMins) — rounded to the NEAREST 15, so it can sit
    // BELOW the shifted time (14:00 < 14:03) for up to ~7 min. `slider >= s`
    // failed and the table stayed free-coloured right after a quick-status
    // Seated — the "Plan shows the status change with a delay" bug. A seated
    // party is at the table NOW, so occupancy starts no later than the rounded
    // "now" position. NB the clamp only ever pulls the start back to the
    // rounded CURRENT time — dragging the slider into the viewed past (before
    // the party sat down) still shows the table free.
    if (b.status === "seated" && isToday) {
      s = Math.min(s, clampSlider(nowMins));
      e = Math.max(e, clampSlider(nowMins) + 1);
    }
    if (slider >= s && slider < e) {
      (b.tables || []).forEach((id) => {
        const cur = occupying[id];
        if (!cur || statusOrder(b.status) < statusOrder(cur.status)) occupying[id] = b;
      });
    }
  });
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
    if (!b) return { fill: FREE_FILL, stroke: FREE_STROKE, dash: undefined };
    return { fill: BLOCK_BG[b.status] || BLOCK_BG.confirmed, stroke: "rgba(255,255,255,0.5)", dash: undefined };
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
    const freeNow = !occ && !isBlocked(id);
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
    const canWalkin = freeNow && isToday && (nextBusy - slider) >= getDur(2);
    // v17.0.0 correction round 4: portalled to <body> like QuickStatusPopup —
    // SlideView's transform makes an in-tree position:fixed scrim center on
    // the container, not the viewport.
    return createPortal(
      <div onClick={() => setTablePop(null)} className="mgt-scrim-in"
        style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--tl-popup-scrim)" }}>
        <div onClick={(e) => e.stopPropagation()} className="mgt-card-in"
          style={{ background: "var(--tl-popup-bg)", borderRadius: 20, border: "1px solid " + S.border, boxShadow: "0 8px 32px rgba(0,0,0,0.14)", padding: "18px 20px", minWidth: 260, maxWidth: 360, maxHeight: "70vh", overflowY: "auto", zIndex: 301 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: S.text, marginBottom: 12 }}>{"Table " + id}</div>
          {queue.length === 0 ? (
            <div style={{ fontSize: 13, color: S.muted, marginBottom: 4 }}>No bookings on this table today.</div>
          ) : queue.map((b) => {
            const sc = STATUS_COLORS[b.status] || STATUS_COLORS.confirmed;
            return (
              <div key={b.id} className="mgt-hover-scale"
                onClick={() => { setTablePop(null); onEdit(b); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 12, cursor: "pointer", marginBottom: 6, background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: S.text, fontVariantNumeric: "tabular-nums" }}>{b.time}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: S.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name + " (" + b.size + ")"}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 8, textTransform: "capitalize", background: sc.bg, color: sc.text, border: "1px solid " + sc.border }}>{b.status}</span>
              </div>
            );
          })}
          {canWalkin ? (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
              <button className="mgt-hover-scale"
                onClick={() => { setTablePop(null); onWalkin(id); }}
                style={mkBtn({ minHeight: 40, padding: "8px 20px", background: "var(--app-walkin)" })}>Walk-in here</button>
            </div>
          ) : null}
        </div>
      </div>,
      document.body
    );
  })() : null;

  // ── Legend + slider row ─────────────────────────────────────────────────────
  const legend = ["seated", "confirmed", "pending"].map((s) => (
    <span key={s} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 8, background: BLOCK_BG[s], color: "var(--text-on-accent)", border: "1px solid rgba(255,255,255,0.2)", fontWeight: 600, textTransform: "capitalize" }}>{s}</span>
  ));

  return (
    <div style={{
      background: "var(--tl-card-bg)",
      backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
      borderRadius: 20, border: "1px solid var(--tl-card-border)",
      padding: "10px 12px", boxShadow: "var(--shadow-soft)"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: S.text, fontVariantNumeric: "tabular-nums", minWidth: 46 }}>{toTime(slider)}</span>
        <input type="range" min={openM} max={closeM} step={15} value={slider}
          onChange={(e) => { setSliderTouched(true); setSlider(Number(e.target.value)); }}
          style={{ flex: "1 1 160px", accentColor: "var(--accent)", minWidth: 120 }} />
        {isToday ? (
          <button className="mgt-hover-scale"
            onClick={() => { setSliderTouched(false); setSlider(clampSlider(nowMins)); }}
            style={mkBtn({ fontSize: 11, minHeight: 28, padding: "3px 10px", background: atNow ? S.accent : "var(--app-btn-grey)" })}>Now</button>
        ) : null}
        <span style={{ display: "inline-flex", gap: 4, marginLeft: "auto" }}>{legend}</span>
      </div>
      {h.closed ? (
        <div style={{ textAlign: "center", padding: "10px 0", fontSize: 13, fontWeight: 700, color: "var(--warn-text)" }}>Closed on this day.</div>
      ) : null}
      <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-soft)", background: "var(--bg-soft)" }}>
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
              return (
                <TableGlyph key={t.id} id={t.id} entry={e}
                  fill={f.fill} stroke={f.stroke} strokeWidth={2} strokeDasharray={f.dash}
                  // v17.1.1: occupancy colour changes fade with the timeline's
                  // Seated→Completed timing (.mgt-fade-overlay). CSS can't
                  // interpolate the blocked url(#pv-blocked) pattern fill, so
                  // entering/leaving a table block snaps — accepted.
                  shapeStyle={{ transition: "fill 360ms ease-out, stroke 360ms ease-out" }}
                  onClick={() => { if (!movedRef.current) setTablePop(t.id); }}
                  onPointerDown={(ev) => { if (ev.pointerType === "touch") startPress(t.id); }}
                  onContextMenu={(ev) => {
                    ev.preventDefault(); ev.stopPropagation();
                    const b = targetBookingFor(t.id);
                    if (b) setQuick(b);
                  }}>
                  {soon != null ? (
                    <g transform="translate(0,-22)">
                      <rect x={-22} y={-9} width={44} height={16} rx={8} fill="var(--tl-block-warn-soon)" />
                      <text x={0} y={3} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff" style={{ pointerEvents: "none" }}>{"~" + soon + "m"}</text>
                    </g>
                  ) : null}
                </TableGlyph>
              );
            })}
          </g>
        </svg>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, textAlign: "center" }}>
        {"tap a table for its bookings · right-click / hold for quick status" + (gesturesEnabled ? " · scroll or pinch to zoom, drag to pan, double-tap to reset" : "")}
      </div>
      {popover}
      {quick ? (
        <QuickStatusPopup booking={quick} late={late} onStatus={onStatus} onNoShow={onNoShow} onClose={() => setQuick(null)} />
      ) : null}
    </div>
  );
}
);
