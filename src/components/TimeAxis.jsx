// src/components/TimeAxis.jsx
//
// v17.5.0 — the Plan view's time scrubber: a tape-measure ruler that scrolls
// under a FIXED centre marker. Replaced the original `<input type="range">`,
// then (v17.5.0 correction) the first attempt at this, which was a row of
// discrete tappable blocks — legible, but it read as a segmented control
// rather than a picker and gave no sense of sliding through the service.
//
// ── The interaction ──────────────────────────────────────────────────────────
// Scroll or drag the ruler; whatever sits under the centre marker is selected,
// snapping to the nearest 15 minutes when you let go. Tapping anywhere on the
// ruler scrolls that time to the centre (a mouse gets a direct hit instead of
// having to drag). One continuous gesture, no small targets to aim at — which
// is what makes this work on the tablets.
//
// ── Why scrolling is cheap ───────────────────────────────────────────────────
// The browser owns the scroll; React re-renders only when the selected QUARTER
// changes, which is at most a few times a second even during a fast flick. That
// matters because every selection change re-runs PlanView's occupancy scan and
// repaints the floor SVG — a per-pixel update would be visibly janky.
//
// ── The 50% padding trick ────────────────────────────────────────────────────
// The scroller carries `padding-inline: 50%`, so the first and last ticks can
// reach the centre. It also makes the maths fall out: with half a viewport of
// padding on each side, the track position under the centre marker is exactly
// `scrollLeft`. So time = OPEN + (scrollLeft / trackW) * span, and centring a
// time is the same expression inverted — no measurement of the marker needed.
//
// ── Live bindings ────────────────────────────────────────────────────────────
// OPEN / GRID_CLOSE / QUARTER_HOURS hold the ACTIVE VIEW DAY's hours and are
// read at render time — never captured into a module-scope local (the
// constants.js live-binding gotcha). The span matches TimelineView's exactly
// (OPEN…GRID_CLOSE), so a mark here is the same minute as on the timeline.
//
// NOT memo'd, on purpose: it reads those live bindings, which React.memo cannot
// see. Gating belongs in its memo'd parent, which already takes `hoursSig`.
// Module scope IS load-bearing — an inline component would remount every tick
// on each 15s clock tick (the v17.1.0 GridLines lesson).

import { useRef, useLayoutEffect, useEffect } from "react";
import { OPEN, GRID_CLOSE, QUARTER_HOURS, S, R } from "../lib/constants";
// v17.5.0 correction: no toTime here any more — the selected-time badge moved
// up into PlanView's Now/legend row, so the tape renders no text of its own
// beyond the hour labels.

// Ruler density: one 15-minute step every 24px → an hour is 96px. Wide enough
// that hour labels never collide, tight enough that a whole service fits in a
// couple of flicks.
const PX_PER_QUARTER = 24;
const H = 62;             // tape height
const SNAP_MS = 130;      // idle time after scrolling before we snap

export function TimeAxis({
  selected, onSelect, nowMins = 0, isToday = false,
  autoScrollKey = 0,
  // v17.6.0: whether THIS programmatic re-centre glides or jumps. No ref needed —
  // PlanView bumps the key and sets this from one state object, so both arrive in
  // the same render and the effect below closes over the matching value.
  autoScrollSmooth = false,
  occupancy = null,       // {quarterMins: 0..1} — share of tables busy
}) {
  const scrollRef = useRef(null);
  const snapTimer = useRef(null);
  const guardTimer = useRef(null);     // lifts snappingRef when a snap settles
  const snappingRef = useRef(false);   // ignore scroll events we caused ourselves
  const selRef = useRef(selected);
  selRef.current = selected;

  const totalMins = (GRID_CLOSE - OPEN) * 60;
  const trackW = Math.max(320, QUARTER_HOURS.length * PX_PER_QUARTER);
  const openM = OPEN * 60;

  const xOf = (m) => ((m - openM) / totalMins) * trackW;
  const minsAt = (x) => openM + (x / trackW) * totalMins;
  const clampQ = (m) => Math.max(openM, Math.min(openM + totalMins, Math.round(m / 15) * 15));

  // Centre a time without notifying the parent (this IS the parent's value).
  //
  // v17.6.0: honours the app's "Reduce animations" setting, like every other
  // scripted scroll in the app (ListView's focus-into-view does the same check).
  // A smooth scroll is an animation; the setting exists because it costs real
  // frames on the restaurant's weaker tablets.
  function centre(m, smooth) {
    const el = scrollRef.current;
    if (!el) return;
    const glide = smooth && document.documentElement.dataset.motion !== "reduce";
    snappingRef.current = true;
    el.scrollTo({ left: xOf(m), behavior: glide ? "smooth" : "auto" });
    // Smooth scrolling keeps firing scroll events; let them settle before we
    // start listening again, or the snap re-arms itself in a loop.
    window.clearTimeout(guardTimer.current);
    guardTimer.current = window.setTimeout(() => { snappingRef.current = false; }, glide ? 320 : 60);
  }

  // v17.5.0 review fix: the guard above used to lift ONLY on its timer, so a
  // second scrub started within ~320ms of the previous snap was ignored —
  // measured: scrub to 16:00, release, scrub to 20:00, and the badge and the
  // floor plan sat on 16:00 until the window expired. Any fresh user input on
  // the scroller means the snap is over (a touch or a wheel also cancels the
  // browser's smooth scroll), so drop the guard immediately on those.
  function releaseSnapGuard() {
    window.clearTimeout(guardTimer.current);
    snappingRef.current = false;
  }

  // Programmatic re-centre only (date change, clock follow, the Now button).
  // Never on a user scroll — yanking the ruler under a finger is exactly what
  // makes a scrubber feel broken.
  //
  // v17.6.0: the Now button asks for a SMOOTH return (same glide as a tap-to-jump
  // or a scrub snap) instead of teleporting; the date change and the per-minute
  // clock follow stay instant. A per-minute follow step is ~1.6px, where a glide
  // would be indistinguishable from a jump but would keep the snap guard armed
  // for 320ms every minute.
  useLayoutEffect(() => {
    centre(selected, autoScrollSmooth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScrollKey]);

  useEffect(() => () => {
    window.clearTimeout(snapTimer.current);
    window.clearTimeout(guardTimer.current);
  }, []);

  function onScroll() {
    if (snappingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const q = clampQ(minsAt(el.scrollLeft));
    if (q !== selRef.current) onSelect(q);
    window.clearTimeout(snapTimer.current);
    snapTimer.current = window.setTimeout(() => { centre(clampQ(minsAt(el.scrollLeft)), true); }, SNAP_MS);
  }

  // Tap to jump: the click's x within the track, centred.
  function onTrackClick(e) {
    const el = scrollRef.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const x = el.scrollLeft + (e.clientX - b.left) - b.width / 2;
    const q = clampQ(minsAt(x));
    if (q !== selRef.current) onSelect(q);
    centre(q, true);
  }

  const nowInRange = isToday && nowMins >= openM && nowMins <= openM + totalMins;

  return (
    // v17.5.0 correction: no lane above the tape. The selected-time badge used
    // to live here on its own row; it now sits in PlanView's Now/legend row,
    // which was mostly empty anyway — same information, ~30px less height, and
    // the tape starts directly under the status chips.
    <div style={{ position: "relative", marginBottom: 8 }}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={onTrackClick}
        onPointerDown={releaseSnapGuard}
        onWheel={releaseSnapGuard}
        style={{
          overflowX: "auto", overflowY: "hidden",
          paddingInline: "50%",               // lets the ends reach the centre
          touchAction: "pan-x", WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",             // the centre marker IS the affordance
          cursor: "pointer",
          background: "var(--bg-soft)",
          borderRadius: R.card,
          border: "1px solid var(--border-soft)",
        }}
      >
        <div style={{ width: trackW + "px", height: H, position: "relative" }}>
          {/* Occupancy — a full-height tint behind each quarter rather than a
              separate bar, so the busy stretches read as shading ON the tape
              instead of a second chart competing with it. */}
          {occupancy ? QUARTER_HOURS.map((m) => {
            const v = occupancy[m] || 0;
            if (v <= 0) return null;
            return (
              <div key={"o" + m} style={{
                position: "absolute", top: 0, bottom: 0, left: xOf(m), width: PX_PER_QUARTER,
                background: "rgba(var(--status-confirmed-rgb), " + (0.05 + v * 0.22).toFixed(3) + ")",
              }} />
            );
          }) : null}

          {/* Tape ticks — mirrored top and bottom, tall on the hour. The pair
              of edges is what makes it read as a tape measure rather than a
              chart axis. */}
          {QUARTER_HOURS.map((m) => {
            const isHour = m % 60 === 0;
            const x = xOf(m);
            const col = isHour ? "var(--tl-gridline-hour)" : "var(--tl-gridline-quarter)";
            const len = isHour ? 13 : 7;
            const w = isHour ? 2 : 1;
            return (
              <div key={"t" + m}>
                <div style={{ position: "absolute", top: 0, left: x, width: w, height: len, background: col, borderRadius: 1 }} />
                <div style={{ position: "absolute", bottom: 0, left: x, width: w, height: len, background: col, borderRadius: 1 }} />
              </div>
            );
          })}

          {/* Hour labels, centred between the two tick rows. */}
          {QUARTER_HOURS.filter((m) => m % 60 === 0).map((m) => (
            <div key={"h" + m} style={{
              position: "absolute", left: xOf(m), top: "50%",
              transform: "translate(-50%,-50%)",
              fontSize: 12, fontWeight: 600, color: "var(--text-secondary)",
              fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", pointerEvents: "none",
            }}>{String(Math.floor(m / 60) % 24).padStart(2, "0") + ":00"}</div>
          ))}

          {/* Now marker — a full-height accent tick so you can always see where
              the clock is, even scrubbed far away from it. */}
          {nowInRange ? (
            <div style={{
              position: "absolute", left: xOf(nowMins), top: 0, bottom: 0,
              width: 2, background: "var(--tl-now-line)",
              borderRadius: 1, pointerEvents: "none", opacity: 0.9,
            }} />
          ) : null}
        </div>
      </div>

      {/* The fixed centre marker: a line straight down through the tape,
          outside the scroller so it stays put while the tape moves under it.
          `key={selected}` remounts it so the detent squash replays each time a
          mark passes. */}
      <div
        key={selected}
        className="mgt-detent"
        style={{
          position: "absolute", left: "50%", top: 4, height: H - 8,
          transform: "translateX(-50%)", transformOrigin: "center",
          width: 2, borderRadius: 1,
          background: S.accent, pointerEvents: "none",
        }}
      />
    </div>
  );
}
