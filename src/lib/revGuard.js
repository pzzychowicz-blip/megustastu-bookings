// src/lib/revGuard.js
//
// v16.0.0 (stale-overwrite protection, layer 2) — shared revision-CAS writer for
// every WHOLE-NODE Firebase collection (tableBlocks, waitlist, reminders,
// reminderFires, and the four settings/* nodes). The per-booking node has its own
// finer-grained CAS (`baseUpdatedAt`, usePersistence.js); everything that is
// written as one blob gets THIS.
//
// Pattern (the proven v15.3.0 `bookingsRev` compare-and-swap, generalised):
// each protected node <path> has a sibling integer <path>Rev. Every write is an
// atomic multi-path update({ <path>: value, <path>Rev: base+1 }) and the Security
// Rule (database.rules.json) rejects it unless the rev is EXACTLY stored+1 — so a
// device holding a stale snapshot (its rev ref is behind the server's) can never
// overwrite fresher data, no matter what its wall clock says. This is what closes
// the 2026-07-05 incident class (a sleeping laptop's wake writing its old
// snapshot over a night of tablet work) for the whole-node collections.
//
// Recovery is FREE: the RTDB SDK rolls back a server-rejected write locally and
// re-fires the node's + the rev's onValue listeners with the true server values —
// so the consumer hook's existing snapshot handler restores its state, and
// attachRev re-anchors the rev ref. onReject is for logging / the red
// writeWarning banner only.
//
// The rev ref is advanced OPTIMISTICALLY on write (v15.3.0 technique): the next
// write in the same tick chains base+2, so back-to-back writes and StrictMode's
// dev double-invoke are both accepted instead of self-rejecting; a rejection is
// re-anchored by the rollback echo.
//
// Deploy note: writes carry the rev bump immediately, but the CAS only ENFORCES
// once the matching Security Rules are applied (manual console step — see
// database.rules.README.md; app first, rules second). Until then the rev rides
// along harmlessly. First-ever write creates the rev node at 1 (rule allows).

import { ref, onValue, update } from "firebase/database";
import { db } from "./../firebase";
import { dbError, describeWriteError } from "./dbError";

// Subscribe `revRef.current` to <path>Rev. Plain assignment (not max): a
// server rejection's rollback echo must be able to LOWER an optimistically
// advanced ref back to the true server value. Returns the unsubscribe fn.
export function attachRev(path, revRef){
  return onValue(ref(db, path + "Rev"), function(snap){
    const v = snap.val();
    revRef.current = typeof v === "number" ? v : 0;
  },dbError(path+"Rev"));
}

// Atomic { node, nodeRev: base+1 } write. `value` may be an empty array/object —
// RTDB stores that as a node DELETE, which skips the node's own .validate.
//
// v17.16.1 corrects what this comment used to claim next: "but the rev child's
// rule still enforces +1, so the CAS holds even for wipes." That is true of
// THIS function, which always sends both keys — and false of the RULES, which
// is where it read as a guarantee. A client that simply calls `remove()` on the
// node and omits the rev is not constrained by the rev's rule at all: verified
// against the emulator, `tableBlocks` is gone and `tableBlocksRev` is left at
// its old value (CT-2A-06, tests/rules/database-rules.test.js).
//
// It CANNOT be fixed by adding a rule, which is the part worth knowing: RTDB
// write permission cascades from the root's `.write: auth != null` and cannot
// be revoked lower down — measured, a child `.write: false` does not deny the
// delete. Closing it means moving `.write` off the root and granting it per
// path, which is a restructure with its own hazards (see ROADMAP). Until then:
// the app's write path is safe because it goes through here, and the rules are
// not what makes it so.
// Returns the update() promise (already .catch-handled via onReject).
export function writeWithRev(path, value, revRef, onReject){
  const nextRev = (revRef.current || 0) + 1;
  revRef.current = nextRev; // optimistic — see header
  const patch = {};
  patch[path] = value;
  patch[path + "Rev"] = nextRev;
  return update(ref(db), patch).catch(function(err){
    // v17.16.13: `err` was in hand here and the message threw it away, naming
    // "stale revision" for what is equally often a failed .validate or an
    // undeployed rule. The rollback claim stays — that one IS measured: the SDK
    // rolls a rejected write back locally and re-fires the node's listeners.
    console.warn(describeWriteError(path, err) + " Local state restored from the server echo.");
    if(onReject) onReject(err);
  });
}
