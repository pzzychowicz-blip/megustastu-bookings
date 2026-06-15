# Firebase Realtime Database — Security Rules (source of truth)

`database.rules.json` in this repo is the **version-controlled source of truth** for the
RTDB Security Rules. The rules are still applied **manually** via the Firebase console
(Realtime Database → Rules → paste → Publish) — this file is the canonical copy to paste
from and to diff against.

## What the rules do (v15.3.0 — stale-overwrite backstop)

Beyond the original `auth != null` read/write gate, two `.validate` rules enforce an
optimistic **compare-and-swap** on the `bookings` node, keyed on a sibling integer
`bookingsRev`:

- **`bookings`** may only be written if the write also sets `bookingsRev` to exactly
  `currentServerRev + 1` (or `1` when no rev exists yet). A client writing `bookings`
  without bumping the rev, or bumping from a **stale base** (e.g. a frozen laptop whose
  known rev is far behind the server), produces a rev that ≠ `serverRev + 1` → **rejected**.
- **`bookingsRev`** may only increment by exactly 1 (or be initialised to 1).

This is the server-side backstop behind the client resync gate (v15.2.0): even if a stale
write slips the client guard, the server refuses it. The app writes both nodes atomically
via a single multi-path `update({ bookings, bookingsRev })` in `usePersistence.js`.

`tableBlocks`, `reminders`, `reminderFires`, and the four `settings/*` nodes are unchanged
(they inherit the root `auth != null` rule) — only `bookings` carries the rev backstop.

## Deployment order — IMPORTANT (avoid locking out live devices)

The new app (v15.3.0) writes `bookingsRev`; **older app versions do a plain `bookings`
write with no rev bump, which the new rule REJECTS.** So deploy in this order:

1. **Deploy the v15.3.0 app first** (merge → Vercel). It works fine with the *old* rules
   (it just starts writing `bookingsRev`; no enforcement yet).
2. **Refresh every device** (tablet + any laptops/phones) so they all run v15.3.0. Confirm
   each shows v15.3.0 in the console boot banner.
3. **Test the rules on the DEV project first.** In the DEV Firebase console, paste
   `database.rules.json`, Publish, then exercise the app on DEV (localhost): a normal save
   succeeds and `bookingsRev` increments by 1; a forced-stale write is rejected (see the
   PR's verification notes). Keep a copy of the prior DEV rules to revert.
4. **Only then apply to PROD**, at a quiet time with a single active device. Paste
   `database.rules.json` into the PROD console → Publish. Do one real booking edit and
   confirm it succeeds + `bookingsRev` increments.

**Rollback:** if anything misbehaves, paste the previous rules back (the plain
`{ ".read": "auth != null", ".write": "auth != null" }`) and Publish — the app keeps
working (it just loses the server-side backstop; the v15.2.0 client gate still protects).

## Migration

The first v15.3.0 write (no `bookingsRev` yet) sets it to `1` — allowed by the
`!data.exists()` branch of both rules. The `bookings` array shape is **unchanged**; no data
migration is needed.
