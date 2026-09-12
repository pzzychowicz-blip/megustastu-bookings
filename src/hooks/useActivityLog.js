// src/hooks/useActivityLog.js — v18.0.0 session 8 (item 1)
//
// The two halves of the activity log that need Firebase: WRITING an entry, and
// READING a day of them. Everything that decides what an entry SAYS is pure and
// lives in `lib/activity.js`; this file only carries it to the database and
// back.
//
// ── WRITING ─────────────────────────────────────────────────────────────────
// `useActivityLog()` installs `logActivity` as the module-level sink that every
// writer in the app emits into (see `lib/activitySink.js` for why it is a sink
// rather than a prop). Until this hook mounts there IS no sink and `emitActivity`
// is a no-op — which is the normal state for every write before the app is
// ready, and is why the sink stays silent about it.
//
// **Three fields are added HERE and nowhere else**, because only this file has
// the auth context and the server's clock:
//
//   at     serverTimestamp()  — the rules require `at === now`, and only the
//                              SENTINEL satisfies that. A client `Date.now()`
//                              is refused (measured against the emulator), and
//                              deliberately so: an entry filed before the thing
//                              it describes happened is worse than no entry.
//   uid    auth.currentUser.uid
//   email  auth.currentUser.email
//
// The rules require the last two to equal `auth.uid` and `auth.token.email`
// exactly, which is what stops an account writing the log as somebody else.
//
// **The `getUser()` fallback must NOT be used here.** App's `getUser()` returns
// the literal "staff" when `auth.currentUser` is null, which is right for a
// history entry's `by` field and fatal here: "staff" is not the signed-in
// account's email, the rule refuses the write, and `emitActivity`'s try/catch
// swallows the refusal — so the entry would vanish with nothing on screen and
// nothing in the console. With no signed-in user there is no honest author, so
// nothing is written at all.
//
// ── READING ─────────────────────────────────────────────────────────────────
// `useActivityFeed` is the app's FIRST Firebase query — every other listener in
// the codebase is a plain `onValue(ref(db, path))`. Two consequences worth
// knowing: it needs the `.indexOn: ["at", "guestKey"]` that ships in
// `database.rules.json`, or the server sorts client-side and says so in a
// warning; and it is mounted ONLY while the log is open, because it is the one
// listener in the app whose data nothing else needs.
import { useState, useEffect } from "react";
import {
  ref, push, set, onValue, query, orderByChild, startAt, endAt, limitToLast, serverTimestamp,
} from "firebase/database";
import { db, auth } from "../firebase";
import { dbError } from "../lib/dbError";
import { setActivitySink } from "../lib/activitySink";

// At most this many rows for one day. A day of ordinary service is a few dozen
// entries; the cap exists so a pathological day cannot pull the whole node into
// a modal. `limitToLast` keeps the NEWEST, which is the half anybody wants.
export const FEED_LIMIT = 1000;

// One entry per push key. Written with `set` on a pushed ref rather than
// `push(ref, value)` so the two steps are separable and the key is in hand —
// the same shape `usePresence` uses for its own per-connection child.
function logActivity(entries) {
  const u = auth.currentUser;
  // No signed-in account = no honest author. See the header: substituting
  // anything here produces a write the rules refuse and the sink swallows.
  if (!u || !u.uid || !u.email) return;
  (Array.isArray(entries) ? entries : []).forEach(function (e) {
    if (!e || !e.kind || !e.text) return;
    const row = push(ref(db, "activity"));
    set(row, Object.assign({}, e, {
      at: serverTimestamp(), uid: u.uid, email: u.email,
    })).catch(function (err) {
      // Reported and never rethrown. A refused log entry must not disturb the
      // write it describes — which has already landed by the time we are here.
      console.warn("[activity] entry refused by the server", err);
    });
  });
}

/**
 * Install the writer for as long as the app is mounted. Passing null on unmount
 * is what stops a stale closure outliving its React tree.
 */
export function useActivityLog() {
  useEffect(function () {
    setActivitySink(logActivity);
    return function () { setActivitySink(null); };
  }, []);
}

/**
 * One day (or any [from, to] ms range) of entries, newest first.
 * `enabled` is false whenever the log is closed, and the listener is not
 * attached at all then — this is the only listener in the app that is not
 * permanent, because it is the only one whose data no other surface reads.
 */
const EMPTY_ROWS = [];

export function useActivityFeed({ from, to, enabled }) {
  // ── ONE state, KEYED to the query it answers ────────────────────────────────
  // Not `rows` plus a `loading` boolean, and the difference is two bugs rather
  // than a preference.
  //
  // A separate boolean has to be SET, and the only place to set it is the
  // effect body — which is a synchronous setState inside an effect
  // (`react-hooks/set-state-in-effect`, and it can cascade renders). Worse, it
  // leaves the two values free to disagree: on a day change or a reopen the
  // stored rows are still the PREVIOUS query's answer, so the panel shows
  // yesterday's entries under today's date for as long as the snapshot takes.
  //
  // Keying the stored answer to the query that produced it makes `loading` a
  // DERIVATION — "what I am holding is not an answer to what I am asking" —
  // which cannot disagree with the rows, needs no reset when the log closes,
  // and leaves `setState` where the warning itself says it belongs: inside the
  // subscription callback.
  const [state, setState] = useState({ key: null, rows: EMPTY_ROWS });
  const key = enabled ? from + "" + to : null;

  useEffect(function () {
    if (!enabled) return undefined;
    const q = query(
      ref(db, "activity"),
      orderByChild("at"), startAt(from), endAt(to), limitToLast(FEED_LIMIT)
    );
    // The third argument is not optional in this codebase: without it a
    // cancelled read fires nothing at all and the panel spins forever.
    const unsub = onValue(q, function (snap) {
      const out = [];
      // `snap.forEach` walks a query's children in QUERY order (ascending `at`),
      // which is not the order of `snap.val()`'s object keys — so the rows are
      // collected here and reversed, rather than sorted afterwards.
      snap.forEach(function (child) {
        const v = child.val();
        if (v) out.push(Object.assign({ id: child.key }, v));
      });
      out.reverse();
      setState({ key: key, rows: out });
    }, dbError("activity"));
    return unsub;
  }, [from, to, enabled, key]);

  const fresh = state.key === key;
  return {
    rows: fresh ? state.rows : EMPTY_ROWS,
    loading: !!enabled && !fresh,
  };
}
