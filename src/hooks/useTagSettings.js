// src/hooks/useTagSettings.js
//
// v18.5.0 — `settings/tags` + `tagsRev`, the 10th settings node: the list of
// guest tags and occasion tags a booking can carry. `useVoucherDefaults`'s
// shape (loaded ref, revGuard CAS), with the pure half in `lib/tags.js`.
//
// Model: `{ v, guest: [{id, label}…], occasion: [{id, label}…] }` — see
// `lib/tags.js` for why a booking stores ids and why an absent node is the seed
// while a missing list is empty.
//
// ── TWO THINGS THIS HOOK DOES THAT ITS TEMPLATE DOES NOT ────────────────────
//
// 1. **An ABSENT node sets the state back to the seed.** The template keeps its
//    state when the snapshot is null, which is right for a node that only ever
//    appears. Here it matters: a write the database REFUSES is rolled back by
//    the SDK, which re-fires this listener with the stored value, and for a
//    node that was never saved that value is null. Keeping the state would
//    leave a tag on screen that no database holds, and a booking saved with its
//    id would carry a tag nothing can name. That is exactly the state between
//    this version's deploy and the rules being published.
//
// 2. **A refused write is said on screen** (`tagError`), for the same window:
//    the editor would otherwise show a tag appear and vanish with no reason.
//
// A save computes from the `listRef` mirror, never inside a `setState` updater
// (the root CLAUDE.md row on `set()` inside an updater), and the listener
// assigns the mirror on the line above its `setState`.

import { useState, useRef, useEffect, useCallback } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { dbError } from "../lib/dbError";
import { DEFAULT_TAG_LIST, sanitizeTagList, sameTagList } from "../lib/tags";
import { settingsWriteEntry } from "../lib/activity";
import { emitActivity } from "../lib/activitySink";

export function useTagSettings() {
  const [tagList, setTagList] = useState(DEFAULT_TAG_LIST);
  const [tagError, setTagError] = useState(null);
  const loaded = useRef(false);
  const revRef = useRef(0);
  const listRef = useRef(DEFAULT_TAG_LIST);

  useEffect(function () { return attachRev("settings/tags", revRef); }, []);

  useEffect(function () {
    const unsub = onValue(ref(db, "settings/tags"), function (snap) {
      // Absent → the seed (point 1 above); present → what it holds.
      const next = sanitizeTagList(snap.val());
      listRef.current = next;
      setTagList(next);
      loaded.current = true;
    }, dbError("settings/tags"));
    return unsub;
  }, []);

  // Takes the WHOLE next list (the editor builds it with `lib/tags.js`'s
  // addTag / renameTag / removeTag). Returns true when the list is as asked:
  // dispatched, or already equal.
  const saveTagList = useCallback(function (nextList) {
    if (!loaded.current) {
      console.warn("[SAFE] Refused to write the tag list — initial read has not completed yet.");
      return false;
    }
    const prev = listRef.current;
    const next = sanitizeTagList(nextList);
    if (sameTagList(prev, next)) return true;
    listRef.current = next;
    setTagList(next);
    setTagError(null);
    writeWithRev("settings/tags", next, revRef, function (err) {
      // The SDK has rolled the write back and the listener above has put the
      // stored list on screen again. Say why it moved.
      const denied = err && /permission/i.test(String(err.code || err.message || ""));
      setTagError(denied
        ? "The tag list was not saved: the database refused the change (permission denied)."
        : "The tag list was not saved. Check the connection and try again.");
    }, function () {
      const entry = settingsWriteEntry("settings/tags", prev, next);
      if (entry) emitActivity([entry]);
    });
    return true;
  }, []);

  const clearTagError = useCallback(function () { setTagError(null); }, []);

  return { tagList, saveTagList, tagError, clearTagError };
}
