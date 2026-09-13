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
  ref, push, set, get, remove, onValue, query,
  orderByChild, startAt, endAt, equalTo, limitToLast, serverTimestamp,
} from "firebase/database";
import { db, auth } from "../firebase";
import { dbError } from "../lib/dbError";
import { setActivitySink } from "../lib/activitySink";
import { PRUNE_AFTER_MS, isPrunable } from "../lib/activity";

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

// ── ERASURE ─────────────────────────────────────────────────────────────────
//
// "Delete customer & all data" anonymises the guest's BOOKINGS, and the log
// follows from that for free almost everywhere: its text holds `{b:<id>}`
// tokens resolved against the live list, so an anonymised booking reads "Data
// removed" in the log with nothing having been rewritten.
//
// The exception is the entry for a DELETED booking, which has no row left to
// resolve against and therefore carries `subject.name` — the one piece of
// personal data the log stores. `guestKey` is the indexed field that finds it.
//
// **A LIST of keys, not one.** `matchesIdentity` matches a normalised phone AND
// every `guestIds` entry, because a customer can have absorbed more than one
// guest group; its own comment says "Delete must reach every id the row is
// showing, or 'delete all data' leaves some". Erasing under one key would
// reproduce that defect one collection over — and a missed erasure looks
// exactly like a successful one, since neither shows anything on screen.
//
// One-shot `get()` rather than `onValue`: this is an erasure, not a
// subscription, and a listener left attached to it would be a listener nobody
// detaches.
export function redactGuest(keys) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  list.forEach(function (k) {
    const q = query(ref(db, "activity"), orderByChild("guestKey"), equalTo(String(k)));
    get(q).then(function (snap) {
      snap.forEach(function (child) {
        const v = child.val();
        // Only entries that actually hold a name, so the write is not attempted
        // on every entry the guest ever touched.
        if (!v || !v.subject || !v.subject.name) return;
        set(ref(db, "activity/" + child.key + "/subject/name"), "Data removed")
          .catch(function (err) {
            // Loud, because this one matters: a refused redaction means a
            // guest's name is still in the log after they asked for it to go.
            console.warn("[activity] could NOT redact entry " + child.key, err);
          });
      });
    }).catch(function (err) {
      console.warn("[activity] could not search the log for " + k, err);
    });
  });
}

// ── THE 12-MONTH PRUNE ───────────────────────────────────────────────────────
//
// Run when an ADMIN opens the log — there is no server-side scheduler on this
// plan, so the retention promise is kept by the app, and the rules are what stop
// anyone else keeping it differently: a delete is refused unless the caller is
// an admin AND the entry is genuinely older than a year.
//
// Bounded on purpose. `endAt(cutoff)` asks only for what is prunable rather than
// reading the node and filtering, and the batch cap means a log left unpruned
// for years is cleared over several opens instead of in one storm of deletes.
export const PRUNE_BATCH = 200;

export function pruneActivity() {
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  const q = query(
    ref(db, "activity"), orderByChild("at"), endAt(cutoff), limitToLast(PRUNE_BATCH)
  );
  return get(q).then(function (snap) {
    const olds = [];
    snap.forEach(function (child) {
      // The client half of the rule, so the app asks only for what will be
      // allowed — `isPrunable` and the rule's `at < now - a year` are the same
      // sentence in two languages.
      if (isPrunable(child.val(), Date.now())) olds.push(child.key);
    });
    return Promise.all(olds.map(function (id) {
      return remove(ref(db, "activity/" + id)).catch(function () {
        // Refused (not an admin, or the entry is not old enough after all).
        // Silent: the prune is housekeeping and must never interrupt anybody.
      });
    })).then(function () { return olds.length; });
  }).catch(function () { return 0; });
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
  // v18.0.0 session 10 (/code-review): `enabled` is not the whole
  // precondition. A non-finite bound is a THROW from `startAt`, not an empty
  // result — and a throw here is a throw inside an effect, which the error
  // boundary answers by unmounting the app. The caller guards its own day as
  // well; this is the module-level half, because this is the only Firebase
  // QUERY in the app and the failure mode is a blank screen rather than a
  // missing row.
  //
  // ONE derivation rather than a second guard inside the effect: `key` has to
  // agree with it, or a withheld query leaves the stored answer permanently
  // mismatched and `loading` true for ever.
  const ready = !!enabled && Number.isFinite(from) && Number.isFinite(to);
  const key = ready ? from + "" + to : null;

  useEffect(function () {
    if (!ready) return undefined;
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
  }, [from, to, ready, key]);

  const fresh = state.key === key;
  return {
    rows: fresh ? state.rows : EMPTY_ROWS,
    loading: ready && !fresh,
  };
}
