// src/components/LateBanner.jsx
// v16.1.1: the "Running late" banner — one row per TODAY'S confirmed booking that
// is past its start time (driven by App's lateMap: {id: "warn"|"noshow"}).
//
// Extracted from App.jsx's render-time `lateEntries` IIFE so each ROW can ease
// in AND out via Reveal: both directions need local lifecycle state because a
// row's <Reveal> is conditionally mounted, and a bare mount with show=true
// starts OPEN (no ease-in) while an unmount can't animate its collapse.
//
//   renderIds — the mounted rows: current late ids ∪ recently-departed (kept
//     ~PRUNE_MS so their collapse finishes before unmount).
//   openIds   — the SUBSET whose Reveal is open (show=true). A NEWCOMER is added
//     to renderIds but NOT to openIds, so its Reveal mounts CLOSED; the opener
//     effect then adds it on the next frame → it eases IN. Rows present at the
//     banner's first mount seed openIds too, so they don't per-row animate (the
//     outer <Reveal show={hasLate}> in App eases the whole banner in). A DEPARTED
//     id is removed from openIds (eases OUT) then pruned from renderIds.
//
//   `prevKeys` diffs each lateMap key-set change (the effect is keyed on a stable
//   `sig` string, NOT the fresh-every-render lateMap object, so it fires only on
//   a membership change — a warn→noshow value flip re-renders but doesn't churn
//   the lifecycle). The diff is computed against prevKeys.current, never by
//   reading state in the effect, and never as a side-effect inside a setState
//   updater (the app-wide gotcha).
//
// The No-show button (offerNoShow = lateMap[id]==="noshow", read live from the
// prop) slides in via Presence, matching the Today button. onNoShow(id) →
// doCancelBooking(id, true).

import { useState, useRef, useEffect } from "react";
import { Reveal, Presence, mkBtn } from "./atoms";
import { lateMins } from "../lib/booking-logic";
import { BTN } from "../lib/constants";

const PRUNE_MS = 350;   // > Reveal's ~300ms collapse, so a departed row finishes easing out

export function LateBanner({ lateMap, bookings, nowMins, onNoShow }) {
  const [renderIds, setRenderIds] = useState(function () { return Object.keys(lateMap); });
  const [openIds, setOpenIds] = useState(function () { return new Set(Object.keys(lateMap)); });
  const prevKeys = useRef(Object.keys(lateMap));
  const timers = useRef({});

  // Stable membership signature — the effect keys on this, not the lateMap object
  // (which is a fresh reference every App render). Sorted so key order can't churn it.
  const sig = Object.keys(lateMap).slice().sort().join(",");

  // ── Membership diff: add newcomers, collapse + prune departures ────────────
  useEffect(function () {
    const cur = Object.keys(lateMap);
    const curSet = new Set(cur);
    // Newcomers → mount a CLOSED row (added to renderIds only; the opener effect
    // adds it to openIds next frame → ease-in).
    const newcomers = cur.filter(function (id) { return prevKeys.current.indexOf(id) === -1; });
    if (newcomers.length) {
      setRenderIds(function (prev) {
        const next = prev.slice();
        newcomers.forEach(function (id) { if (next.indexOf(id) === -1) next.push(id); });
        return next;
      });
    }
    // Any current id cancels a pending prune (covers a returning id).
    cur.forEach(function (id) {
      if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
    });
    // Departed → collapse (drop from openIds) + schedule prune from renderIds.
    const departed = prevKeys.current.filter(function (id) { return !curSet.has(id); });
    if (departed.length) {
      setOpenIds(function (prev) {
        const next = new Set(prev);
        departed.forEach(function (id) { next.delete(id); });
        return next;
      });
      departed.forEach(function (id) {
        if (!timers.current[id]) {
          timers.current[id] = setTimeout(function () {
            delete timers.current[id];
            setRenderIds(function (prev) { return prev.filter(function (x) { return x !== id; }); });
          }, PRUNE_MS);
        }
      });
    }
    prevKeys.current = cur;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` is the stable key-set signature of lateMap
  }, [sig]);

  // ── Opener: on the next frame, open any rendered row that is late but closed ──
  // (i.e. a just-mounted newcomer) so its Reveal transitions 0fr→1fr → ease-in.
  useEffect(function () {
    const toOpen = renderIds.filter(function (id) { return !!lateMap[id] && !openIds.has(id); });
    if (!toOpen.length) return undefined;
    const r = requestAnimationFrame(function () {
      setOpenIds(function (prev) {
        const next = new Set(prev);
        toOpen.forEach(function (id) { next.add(id); });
        return next;
      });
    });
    return function () { cancelAnimationFrame(r); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lateMap read live; keyed on renderIds/openIds/sig
  }, [renderIds, openIds, sig]);

  // Clear any pending prune timers on unmount.
  useEffect(function () {
    return function () {
      Object.keys(timers.current).forEach(function (id) { clearTimeout(timers.current[id]); });
      timers.current = {};
    };
  }, []);

  if (renderIds.length === 0) return null;
  const byId = new Map(bookings.map(function (b) { return [b.id, b]; }));

  return (
    <div style={{ background: "var(--app-overlap-bg)", border: "2px solid var(--app-overlap-border)", borderRadius: 14, padding: "10px 14px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--warn-text)", marginBottom: 2 }}>Running late</div>
      {renderIds.map(function (id) {
        const b = byId.get(id);
        const offerNoShow = lateMap[id] === "noshow";
        return (
          <Reveal key={id} show={openIds.has(id)}>
            {b ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "8px 12px", borderRadius: 12, background: "var(--warn-bg)", border: "1px solid var(--warn-border)", marginTop: 6 }}>
                <span style={{ fontSize: 13, color: "var(--warn-text)", fontWeight: 600, flex: "1 1 auto", minWidth: 0 }}>{b.name + " (" + b.time + ") — " + lateMins(b, nowMins) + " min late"}</span>
                <Presence show={offerNoShow} inClass="mgt-slide-in" outClass="mgt-slide-out" outMs={190} tag="span">
                  <button
                    onClick={function () { onNoShow(id); }}
                    className="mgt-hover-scale"
                    style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: BTN.orange })}>No show</button>
                </Presence>
              </div>
            ) : null}
          </Reveal>
        );
      })}
    </div>
  );
}
