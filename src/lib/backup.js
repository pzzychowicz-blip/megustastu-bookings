// src/lib/backup.js
//
// v18.1.1 — what "Download backup" writes, decided in one place.
//
// WHY THIS EXISTS. From v16.3.0 the backup was a hand-built object naming five
// collections and five settings nodes. v18.0.0 added vouchers, roles, invites,
// the activity log, four more settings nodes and the WhatsApp data, and none of
// them joined that list — so the one backup the restaurant has would have
// restored every booking and lost every gift-voucher balance. Nothing could see
// it: the list was a second copy of a fact `database.rules.json` already holds,
// and the only thing that ever read it was a person pressing a button.
//
// THE RULE NOW: the file is the WHOLE database as the server holds it, minus
// the nodes in BACKUP_OMIT, each with the reason it is safe to leave out. A node
// added later is in the backup without anybody remembering to add it; leaving
// one OUT is the decision that has to be written down. `tests/backup.test.js`
// derives the node list from `database.rules.json`, so a node the builder drops,
// or an omission naming a node the rules no longer declare, fails the build.
//
// WHY THE RAW TREE. It is what the Firebase console's "Import JSON" takes at the
// root, so a restore is one console action rather than a script nobody has
// written (`database.rules.README.md` § Backups and restore). The `<name>Rev`
// counters come with it, which keeps each restored node and its compare-and-swap
// counter in step. Values are copied VERBATIM, never sanitized: a restore must
// put back what was there, not what today's `sanitize` would make of it.
//
// `_backup` is the one key that is not the database's own — the file's metadata,
// including the omissions, so a future restore knows what is missing on purpose
// (the v16.3.0 rule, kept). Importing the file creates a `_backup` node that
// nothing reads; the next backup drops it and writes its own.
//
// Pure: no Firebase import, so every decision here is reachable by a test.

export const BACKUP_META_KEY = "_backup";

// Top-level nodes deliberately NOT written to the file, and why a restore loses
// nothing it needs. Their `<name>Rev` counters, where they have one, stay in: a
// rev with no node behind it is exactly how an EMPTY collection already looks,
// since RTDB deletes a node the moment it holds nothing and the rev stays put.
export const BACKUP_OMIT = {
  presence:
    "per-connection online markers: each device rewrites its own when it connects, " +
    "and a restored marker would show staff online who are not",
  reminderFires:
    "the transient reminder fire-log: restoring reminders without it can only re-show " +
    "an already-seen banner once, which pruneOldReminderFires then re-prunes",
};

// root: the database root as `get(ref(db)).val()` returns it — null for an empty
// database. meta: { exportedAt, appVersion }. Returns the object to serialise.
export function buildBackup(root, meta) {
  const src = root && typeof root === "object" ? root : {};
  // Metadata FIRST, so the top of the file says what it is.
  const out = {
    [BACKUP_META_KEY]: {
      exportedAt: meta.exportedAt,
      appVersion: meta.appVersion,
      omitted: Object.keys(BACKUP_OMIT).map(function (k) { return k + " (" + BACKUP_OMIT[k] + ")"; }),
    },
  };
  for (const key of Object.keys(src)) {
    // A `_backup` node left by an earlier restore is the OLD file's metadata.
    if (key === BACKUP_META_KEY) continue;
    if (Object.prototype.hasOwnProperty.call(BACKUP_OMIT, key)) continue;
    out[key] = src[key];
  }
  return out;
}

// There is deliberately NO "did the read come back whole" check here. The first
// version had one, comparing the collections this device holds against the
// snapshot, and /code-review showed it could not do its job: a root read served
// from the SDK's local cache would hold exactly the paths this device LISTENS to
// (those are what the cache has), so it would pass; meanwhile a collection
// emptied by another device during the read made it refuse a complete backup.
// What actually prevents a partial file is the SDK: a root `get()` is never
// answered from an incomplete cache — measured offline on DEV, it stays pending
// until the socket returns — and `usePersistence`'s `readDatabaseRoot` refuses
// up front when the device is offline.
