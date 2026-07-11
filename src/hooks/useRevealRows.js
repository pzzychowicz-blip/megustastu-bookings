// src/hooks/useRevealRows.js
//
// v16.3.0 — the per-row ease-in / ease-out lifecycle shared by the Running-late
// banner (LateBanner) and the waitlist "table free" banner (WaitAvailBanner).
// Extracted VERBATIM from LateBanner's v16.1.1 internals so both banners animate
// identically (one implementation of a subtle pattern, per the project rules).
//
// Given the current set of visible ids, returns { renderIds, openIds }:
//   renderIds — the MOUNTED rows: current ids ∪ recently-departed (kept ~PRUNE_MS
//     so their <Reveal> collapse finishes before unmount).
//   openIds   — the SUBSET whose Reveal is open (show=true). A NEWCOMER is added
//     to renderIds but NOT openIds, so its Reveal mounts CLOSED; the opener effect
//     adds it next frame → it eases IN. Rows present at first mount seed openIds
//     (so an outer <Reveal show={hasAny}> eases the whole banner, not each row).
//     A DEPARTED id is removed from openIds (eases OUT) then pruned from renderIds.
//
// `sig` is a stable, sorted membership signature — the effects key on it, NOT the
// fresh-every-render ids array, so a value-only change (e.g. warn→noshow, or a
// countdown tick) re-renders without churning the lifecycle. The membership diff
// is computed against prevKeys.current, never by reading state inside an updater
// (the app-wide set()-in-updater gotcha applies to any side-effect-in-updater).

import { useState, useRef, useEffect } from "react";

const PRUNE_MS = 350; // > Reveal's ~300ms collapse, so a departed row finishes easing out

export function useRevealRows(ids) {
  const [renderIds, setRenderIds] = useState(function () { return ids.slice(); });
  const [openIds, setOpenIds] = useState(function () { return new Set(ids); });
  const prevKeys = useRef(ids.slice());
  const timers = useRef({});

  const sig = ids.slice().sort().join(",");

  // ── Membership diff: add newcomers, collapse + prune departures ────────────
  useEffect(function () {
    const cur = ids;
    const curSet = new Set(cur);
    const newcomers = cur.filter(function (id) { return prevKeys.current.indexOf(id) === -1; });
    if (newcomers.length) {
      setRenderIds(function (prev) {
        const next = prev.slice();
        newcomers.forEach(function (id) { if (next.indexOf(id) === -1) next.push(id); });
        return next;
      });
    }
    cur.forEach(function (id) {
      if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
    });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` is the stable key-set signature
  }, [sig]);

  // ── Opener: next frame, open any rendered row that is present but still closed ──
  useEffect(function () {
    const present = new Set(ids);
    const toOpen = renderIds.filter(function (id) { return present.has(id) && !openIds.has(id); });
    if (!toOpen.length) return undefined;
    const r = requestAnimationFrame(function () {
      setOpenIds(function (prev) {
        const next = new Set(prev);
        toOpen.forEach(function (id) { next.add(id); });
        return next;
      });
    });
    return function () { cancelAnimationFrame(r); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids read live; keyed on renderIds/openIds/sig
  }, [renderIds, openIds, sig]);

  // Clear pending prune timers on unmount.
  useEffect(function () {
    return function () {
      Object.keys(timers.current).forEach(function (id) { clearTimeout(timers.current[id]); });
      timers.current = {};
    };
  }, []);

  return { renderIds, openIds };
}
