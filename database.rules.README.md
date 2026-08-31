# Firebase Realtime Database — Security Rules (source of truth)

`database.rules.json` in this repo is the **version-controlled source of truth** for the
RTDB Security Rules. The rules are still applied **manually** via the Firebase console
(Realtime Database → Rules → paste → Publish) — this file is the canonical copy to paste
from and to diff against.

## Testing the rules — the local emulator (the THIRD environment)

The rules are no longer protected only by reading them. `npm run test:rules`
runs `tests/rules/database-rules.test.js` against a **local Firebase Realtime
Database emulator** loaded with **this file's** `database.rules.json` —
unmodified, read off disk at test time. There is deliberately no simplified copy
of the rules for testing; a copy is a thing that drifts.

```text
npm run dev        → DEV Firebase      → manual app testing
production build   → PROD Firebase     → never reached from a dev machine
npm run test:rules → LOCAL EMULATOR    → the real database.rules.json
```

The emulator does **not** become the backend for `npm run dev`. The DEV/PROD
split in `src/firebase.js` is untouched and must stay that way.

### Prerequisites (one-off, per machine)

```bash
brew install openjdk        # the RTDB emulator is a Java jar; no sudo needed
npm i -g firebase-tools      # deliberately GLOBAL — see below
```

`openjdk` is keg-only, so it is not on `PATH` by default. The `test:rules`
script prepends `/opt/homebrew/opt/openjdk/bin` itself, so nothing global on the
machine has to change; if you would rather have `java` everywhere, add
`export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"` to `~/.zshrc` and the script
still works.

`firebase-tools` is **not** a devDependency on purpose. It is a ~200 MB tool that
only ever *starts* the emulator — no app or test code imports it — and CI runs
`npm ci` on every PR. Adding it there would slow every build for something CI
never executes.

### Running

```bash
npm run test:rules
```

which is:

```bash
firebase emulators:exec --only database --project demo-mgt-bookings \
  "vitest run --config vitest.rules.config.js"
```

`emulators:exec` starts the emulator on `127.0.0.1:9000`, exports
`FIREBASE_DATABASE_EMULATOR_HOST`, runs vitest, and shuts the emulator down
again. No login, no network, nothing cached between runs.

### Two independent guarantees that this can never reach a real project

1. **The project id is `demo-mgt-bookings`.** Firebase treats a `demo-` prefix
   as emulator-only — it cannot resolve to a real backend, and the emulator says
   so on startup ("Detected demo project ID ... attempts to access non-emulated
   services for this project will fail").
2. **The suite refuses to start** unless `FIREBASE_DATABASE_EMULATOR_HOST` is
   set, which only `emulators:exec` sets. Running the config directly throws and
   skips all tests rather than falling through to a network connection.

Neither one leans on the other. The failure this guards against is silent, and
would matter exactly once.

**There is no `.firebaserc` in this repo, deliberately.** Without a default
project, `firebase deploy` has no target and errors out instead of publishing
rules somewhere. Applying the rules stays the manual console step described
below — the emulator is for *attacking* them, not for shipping them.

**So: never run `firebase deploy` from this repo.** `firebase.json` has to map
`database.rules` for `emulators:exec` to load them, and that makes
`firebase deploy --only database` a *working* command here for the first time.
A single `firebase use <prod-project>` would then publish whatever
`database.rules.json` currently says — PROBE behaviour and all — into
production, bypassing the review that the manual console step exists to force.
The absent `.firebaserc` is the only thing in the way, and it stops being one
the moment somebody names the project.

### What the suite asserts

78 tests, in six groups. The first asserts the rig itself is pointed at a
loopback emulator and a `demo-` project. The next three are what you would
expect: the
`auth != null` boundary, the per-`$id` booking CAS (`updatedAt` strictly
greater **and** `baseUpdatedAt` equal to stored — the pair that closed the
2026-07-05 overwrite incident), and the twelve `<name>Rev` pairs, each swept for
repeated / skipped / lower / absent / non-numeric revisions.

The last group is marked **`PROBE:`** and is different in kind: those tests
assert that something *is permitted* which you might wish were not. They are
findings, recorded so they can be ranked — not approvals. Do not make a PROBE
pass by weakening its assertion; change the rules, then the assertion.

**A new rev pair needs no test edit**: the sweep walks this file for every key
ending in `Rev` and grows on its own. That is deliberate — the first version
typed the twelve paths out by hand under a `describe` named "every rev pair in
the rules", which is a claim a hand-written list cannot make. A guard asserts
the walker found at least twelve and that `bookings` is *not* among them (it is
guarded per-child by the `updatedAt` CAS, not by a rev), so a walker that starts
returning nothing fails loudly instead of making the whole sweep vacuous.

## v17.6.0 addition — `settings/users/$uid/prefs` rev pair (per-user preferences)

v17.6.0 adds an **eighth** settings node, and the first that is **not
restaurant-wide**: `settings/users/{uid}/prefs` (`useUserPrefs.js`), holding the
five preferences that now follow the signed-in account across devices — theme,
reduce animations, Plan zoom & pan, lock navigation, split view on/off. (App
width, the four Timeline zoom values and the saved split layout stay per-device
in `localStorage` by design.)

It is guarded by the same revision-CAS pattern as every other whole-node
collection, with the pair nested one level deeper: a `prefsRev` sibling
**inside each `$uid`**, so two accounts can never contend on one revision.
`writeWithRev` builds a root multi-path `update()` keyed by the full path, so a
nested path needs no code change.

**`$uid` is a wildcard, not a per-user access rule.** The top-level
`auth != null` read/write still applies, so any signed-in staff member can in
principle write another's node — same trust model as every other node in this
single-restaurant app (everyone can already edit the layout and every booking).
If that ever needs tightening, add `".write": "$uid === auth.uid"` here.

Deploy is **rolling-safe, app first, rules second**: until the pair is pasted
the node simply has no per-node rule (the root auth rule still applies), so a
v17.6.0 app writes it fine and an older app never touches it. Paste the updated
`database.rules.json` to DEV, toggle any of the five settings and verify
`settings/users/{your-uid}/prefsRev` counts up from 1, then PROD.

Note that v17.6.0's OTHER new setting — the separation between bookings — needs
**no rules change at all**: it is two extra fields on the existing
`settings/bookingDefaults` node, which already has its rev pair.

## v16.3.0 addition — `recurring` rev pair (7th collection)

v16.3.0 adds a **seventh** persisted collection, the top-level `recurring` node (standing /
weekly booking rules, `useRecurring.js`), guarded by the same revision-CAS pattern: a
`recurringRev` sibling and a rule pair identical to `waitlist`/`waitlistRev`. The recurring
node stores only the RULES; the generated occurrences are normal `/bookings/{id}` children
(stamped `recurringId` + `recurringDate`) already covered by the per-`$id` CAS rule — no new
booking rule is needed. Deploy is **rolling-safe, app first, rules second**: until the pair is
pasted, `recurring` has no per-node rule (the root auth rule still applies), so a v16.3.0 app
writes it fine (`writeWithRev`) and an old app never touches it. Paste the updated
`database.rules.json` to DEV, verify a "Repeat weekly" booking (or a Settings → Standing
bookings edit) counts `recurringRev` up from 1, then PROD.

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
