# Firebase Realtime Database — Security Rules (source of truth)

`database.rules.json` in this repo is the **version-controlled source of truth** for the
RTDB Security Rules. The rules are still applied **manually** via the Firebase console
(Realtime Database → Rules → paste → Publish) — this file is the canonical copy to paste
from and to diff against.

## v16.1.0 addition — `settings/bookingDefaults` rev pair

v16.1.0 adds a **fifth** settings node, `settings/bookingDefaults` (default booking-duration
tiers + running-late thresholds, `useBookingDefaults.js`), guarded by the same revision-CAS
pattern: a `bookingDefaultsRev` sibling and a rule pair identical to `optimizer`/`optimizerRev`.
Deploy is rolling-safe and the order is the same as v16.0.0: **app first, rules second** —
until the pair is pasted, the node simply has no per-node rule (the root auth rule still
applies); once pasted, a v16.1.0 app writes it correctly (`writeWithRev`) and an old app
never writes it at all. Paste the updated `database.rules.json` to DEV, verify a Settings →
Booking-durations / Running-late save counts `bookingDefaultsRev` up from 1, then PROD.

## What the rules do (v16.0.0 — TRUE compare-and-swap, all collections)

Motivated by the **2026-07-05 incident**: a laptop asleep at home woke and wrote its old
snapshot over a night of tablet status changes. The v15.5.0 rule only required a booking's
`updatedAt` to be **greater** than the stored one — and a stale device stamps writes with its
current wall clock, which is always greater. Greater-than is last-writer-wins, not staleness
protection. The v16.0.0 rules make every write prove **it was based on the data it is
overwriting**:

- **`bookings/$bid`** — each written child now also carries **`baseUpdatedAt`**: the
  `updatedAt` of the version the device based its write on (its last server echo of that
  booking). Overwrites require `baseUpdatedAt === stored updatedAt` (AND the stamp still
  advances). A device holding a stale copy — sleep/wake, zombie socket, offline-queue flush —
  is **rejected** no matter what its clock says; the app's existing rejection recovery
  (resync + replay user intent on fresh data, v15.4.0–15.7.0) takes over. Creates (no stored
  child) need only the stamp; deletes stay unconditional (a multi-path `null` cannot carry a
  base — documented residual; deletes are explicit user actions).
- **Every whole-node collection** — `tableBlocks`, `waitlist`, `reminders`, `reminderFires`,
  and the four `settings/*` nodes — gets the proven **v15.3.0 revision CAS**: a sibling
  `<name>Rev` integer, written atomically with the node (`update({node, nodeRev: base+1})`,
  `src/lib/revGuard.js`), and a rule pair rejecting any write whose rev is not exactly
  `stored+1`. A stale device's rev is behind, so its overwrite (or wipe — an empty array
  deletes the node, whose own `.validate` is skipped, but the **rev child's** rule still
  gates the atomic update) is rejected; the SDK's rollback echo restores its local state.

## ⚠️ Deployment (v16.0.0) — app FIRST, rules SECOND (rolling-safe)

Unlike v15.5.0 this is **not** a hard cutover, but order still matters:

1. **Merge + deploy the app.** New writes carry `baseUpdatedAt` + the rev bumps; the
   **current** rules accept both (extra fields are ignored; the whole-node collections have
   no rules yet). Devices can be refreshed at leisure at this stage.
2. **Refresh every device** (tablet + laptops + phones). Once the new rules are live, a
   pre-v16.0.0 tab's writes are rejected (no `baseUpdatedAt`, no rev bump) — that IS the
   protection working, but refreshing first avoids nuisance rejections.
3. **Apply the new rules to DEV** (console → Rules → paste `database.rules.json` → Publish).
   Verify on localhost: a normal edit/status change saves; blocks/waitlist/reminders/settings
   writes create their `<name>Rev` siblings at 1 and count up; a forced stale write (wrong
   base/rev) is rejected and the app self-recovers. Keep the prior rules text to revert.
4. **Apply to PROD** at a quiet moment. Confirm one real edit on each device type.

**Rollback:** paste the v15.5.0 rules back (git history of `database.rules.json`, commit
`fe75308`) — the app keeps writing `baseUpdatedAt`/revs, which the old rule ignores. No data
or shape change is involved; the rev siblings are harmless extra nodes.

---

# Historical: v15.5.0 rules (superseded by v16.0.0 above)

## What the rules do (v15.5.0 — per-booking-node conflict protection)

`bookings` is now stored as a **keyed object** `/bookings/{id}` — one child per booking,
not a single array (see `usePersistence.js` → "per-booking-node write model"). A single
per-child `.validate` rule enforces an optimistic, **per-booking** stamp check:

- **`bookings/$bid`** may be written only if either it's a **delete** (`!newData.exists()`),
  **or** the new value carries a numeric `updatedAt` that is **strictly greater** than the
  one currently stored (a create, where none exists yet, is allowed). A write whose
  `updatedAt` is stale (≤ the server's) — i.e. an out-of-order / behind write to the **same**
  booking — is **rejected**.

Because each booking lives at its own path, two devices editing **different** bookings (even
both offline) write disjoint paths and Firebase **merges** them — there is no whole-array race
to lose a write. Only concurrent edits to the **same** booking contend, and the stamp rule
resolves those deterministically (the later write wins; the rejected one resyncs + replays on
fresh data — `usePersistence.js`'s v15.4.0 auto-retry).

This **replaces** the v15.3.0 global `bookingsRev` compare-and-swap. The app no longer writes
`bookingsRev`; the legacy node (if present) is ignored and may be left in place or deleted.

`tableBlocks`, `reminders`, `reminderFires`, and the four `settings/*` nodes are unchanged
(they inherit the root `auth != null` rule) — only `bookings` carries the per-child stamp rule.

## ⚠️ Deployment — this is a HARD CUTOVER (not a rolling deploy like v15.3.0)

The new app and the **current (v15.3.0) rule are mutually incompatible**, so unlike v15.3.0
there is no overlap window where both old and new clients can write:

- **Old rule live + new (v15.5.0) app** → the new app's per-child writes don't bump
  `bookingsRev`, so the v15.3.0 rule **rejects** them.
- **New rule live + old (≤v15.4.0) app** → the old app's whole-array write has no `updatedAt`
  on its children, so the new rule **rejects** it.

Reads are unaffected throughout (data stays readable); only writes are gated. So cut over at a
**quiet time with a single active device**, minimising the window:

1. **Merge v15.5.0 → Vercel deploys.** Do **not** refresh devices yet — a device on v15.5.0
   can't write until the rule is swapped. Old devices keep working normally under the old rule.
2. **Test on DEV first.** In the DEV Firebase console, paste `database.rules.json`, Publish.
   On localhost (DEV), exercise the app: first load **migrates** the array to keyed children
   (watch the console / Realtime DB tree go from `0,1,2…` to `{id}` keys); a normal edit
   succeeds; a forced-stale write (older `updatedAt`) is rejected. Keep the prior DEV rules
   to revert.
3. **Cut over PROD at a quiet time, one device active.** In the PROD console paste
   `database.rules.json` → Publish, **then immediately hard-refresh** that device to v15.5.0.
   Its first load runs the one-time migration (array → `/bookings/{id}`). Confirm a real
   booking edit saves.
4. **Refresh every other device** (tablet + any laptops/phones) to v15.5.0 right after. Until a
   device is on v15.5.0 its writes are rejected (reads still fine), so don't leave one behind.

**Rollback:** paste the previous rules back (the v15.3.0 `bookings`/`bookingsRev` `.validate`,
or the bare `{ ".read": "auth != null", ".write": "auth != null" }`) and Publish. The keyed
`/bookings/{id}` data is still readable by every app version (`sanitizeAll` handles both
shapes), so a rollback loses only the per-booking server check, not data — but note that once
migrated, the node stays keyed (a v15.4.0 client would read it fine and resume whole-array
writes, which the bare rule allows).

## Migration

The first v15.5.0 client to load a legacy **array**-shaped `/bookings` writes it back **once**
as a keyed object (`usePersistence.js`, gated on `migratedRef` + connected). The echo returns
as an object, so it never loops. Booking ids (`genId()` = base-36, `[0-9a-z]`) are
path-safe child keys. Until the keyed shape echoes, per-child writes are **held**
(`arrayShapeRef`) so a string key is never mixed into the integer array. No booking field
changes shape — only a numeric `updatedAt` is added (carried through `sanitize`).
