// src/lib/activitySink.js — v18.0.0 session 8 (item 1)
//
// One module-level hand-off between the code that KNOWS something happened (the
// write paths, scattered across six hooks) and the code that can WRITE it (a
// hook, which needs auth and the database). `lib/dbError.js` is the same shape
// for the same reason, and this is deliberately a copy of that shape rather
// than a new idea: a listener failure and an activity entry are both "something
// happened deep in a write path that a React hook has to report".
//
// ── WHY A SINK AND NOT A PROP ────────────────────────────────────────────────
// The alternative is threading a `logActivity` callback into `usePersistence`,
// `useVouchers`, `revGuard`, `useRoles` and every settings hook. That is a prop
// added to six signatures and passed through App, and — the part that decides
// it — `revGuard.writeWithRev` is a plain module function called from eighteen
// places, so it has no props at all. A module-level sink is the only shape that
// reaches all of them, and it makes the coverage question STRUCTURAL: a writer
// either calls `emitActivity` or it does not, and that is greppable, where a
// prop threaded through six hooks can be present and silently unused.
//
// ── IT MUST NEVER TOUCH THE WRITE IT DESCRIBES ───────────────────────────────
// Every call is wrapped: a throw in a subscriber, a sink that has not been set
// yet, a malformed entry — none of them may reach the caller, because the
// caller is in the middle of saving a booking. A log entry is worth strictly
// less than the thing it is a log OF. This is the same "never let a subscriber
// break reporting" rule `dbError` states, one verb over, and here it is
// load-bearing rather than tidy: the callers are inside promise handlers on the
// booking write path.

let sink = null;

/**
 * Install the writer. `hooks/useActivityLog.js` calls this once, and passes
 * null on unmount so a stale closure cannot outlive its React tree.
 * @param {null | ((entries: object[]) => void)} fn
 */
export function setActivitySink(fn) {
  sink = typeof fn === "function" ? fn : null;
}

/**
 * Hand entries to the writer, if there is one. Silent and total: no sink, an
 * empty list and a throwing sink are all ordinary, and none of them is the
 * caller's problem.
 *
 * Not having a sink is the NORMAL state for most of the app's life — every
 * write before the log's hook mounts, and every write in a build where the
 * feature is off. So it is not warned about; a console line per booking save
 * would be worse than the silence.
 */
export function emitActivity(entries) {
  if (!sink) return;
  if (!Array.isArray(entries) || !entries.length) return;
  try {
    sink(entries);
  } catch (err) {
    // Reported once, and never rethrown. If this fires, the log is broken and
    // the booking it was describing is fine — which is the correct order of
    // priorities and is why the catch is here rather than at each call site.
    console.warn("[activity] sink threw — the entry was dropped, the write was not.", err);
  }
}

/** Test seam: forget the installed sink. Not used by the app. */
export function resetActivitySink() { sink = null; }
