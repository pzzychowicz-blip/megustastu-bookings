// src/hooks/useCrashTrail.js
//
// v18.15.0 — the admin's crash trail: how many crashes this person has not seen
// yet. A crash was visible only to someone who opened Settings → Admin → Open
// the log → Crashes, so a fault on the restaurant's tablet could sit unread for
// weeks. The count now shows on the Settings gear, the Admin tab, "Open the log"
// and the Crashes chip, and pressing the chip clears it (App's `onCrashesSeen`
// stores `latest` in the person's prefs, `crashSeenAt`).
//
// ONE listener, only while `enabled` (App passes `can("settingsAdmin")` and
// prefs loaded, so staff spend nothing, and the count never flashes every crash
// before `crashSeenAt` arrives). It asks the `kind` index for the newest
// CRASH_TRAIL_LIMIT crash entries, plus one, so the badge can tell an exact 50
// from more (the /code-review); `readCrashes` reads the same index whole for
// Download crash data. `crashGate` writes at most five a page load, so 50 is
// weeks of a bad day, and the badge says "50+" past it. The decision is pure:
// `crashBadge` in lib/crash-report.js.

import { useState, useEffect } from "react";
import { ref, query, orderByChild, equalTo, limitToLast, onValue } from "firebase/database";
import { db } from "../firebase";
import { dbError } from "../lib/dbError";
import { crashBadge } from "../lib/crash-report";

export const CRASH_TRAIL_LIMIT = 50;
const NONE = { count: 0, latest: 0, more: false };

export function useCrashTrail(enabled, seenAt) {
  const [entries, setEntries] = useState(null);
  useEffect(function () {
    if (!enabled) return undefined;
    const q = query(ref(db, "activity"), orderByChild("kind"), equalTo("crash"), limitToLast(CRASH_TRAIL_LIMIT + 1));
    return onValue(q, function (snap) {
      setEntries(Object.values(snap.val() || {}));
    }, dbError("activity (crash trail)"));
  }, [enabled]);
  // Stale entries from a previous `enabled` are ignored rather than cleared, so
  // nothing calls setState in the effect body.
  if (!enabled || !entries) return NONE;
  return crashBadge(entries, seenAt, CRASH_TRAIL_LIMIT);
}
