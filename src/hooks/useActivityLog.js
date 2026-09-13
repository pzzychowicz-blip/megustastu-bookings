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
//
// v18.0.0 session 11: the window is a RANGE and either end may be ABSENT, so
// the default question is "everything, newest first" rather than "one day".
// Patryk: *"Search box must search globally (as Find a booking does) not by
// date only. Filtering by date should be one of options."*
import { useState, useEffect } from "react";
import {
  ref, push, set, get, remove, onValue, query,
  orderByChild, startAt, endAt, equalTo, limitToLast, serverTimestamp,
} from "firebase/database";
import { db, auth } from "../firebase";
import { dbError } from "../lib/dbError";
import { setActivitySink } from "../lib/activitySink";
import { PRUNE_AFTER_MS, isPrunable } from "../lib/activity";

// ── PAGING: one GROWING query, not a cursor ─────────────────────────────────
//
// A page of rows. `loadOlder` raises the limit and the SAME listener re-answers;
// it does not fetch a second page and stitch it on. That costs re-reading the
// rows already in hand, and buys three things worth more than the bytes at this
// size:
//
//   • No cursor arithmetic. RTDB's `endAt(value, key)` paging has to dedupe its
//     boundary row, and `at` is a serverTimestamp — two entries written in the
//     same millisecond are not hypothetical, since `bookingWriteEntries` emits
//     several per save.
//   • The whole list stays LIVE. A stitched page is a frozen snapshot the
//     listener no longer maintains, so an entry arriving while the log is open
//     would show up in the newest page and nowhere else.
//   • The rows stay a pure function of (window, limit) — which is the property
//     the `win`/`limit` compare below rests on, and what lets a limit bump keep
//     the current rows on screen instead of blanking the panel.
//
// `limitToLast` keeps the NEWEST, which is the half anybody wants.
export const FEED_PAGE = 500;

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
 * Entries newest first over an OPEN range: `from` and `to` are ms and either
 * may be null for "no bound this side" — both null is the whole log.
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
  //
  // v18.0.0 session 11 splits that key in TWO — the WINDOW and the LIMIT —
  // because they are different kinds of change and one key could not tell them
  // apart. A new window is a new QUESTION: the stored rows are another range's
  // answer and must not be shown. A bigger limit is the SAME question asked
  // wider: the stored rows are a valid PREFIX of the answer coming, so blanking
  // them would flash the panel empty on every "Load older" — which is the thing
  // the keyed state exists to prevent, arriving by the other door.
  const [state, setState] = useState({ win: null, limit: 0, rows: EMPTY_ROWS });
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
  //
  // An ABSENT bound is null, and that is not the same as a BROKEN one. null
  // means "no bound this side" and is the resting state of both fields;
  // NaN is a date the caller could not parse. Only the second withholds the
  // query — and `Number.isFinite(null)` is false, so the two have to be told
  // apart here or the unbounded feed, which is now the DEFAULT, would never
  // run at all.
  const okFrom = from == null || Number.isFinite(from);
  const okTo = to == null || Number.isFinite(to);
  const ready = !!enabled && okFrom && okTo;
  const win = ready ? String(from) + "" + String(to) : null;

  // The limit is keyed to its window for the SAME reason as the rows, and it is
  // worth spelling out because the obvious alternative is a bug this file
  // already argues against. A plain `useState(FEED_PAGE)` has to be RESET when
  // the window changes, the only place to reset it is an effect, and a
  // synchronous setState in an effect is `react-hooks/set-state-in-effect` —
  // the warning the paragraph above exists to avoid. Keying it makes the reset
  // a DERIVATION: a stored limit belonging to another window is not a limit for
  // this one, so this one starts at a page. No effect, and the two cannot
  // disagree.
  //
  // It is declared HERE, below `win`, and not up with the other state: `const`
  // does not hoist, and reading `win` above its declaration is a TDZ
  // ReferenceError that build and lint both pass (CLAUDE.md's blank-screen
  // gotcha — hit twice in v17.11.0, the second time while fixing the first).
  const [page, setPage] = useState({ win: null, limit: FEED_PAGE });
  const limit = page.win === win ? page.limit : FEED_PAGE;

  useEffect(function () {
    if (!ready) return undefined;
    // Built as a LIST because either bound may be absent. `query()` is
    // variadic, so an unbounded side simply contributes no constraint —
    // which is what makes "all time" the same code path as "one day"
    // rather than a second one beside it.
    const parts = [orderByChild("at")];
    if (from != null) parts.push(startAt(from));
    if (to != null) parts.push(endAt(to));
    parts.push(limitToLast(limit));
    const q = query.apply(null, [ref(db, "activity")].concat(parts));
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
      setState({ win: win, limit: limit, rows: out });
    }, dbError("activity"));
    return unsub;
  }, [from, to, ready, win, limit]);

  // Same window = the rows in hand are a prefix of the answer being fetched, so
  // they stay on screen and only the "Load older" button reports the wait.
  const sameWin = state.win === win;
  const fresh = sameWin && state.limit === limit;
  return {
    rows: sameWin ? state.rows : EMPTY_ROWS,
    loading: ready && !sameWin,
    loadingMore: ready && sameWin && !fresh,
    // A FULL page is the only evidence there may be more. It over-reports by one
    // press when the log holds exactly a multiple of the page — which costs one
    // query and then tells the truth, where under-reporting would hide entries
    // behind a button that had quietly stopped offering them.
    hasMore: fresh && state.rows.length >= limit,
    loadOlder: function () { setPage({ win: win, limit: limit + FEED_PAGE }); },
  };
}
