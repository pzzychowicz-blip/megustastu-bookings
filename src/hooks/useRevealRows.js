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
// An optional second argument `resetKey` marks a wholesale REPLACEMENT of the
// list rather than a change to it — see the block in the body for what that
// distinction is worth and why it cannot be an effect (v17.15.0).
//
// `opts.instantIn` (v17.6.0-wa-sandbox) makes the lifecycle ASYMMETRIC: a
// newcomer is added to renderIds and openIds in the SAME commit, so its Reveal
// mounts already open (show=true at mount → Reveal's state initializers, no
// transition) and the row simply appears at full height. Departures are
// unaffected — they still collapse. Patryk on the WA conversation list: the
// expand-back on the way in read as too much movement, since the rows below are
// already sliding to make room (useFlip) and the growing row added a second
// motion on top of that.
//
// `sig` is a stable, sorted membership signature — the effects key on it, NOT the
// fresh-every-render ids array, so a value-only change (e.g. warn→noshow, or a
// countdown tick) re-renders without churning the lifecycle. The membership diff
// is computed against prevKeys.current, never by reading state inside an updater
// (the app-wide set()-in-updater gotcha applies to any side-effect-in-updater).

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { REVEAL_EXIT_MS, exitHold } from "../lib/constants";

// v17.15.0: derived, not typed. This was 350, chosen as "> Reveal's ~300ms
// collapse" — a literal encoding of the OLD --t-shift. `Reveal` now takes
// --t-reveal (520ms) and holds a leaving node for REVEAL_EXIT_MS, so 350 would
// have unmounted every departing banner row at ~two thirds of its collapse. A
// row must outlive the Reveal inside it, so this IS that number: same source,
// no second copy to keep in step.
const PRUNE_MS = REVEAL_EXIT_MS;

// `opts.speed` (17.15.0-wa-sandbox) names which entry of the `M` scale the
// caller's own <Reveal> runs on, so the prune window can be derived from the
// SAME entry. The sandbox used to pass a `pruneMs` number here to match a
// `ms` number there — two hand-kept halves of one fact, which is the defect
// v17.15.0's named `speed` exists to remove. A row must outlive the Reveal
// inside it; naming the speed once is what guarantees it still does when the
// token moves.
export function useRevealRows(ids, resetKey, opts) {
  const speed = (opts && opts.speed) || "reveal";
  const instantIn = !!(opts && opts.instantIn);
  const pruneMs = speed === "reveal" ? PRUNE_MS : exitHold(speed);
  const [renderIds, setRenderIds] = useState(function () { return ids.slice(); });
  const [openIds, setOpenIds] = useState(function () { return new Set(ids); });
  const prevKeys = useRef(ids.slice());
  const timers = useRef({});

  // ── A REPLACEMENT is not a change (v17.15.0) ────────────────────────────────
  // Everything above is for a row ARRIVING or RESOLVING while you watch: it
  // holds a departed id mounted so its Reveal can finish collapsing, and mounts
  // a newcomer closed so it can ease open. Applied to a list that was REPLACED
  // wholesale — the notification strip when you change the viewed date — it is
  // wrong twice over, and both halves were measured live going 22 -> 23 August:
  //
  //   * The list you LEFT stays on screen for the length of its collapse. For
  //     ~550ms the strip read "Running late" — the new day's heading, taken
  //     live — above a body about a table reshuffle on the day just left. That
  //     is not slow motion, it is the wrong information.
  //   * Departures and arrivals overlap, so the box passes through a state that
  //     exists on NEITHER side: two sections, each wearing the sub-header a
  //     lone section does not get, under a lid reading "Notifications". The
  //     pane travelled 70px of height to finish 2px from where it started,
  //     reversing direction twice across 1.15s — under a 240ms view slide.
  //
  // `resetKey` says "this is a different list, not a changed one". On a change
  // of it the lifecycle re-seeds exactly as it does on FIRST MOUNT — every
  // present id rendered and open, nothing pending — which is what the two
  // initializers above already spell out. Ids common to both lists keep their
  // place untouched, so a notification that is equally true on both days does
  // not blink.
  //
  // The re-seed runs DURING RENDER (React's documented "adjust state when a
  // prop changes"), not from an effect, and that is load-bearing rather than
  // stylistic: it makes the first COMMITTED dom the new list, so the caller's
  // own layout effect can measure the height it is leaving against the height
  // it is arriving at and ease between them in one move. From an effect the
  // re-seed lands a commit late, and the height measured in between belongs to
  // the two-section state nobody was ever meant to see.
  const [prevReset, setPrevReset] = useState(resetKey);
  if (resetKey !== prevReset) {
    setPrevReset(resetKey);
    // Only when the list ACTUALLY differs (/code-review). Two days can carry
    // the same sections — "Working offline", a reminder that fires on both —
    // and re-seeding those hands every consumer a fresh array and a fresh Set
    // describing a list that did not change, invalidating anything memoized on
    // their identity. The scan is at most a handful of ids and runs once per
    // reset, never per render.
    const settled = renderIds.length === ids.length
      && renderIds.every(function (id, i) { return id === ids[i]; })
      && openIds.size === ids.length
      && ids.every(function (id) { return openIds.has(id); });
    if (!settled) {
      setRenderIds(ids.slice());
      setOpenIds(new Set(ids));
    }
  }

  // The bookkeeping that re-seed implies, done where a ref may legally be
  // written: after the commit, before paint. Both halves have to happen, and
  // neither may happen a moment later than this.
  //
  //   prevKeys  is what the membership diff below reads as "the list last
  //             seen". Left describing the day we just left, that effect would
  //             call every id on the new day a newcomer and every id on the old
  //             one a departure, and promptly re-create the exact churn the
  //             re-seed exists to skip. It is safe to write here and only here
  //             because EVERY layout effect runs before ANY passive effect, so
  //             this lands ahead of the diff in the same commit.
  //   timers    a prune scheduled before the reset would fire against the NEW
  //             list and drop an id that legitimately belongs to it — and since
  //             prevKeys no longer sees that id as a newcomer, nothing would
  //             put it back. The row would just be missing until the next
  //             membership change.
  //
  // The first version wrote both during render, next to the setState calls. It
  // worked, and it is still the wrong place: a render may be discarded and
  // re-run, and a ref written there survives that.
  useLayoutEffect(function () {
    prevKeys.current = ids.slice();
    Object.keys(timers.current).forEach(function (id) { clearTimeout(timers.current[id]); });
    timers.current = {};
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ids` is read live; this fires on a reset, never on a content change
  }, [prevReset]);

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
      // Asymmetric mode: open in the SAME commit as the mount. Both updaters
      // batch, so the row's <Reveal> is first rendered with show=true and its
      // useState initializers make it open+revealed with no transition to run.
      // (A row that departs and returns BEFORE its prune is still mounted and
      // mid-collapse, so it eases the rest of the way open — it cannot teleport,
      // and that is the right behaviour for a genuinely interrupted collapse.)
      if (instantIn) {
        setOpenIds(function (prev) {
          const next = new Set(prev);
          newcomers.forEach(function (id) { next.add(id); });
          return next;
        });
      }
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
          }, pruneMs);
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
