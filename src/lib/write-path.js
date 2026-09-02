// src/lib/write-path.js
//
// v17.16.2 — the pure core of the bookings write path, extracted from
// `usePersistence.js`.
//
// Everything here decides whether, and in what shape, a booking reaches the
// server: which children changed, what stamp each carries, what CAS base it
// claims, whether a patch is a StrictMode echo of the one before it, whether a
// held write may be replayed again. All of it was module-private inside a React
// hook, which is why **737 lines that decide whether a booking reaches the
// server had never been executed by a test** — in the v17.15.7 crash test or any
// other. Every claim that report makes about the retry queue, the stale gate,
// the resync and the dedupe window was established by *reading the code*.
//
// Two independent crash-test sessions reached this conclusion for different
// reasons: 2A because the retry logic could not be attacked from outside, 2B
// because `pastCloseMins` — the one function in the repo that handled midnight
// correctly — was locked in the same file. (That one is now in booking-logic.js;
// see v17.16.2 commit 3.) It is the repo's own v17.8.0 rule — *logic that
// decides something the restaurant acts on does not live in a `useEffect`* —
// applied to the file that decides the most.
//
// ── What did NOT move, and why ───────────────────────────────────────────────
// The hook keeps its refs, its listeners, its effects and every `setState`. This
// module is pure functions over values: no `db`, no React, no I/O. The monotonic
// stamp counter is the one piece of state involved, and it is THREADED rather
// than hidden — `buildPatch` takes the last stamp and returns the next one, so
// the ref stays in the hook where refs belong and the arithmetic becomes
// something a test can drive. Restructuring the write path itself was
// deliberately NOT done here: this version already carries three behavioural
// fixes, and a bisect has to be able to tell them apart.

// v15.5.0: content signature of a booking EXCLUDING its `updatedAt` stamp, so the
// write-diff only flags bookings whose actual fields changed (not ones that merely
// carry a fresher server stamp). Booking objects are plain JSON values and unchanged
// ones are Object.assign({},b) copies (identical key order), so a stringify compare
// is stable here.
export function contentKey(b) {
  const c = Object.assign({}, b);
  delete c.updatedAt;
  return JSON.stringify(c);
}

// The diff predicate the per-node write uses.
export function bookingChanged(a, b) {
  return contentKey(a) !== contentKey(b);
}

// v15.5.0/v16.0.0: stamp a booking for a child write.
//
// `updatedAt` is monotonic and must clear two independent bars, which is why it
// is a three-way max rather than just `Date.now()`:
//   - strictly above this DEVICE's last issued stamp, so StrictMode's double
//     invoke gets a higher stamp on the second write instead of an equal one the
//     rule would reject;
//   - strictly above the BOOKING's own last-seen server value, so a device whose
//     clock runs behind still writes a stamp the server will accept.
//
// `baseUpdatedAt` is the v16.0.0 compare-and-swap base: the `updatedAt` of the
// version this device based its write on. The security rule requires it to equal
// the stored value, so a device holding a stale snapshot is refused server-side
// whatever its wall clock says — the hole the 2026-07-05 incident exposed, where
// a mere greater-than let any live-clock device overwrite content it never saw.
// **0 on create**, which since v17.16.1 the rules require explicitly (a deleted
// booking could otherwise be resurrected by any write carrying a numeric stamp).
//
// Pure: returns a copy and the stamp to carry forward. Never mutates its input —
// the real value lands back in state via the onValue echo.
export function stampForWrite(b, old, lastStamp, nowMs) {
  const t = Math.max(nowMs, ((old && Number(old.updatedAt)) || 0) + 1, lastStamp + 1);
  return {
    booking: Object.assign({}, b, {
      updatedAt: t,
      baseUpdatedAt: old ? (Number(old.updatedAt) || 0) : 0,
    }),
    lastStamp: t,
  };
}

// Diff prev vs computed → a multi-path patch of ONLY changed children
// ({id: stampedBooking}) plus deletions ({id: null}). An empty patch means no
// write at all — two devices editing DIFFERENT bookings write disjoint paths and
// Firebase merges them, which the old whole-array CAS could not do.
//
// Returns the next stamp alongside the patch. The caller owns the ref.
export function buildPatch(prev, computed, lastStamp, nowMs) {
  const d = diffChanged(prev, computed);
  const patch = {};
  let stamp = lastStamp;
  d.ids.forEach(function (id) {
    const b = d.byId[id];
    if (!b) { patch[id] = null; return; } // in prev, not in computed — a deletion
    const r = stampForWrite(b, d.prevById[id], stamp, nowMs);
    patch[id] = r.booking;
    stamp = r.lastStamp;
  });
  return { patch: patch, lastStamp: stamp };
}

// v17.16.9: ONE pass over the diff, feeding both public callers.
//
// `ids` is which children a write would touch — changed, added or deleted, in
// `computed` order with the deletions last. `byId` is the version to WRITE for
// each, `prevById` the version it is based on.
//
// This was `buildPatch`'s own loop until a second caller appeared: a parked
// write (CT-2A-07, below) has to name the change it is holding, and it is
// parked at three sites, only one of which has a patch in hand. Two copies of a
// diff is how the banner ends up naming a different booking from the one the
// patch carries.
//
// **`byId` records only the CHANGED occurrences, and that is not a detail.**
// The first version of this extraction built it from every entry in `computed`,
// which is identical for any well-formed input and diverges on a DUPLICATE id:
// with `prev = [{id:"x",size:2}]` and `computed = [{id:"x",size:4},
// {id:"x",size:2}]`, the original loop stamped the changed occurrence and
// skipped the unchanged one (writing size 4), while a plain last-wins map
// writes size 2 — silently discarding the edit. The KEY SETS are identical
// either way, which is exactly why the `changedIds`/`buildPatch` agreement test
// could not see it: it compares `Object.keys(patch)`. Duplicate ids are a state
// this repo already tracks as reachable (a `genId()` collision — see
// `ROADMAP.md`), so an equivalence contract has to hold there too.
function diffChanged(prev, computed) {
  const prevById = {};
  (prev || []).forEach(function (b) { if (b && b.id != null) prevById[b.id] = b; });
  const seen = {};
  const ids = [];
  const byId = {};
  (computed || []).forEach(function (b) {
    if (!b || b.id == null) return;
    seen[b.id] = true;
    const old = prevById[b.id];
    if (!old || bookingChanged(old, b)) { ids.push(b.id); byId[b.id] = b; }
  });
  Object.keys(prevById).forEach(function (id) { if (!seen[id]) ids.push(id); });
  return { ids: ids, byId: byId, prevById: prevById };
}

// The id list on its own — `buildPatch`'s diff, exposed for anything that needs
// to know WHAT a write touches without building the patch.
export function changedIds(prev, computed) {
  return diffChanged(prev, computed).ids;
}

// v17.16.9: what the parked-write banner calls the change it is holding.
//
// **Deliberately NOT `describeBooking`**, which is the app's one answer to
// "what does a booking SOUND like" and returns five clauses — name, time,
// size, tables, status. That answers a different question. This one has to
// IDENTIFY which of the day's changes failed, in one line of a red banner, and
// "Pau Estévez, 20:00, 4 guests, table 3, seated" buries the identity inside a
// description. The same distinction `time-grid.js` records for
// `hourLabel`/`cutoffLabel`: two functions that look like copies, asked
// different questions. It also keeps this module dependency-free, which its
// header calls a property rather than an accident.
//
// **`prev` is read over `computed`, and the first draft had it the other way.**
// Naming the values being SAVED sounds right and is wrong here: the parked
// write was UNDONE, so the screen still shows the previous version, and the
// user has to find that. Measured live — seating a 19:30 booking shifts its
// time to now, so the banner named "P3 Smoke Test, 15:05" for a card reading
// 19:30. A CREATE has no `prev` entry and falls back to `computed`, which is
// the only version there has ever been.
//
// A write can touch many bookings (an optimiser reshuffle moves several), so
// the first is named and the rest counted — listing five in a banner is a list
// nobody reads.
export function describeWrite(prev, computed) {
  const d = diffChanged(prev, computed);
  if (!d.ids.length) return null;
  const ids = d.ids;
  // `prevById` first, `byId` only as the fallback — a create is the one case
  // with no previous version.
  const b = d.prevById[ids[0]] || d.byId[ids[0]];
  // The id is a poor name and a real fallback: `sanitize` guarantees a string
  // `name`, not a non-empty one, and a nameless booking must still be pointed at.
  const first = (b && [b.name, b.time].filter(Boolean).join(", ")) || String(ids[0]);
  if (ids.length === 1) return first;
  return first + " and " + (ids.length - 1) + " other" + (ids.length > 2 ? "s" : "");
}

// v16.0.0: the StrictMode dedupe signature. The dev double-invoked updater calls
// persist() twice with the same prev/computed; the two patches differ ONLY in
// their fresh `updatedAt` stamps — `contentKey` excludes those, and both carry
// the same content and the same consumed `baseUpdatedAt`.
export function patchSignature(patch) {
  return Object.keys(patch).sort().map(function (id) {
    return id + "=" + (patch[id] === null ? "null" : contentKey(patch[id]));
  }).join("|");
}

// How long two byte-identical patches are treated as the same write.
export const DEDUPE_WINDOW_MS = 2000;

// An identical signature inside the window IS the same write: dispatching it
// again would be refused by the CAS (its base is already consumed) and would
// churn a resync on every dev write. Skipping a byte-identical re-dispatch is
// prod-safe; a genuine A→B→A within the window is the known cost (CT-2A-08).
export function isDuplicatePatch(sig, last, nowMs, windowMs) {
  const w = windowMs == null ? DEDUPE_WINDOW_MS : windowMs;
  return !!last && sig === last.sig && (nowMs - last.at) < w;
}

// v15.2.0: the freshness gate. A tab frozen by OS sleep holds an old snapshot;
// on wake its clock tick would write that snapshot over fresher server data (the
// incident: a laptop asleep from ~18:00 overwrote a night of tablet bookings when
// it woke at ~01:30). The heartbeat bumps `lastBeat` every 10s, so a gap means
// the event loop was frozen.
//
// The threshold MUST stay well above the heartbeat interval — a backgrounded
// tab's timers throttle to ~60s, so anything at or below that would let ordinary
// backgrounding trip the gate on every device, every time.
export const STALE_GAP_MS = 90000;

export function isStaleGap(lastBeat, nowMs, gapMs) {
  return (nowMs - lastBeat) > (gapMs == null ? STALE_GAP_MS : gapMs);
}

// v15.4.0: how many times a blocked or server-rejected user write is replayed on
// freshly-resynced data before the automatic attempts stop.
//
// v17.16.9: what happens AFTER that changed. The item used to be dropped behind
// a banner naming no booking — so a change the user had just watched revert was
// reported to them as "Couldn't save a change" and nothing more (CT-2A-07; the
// register's own account of the mechanism is corrected at `parkedRef` in
// usePersistence.js, where it was measured). It is now PARKED: kept, named, and
// retryable or discardable by hand. The cap still bounds the AUTOMATIC
// attempts, which is what it was always for.
export const MAX_RETRIES = 3;

// The retry decision for one queued item: replay it, or report failure. Returns
// "retry" with the try count to carry, or "give-up". Split out because "capped at
// MAX_RETRIES" was a claim about a loop nothing could execute.
export function retryDecision(tries, max) {
  const cap = max == null ? MAX_RETRIES : max;
  return tries < cap ? { action: "retry", tries: tries + 1 } : { action: "give-up", tries: tries };
}
