// src/lib/retention.js
//
// How long a record is kept, in days: the activity log's (v18.0.0 session 11,
// `settings/admin.activityRetentionDays`) and, since v18.8.0 phase 7, the
// WhatsApp messages' (`settings/admin.waRetentionDays`, pruned each night by
// api/wa-prune.js). Moved here out of `activity.js`, which re-exports it, so
// the server can import the ONE normaliser: this file imports nothing and runs
// under Node ESM as it is.
//
// Days rather than milliseconds, because a person picks months and a stored
// `31536000000` is unreadable in the Firebase console.
export const DEFAULT_RETENTION_DAYS = 365;
export const RETENTION_MIN_DAYS = 30;
export const RETENTION_MAX_DAYS = 3650;

/**
 * A stored value → a usable number of days. ONE normaliser, because the value
 * drives a DELETE and it was being defaulted in three places that did not agree
 * (/code-review).
 *
 * `sanitizeAdminSettings` reached for `clampStep`, which is the wrong shape for
 * this: it tests `Number.isFinite` AFTER coercing, and `Number(null)`,
 * `Number("")` and `Number(0)` are all 0 — finite — so the default branch was
 * never reached and all three clamped to the 30-day MINIMUM. Measured:
 * `clampStep(null, 365, 30, 3650, 1) === 30`. A `settings/admin` node holding a
 * null or empty retention would therefore have pruned ELEVEN MONTHS of the
 * audit log on the next admin to open it, with no backups to recover from.
 *
 * That is exactly the trap `lib/clamp.js` documents in its own header — "`null`
 * and `""` are not absent because `Number()` makes both 0" — and `retentionMs`
 * and `isPrunable` were already guarding it correctly, which is what made the
 * disagreement invisible: two of the three fallbacks were right.
 *
 * **Absent means the DEFAULT, never the minimum.** Every unusable input widens
 * to the shipped year, because the unsafe direction here is silent and
 * irreversible.
 */
export function retentionDaysOf(v) {
  if (v == null || v === "") return DEFAULT_RETENTION_DAYS;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RETENTION_DAYS;
  return Math.min(RETENTION_MAX_DAYS, Math.max(RETENTION_MIN_DAYS, Math.round(n)));
}
