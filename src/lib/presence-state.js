// src/lib/presence-state.js
//
// v17.8.0 — the presence node's READ model, extracted from usePresence.js so it
// can be tested.
//
// ── Why it moved ─────────────────────────────────────────────────────────────
// usePresence's v17.8.0 rewrite turned "who is connected" from a fact
// (onDisconnect removed the child, therefore anyone still listed is here) into
// an INFERENCE from timestamps — because onDisconnect leaks (see that file's
// header) and its absence was never proof of presence. An inference has edge
// cases: a pre-upgrade child with no `lastSeen`, a child with neither field, a
// clock offset that has not arrived yet, our own child which must never be
// pruned. All of that arithmetic sat inside an `onValue` callback in a
// Firebase-importing hook, where nothing could exercise it.
//
// The thresholds and the decisions are here; the hook keeps the subscription,
// the refs and the actual `remove()` calls.
//
// ── The asymmetry that shapes the whole thing ────────────────────────────────
// HIDING a device is free and reversible: the next 45s heartbeat brings it
// straight back. DELETING one is neither. So the two thresholds are deliberately
// far apart (PRUNE_MS is 4× STALE_MS), and the prune additionally refuses to run
// without a real server-clock offset — on a device whose clock runs fast, an
// assumed offset of 0 would make every live child look ancient and the prune
// would empty the node. Hiding is left ungated for the same reason it is
// cheap: it undoes itself.

// How often a live connection re-proves itself, and how long a child survives
// without doing so. STALE_MS is three missed beats — long enough that a brief
// stall or a slow write never blinks a real device out of the list, short
// enough that a closed tab is gone while someone is still looking at the popover.
export const BEAT_MS = 45 * 1000;
export const STALE_MS = 150 * 1000;
export const PRUNE_MS = 10 * 60 * 1000;

// The timestamp a child is judged by. `since` is the fallback for a child
// written by a pre-v17.8.0 client, which has no `lastSeen` — that keeps such a
// device visible for its first STALE_MS and then drops it until it reloads. A
// transitional cost on a handful of devices; the alternative (trusting a field
// that is never refreshed) is the exact bug this model exists to fix.
export function lastProof(v) {
  if (!v) return 0;
  if (typeof v.lastSeen === "number") return v.lastSeen;
  if (typeof v.since === "number") return v.since;
  return 0;
}

/**
 * Read the presence node.
 *
 * @param {object|null} node      the raw `presence` snapshot value
 * @param {number}      now       SERVER-corrected now (Date.now() + offset)
 * @param {string|null} myKey     this connection's push key, never pruned
 * @param {boolean}     canPrune  armed AND a real clock offset has arrived
 * @returns {{devices: Array, prunable: string[], mySince: number|null}}
 *   devices  — the rows to render, in node order
 *   prunable — keys the caller should remove() (empty unless canPrune)
 *   mySince  — our own child's resolved `since`, so the heartbeat can rewrite
 *              it verbatim instead of stamping a fresh one every 45s (which
 *              would pin every device to "just now" forever)
 */
export function presenceState(node, now, myKey, canPrune) {
  const devices = [];
  const prunable = [];
  let mySince = null;
  if (!node) return { devices, prunable, mySince };

  Object.keys(node).forEach(function (k) {
    const v = node[k] || {};
    const seen = lastProof(v);
    const mine = k === myKey;

    if (mine && typeof v.since === "number") mySince = v.since;

    // Never delete our own child, and never delete on an assumed clock.
    if (canPrune && !mine && seen && now - seen > PRUNE_MS) prunable.push(k);

    // A child with NO usable timestamp at all is hidden rather than trusted:
    // it cannot prove it is alive. It is deliberately not prunable either —
    // deleting on an absence of evidence is the one thing the asymmetry above
    // rules out.
    if (!seen || now - seen > STALE_MS) return;

    devices.push({
      key: k,
      email: v.email || "unknown",
      ua: v.ua || "Device",
      since: typeof v.since === "number" ? v.since : null,
      lastSeen: typeof v.lastSeen === "number" ? v.lastSeen : null
    });
  });

  return { devices, prunable, mySince };
}
