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
`npm ci` in **both** jobs. As a devDependency, `verify` (build · test · lint ·
check:style) would pay for it on every PR and never run it. So CI installs it
globally in the `rules` job alone, **pinned to an exact version** so that job and
this machine evaluate the rules on the same emulator jar:

```yaml
# .github/workflows/ci.yml, job `rules`
env:
  FIREBASE_TOOLS_VERSION: "15.28.2"
```

That one value is both the install version and the cache key for
`~/.cache/firebase/emulators` (the CLI is what selects the emulator jar, so the
key cannot go stale while the pin holds). Upgrading locally means bumping it in
the same PR, or a rules failure that reproduces in only one of the two places
has two candidate causes instead of one.

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

121 tests as of v17.16.8, run on every PR by the `rules` job in
`.github/workflows/ci.yml` as well as on demand here. The first group asserts
the rig itself is pointed at a loopback emulator and a `demo-` project — and,
since v17.16.7, that the root carries **no** `.write` key, which is asserted as
an ABSENCE because that absence is the whole of the access-control change and a
re-added root grant would leave every other test in this file green. The next
groups are what you would expect: the `auth != null` boundary, the per-`$id`
booking CAS (`updatedAt` strictly greater **and** `baseUpdatedAt` equal to
stored — the pair that closed the 2026-07-05 overwrite incident), and the twelve
`<name>Rev` pairs, each swept for repeated / skipped / lower / absent /
non-numeric revisions, and — v17.16.7 — for a bare `remove()` of the node and of
its rev.

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

## v17.16.8 — the WhatsApp sandbox nodes get grants, and a decided CAS shape

v17.16.7 removed the root `.write` grant, which left four paths unwritable that
only the `wa-sandbox` branch writes: `conversations`, `messages`, `templates`
and `settings/whatsapp`. Reads kept succeeding (root `.read` is untouched), so
the sandbox looked populated and silently refused to save. That version declined
to grant them because doing so would pre-decide their CAS shape. **This version
decides the shape.**

### The shape is not the same for all four, and the reason is measurable

`api/_lib/rtdb.js` on `wa-sandbox` writes `conversations/{phoneKey}` and
`messages/{phoneKey}/{msgId}` through **firebase-admin**, and Admin SDK writes
**bypass security rules entirely**. A rev or stamp CAS on those two nodes would
therefore constrain the browser while the backend that does most of the writing
walks past it — a pin that looks like a guarantee while guaranteeing nothing,
which is the failure this repo already names for the `test:rules` openjdk
prefix. So:

| Node | Writers | Shape |
|---|---|---|
| `conversations/$phoneKey` | client **and** Admin backend | per-child grant, no CAS (`presence` shape) |
| `messages/$phoneKey` | client **and** Admin backend | per-child grant, no CAS |
| `templates` | client only | rev pair — `templatesRev` |
| `settings/whatsapp` | client only | rev pair — `whatsappRev` |

**The two per-child grants are a deliberate, documented deviation from the Rule
of law**, not an oversight. They are the second exemption after `presence`, and
unlike `presence` these are real data — so the justification is the Admin
bypass and nothing else. If the WA backend ever stops writing them, or starts
stamping `updatedAt`/`baseUpdatedAt`, they should get the real CAS.

**The grant sits at `$phoneKey`, not at `$phoneKey/$mid`.** Write permission
cascades down, so one grant covers the per-message writes *and* the "delete this
conversation" call, while the whole-node wipe stays denied. That last part is
load-bearing: `clearAllWaData()` did `set(ref(db,"conversations"), null)`, which
is exactly the CT-2A-06 capability v17.16.7 deleted the root grant to close.
Granting it back for these two nodes would have spent that win, so the sandbox
client deletes per conversation instead (see below).

### The client changed with it, on the `wa-sandbox` branch

Two changes there, because the rules above describe a client that did not yet
exist:

1. `templates` moved from a bare whole-node `set()` (the seed at
   `useWhatsApp.js:135` and the save at `:238`) onto `writeWithRev`, so the new
   `templatesRev` pair is real rather than decoration.
2. `clearAllWaData()` deletes each conversation and each message subtree by key
   instead of nulling the two nodes. **It keys off the SNAPSHOT keys, not the
   `phoneKey` field on each row** — the listener groups rows by that field and
   discards the real keys, and the backend writes at `sanitizeKey(phoneKey)`, so
   a path built from the field can name nothing and leave the real row behind.
   That is the "it does not fail, it re-targets" hazard `api/_lib/rtdb.js`'s own
   header describes; it was caught by `/code-review` here, one file over.

**`settings/whatsapp` needed no client change** — `useWaSettings.js:103`
already used `writeWithRev`. It was denied only because no rule named it.

### Deployment — rules can go FIRST, or at any time

The four nodes are unwritable today, so no client is relying on them; nothing
can regress. Publish whenever.

1. Paste `database.rules.json` into the Firebase console → Realtime Database →
   Rules → **Publish**. **DEV and PROD both**, and that is the point of this
   version: the two databases carry the same file again, which is what makes a
   missing grant fail in DEV rather than only in production.
2. On PROD the four grants are inert until the WA module merges — nothing on
   `main` writes those paths.

**Rollback** is re-publishing the previous rules from git
(`git show <commit-before-this-one>:database.rules.json` — the repo carries no
version TAGS, so name a commit or `origin/main`, not `v17.16.7`).

## v17.16.7 — the root `.write` grant is gone (CT-2A-04, CT-2A-06)

**The change is one deletion and a set of additions.** `".write": "auth != null"`
no longer sits at the root; each writable path carries its own grant. `.read` is
untouched — one signed-in account still reads the whole database, which is the
single-restaurant trust model and not what these findings were about.

Why it had to be a restructure rather than a rule: **RTDB write permission
cascades from wherever it is granted and cannot be revoked lower down.** Measured
against the emulator before the fix, a child `".write": false` on `bookings` did
not deny a whole-node delete. So while the root grant existed, no rule added
below it could have closed either finding.

### What each finding was

- **CT-2A-04** — an authenticated client could delete the entire `/bookings`
  node in one call. `.validate` is not evaluated when `newData` does not exist,
  and `/bookings` itself carried no rule; only `/bookings/$bid` did.
- **CT-2A-06** — a whole-node `remove()` bypassed the rev CAS entirely (node
  gone, rev left behind). Same cause: the CAS lived in `.validate`.

### How they are closed

1. **`/bookings` carries no `.write`; `/bookings/$bid` carries it.** The app has
   only ever written children — the v15.5.0 diff-write is a multi-path `update()`
   under `/bookings` — so a per-child grant covers every real write while a
   whole-node `set` or `remove` has no grant to stand on. Deleting ONE booking is
   a child write and is unaffected.
2. **The rev CAS moved from `.validate` to `.write`** on all twelve pairs, node
   and `<name>Rev` alike. The predicate is unchanged, character for character;
   what changes is that **`.write` is evaluated for a delete and `.validate` is
   not.** A bare `remove()` therefore fails the same CAS an ordinary write does.
3. **`presence` gains an explicit `presence/$key` grant.** It is the one node
   documented as deliberately having no rules of its own, and it would otherwise
   have become unwritable — see the hazards below.

### Two things closed that were not being aimed at

- **A deep write that skips the rev.** Ancestor `.validate` rules are not
  re-evaluated for a write landing below them, so `tableBlocks/0/from` could be
  rewritten with the rev untouched. `.write` at `tableBlocks` *is* consulted for
  a descendant write, so the CAS now covers it.
- **Arbitrary top-level nodes.** A path with no rule now has no grant. This is
  the property worth knowing when adding a node: **the write will fail loudly in
  DEV rather than working there and being unguarded in PROD.**

### The two hazards the ROADMAP entry named, and what happened to them

1. *"Deleting the last booking would be refused"* — that was true of the
   predicate probed at the time (`newData.exists() || !data.exists()` on the
   `bookings` node, which is false when the node empties). **It does not arise
   here, because no predicate was put on `/bookings` at all** — the grant moved
   down to `$bid`, where a delete is an ordinary child write. Pinned:
   "deleting ONE booking still works".
2. *"Every path not explicitly granted becomes unwritable"* — **real, and it is
   now the model.** The writable surface was enumerated from the source rather
   than guessed: `usePersistence.js` (the bookings diff-write, and the legacy
   array→keyed migration), `revGuard.js` (all twelve rev pairs) and
   `usePresence.js`. Each has a grant and each is exercised by a test.

   **That enumeration was of THIS branch's `src/`, and the DEV database has a
   second writer** — the `wa-sandbox` branch, a parallel Vercel deployment
   forced onto DEV Firebase, which writes `conversations`, `messages`,
   `templates` and `settings/whatsapp`. This version deliberately left all four
   denied, on the grounds that granting them would "pre-decide whether they get
   a rev CAS, which the Rule of law says they must".

   **v17.16.8 closed it by making that decision instead of deferring it** — see
   the section above. The reasoning here is kept rather than deleted because it
   is what the next such call should be weighed against: the objection was never
   to the grants, it was to shipping grants whose CAS shape nobody had thought
   about. Deciding the shape answers it; adding the grants alone would not
   have.

### One code path changed with it

The lazy array→keyed migration (`usePersistence.js`, v15.5.0) wrote the whole
`/bookings` node with `set()` — which is precisely the capability CT-2A-04 is
about, so it could not be excepted. It is a multi-path `update()` now (the old
integer keys nulled, the keyed children written in the same atomic patch), which
the rules permit and which the tests pin from both sides. The path stays
unreachable on PROD; leaving it broken was not an option, because
`arrayShapeRef` holds **every** booking write until the migration echoes, so a
legacy array node would have left the app permanently read-only for bookings.

### Deployment — rules can go FIRST, or at any time

No coordination, and no quiet window. Every client from v16.0.0 onward already
writes only the shapes and paths these rules grant; that is asserted rather than
assumed, by the group "every write shape the app actually performs still
succeeds" plus the thirteen `sanitize`-produced booking shapes already in the
suite.

The migration change is a client-side improvement and is **not** a precondition:
an older client would simply fail that one unreachable write.

1. Paste `database.rules.json` into the Firebase console → Realtime Database →
   Rules → **Publish**. PROD only; `firebase deploy` must never be run from this
   repo (see above).
2. Nothing else.

**Rollback** is re-publishing the previous rules from git
(`git show <commit-before-this-one>:database.rules.json` — the repo carries no
version TAGS, so name a commit or `origin/main`, not `v17.16.6`).

---

## v17.16.1 — the create branch is a real CAS, and fields have shapes

Two changes to `bookings/$bid`, both from the v17.15.7 crash test. **Deploy is
ROLLING-SAFE and needs no app update** — see the order below, which is the
opposite way round from v16.0.0's.

### 1 · A deleted booking can no longer be resurrected (CT-2A-01)

The validate read

```
!newData.exists() || (hasChild('updatedAt') && isNumber(...) &&
                      (!data.exists() || <the CAS>))
```

and the `!data.exists()` disjunct was a hole: once the booking was gone the CAS
branch was never reached, so **any** write carrying a numeric `updatedAt`
recreated it — including an offline device's queued edit naming a
`baseUpdatedAt` that had been deleted. It came back holding its OLD table, so if
that table had been reassigned the day was genuinely double-booked; and in the
commoner case a cancelled party simply reappeared as live with nothing on screen
saying so.

The create branch now requires **`baseUpdatedAt === 0`**, which is exactly what
`stampForWrite` writes when it has no `old` — i.e. a genuine create. A stale
edit carries the deleted version's stamp and no longer satisfies either branch.

### 2 · Field shapes (CT-2A-03, server half)

`name` · `date` · `time` · `size` · `duration` · `status` · `tables` each get a
`.validate`. Every one is **"if PRESENT, must be the right shape"**, never "must
be present" — `sanitize` fills every gap on read, and a required field the app
later stopped writing would be a rejected write in production, which is staff
unable to save.

**Every rule checks TYPE, never FORMAT**, and that is one decision applied
consistently rather than four separate concessions:

- **`status` is a string, not one of the five known values.** An unrecognised
  status is reachable in stored data, and pinning the set would refuse every
  write touching such a booking.
- **`date` and `time` are strings, not patterns.** The first version of these
  rules matched `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` and `^[0-9]{1,2}:[0-9]{2}$`, and
  this version's own `/code-review` found the hazard. `sanitize` guarantees
  these are strings (`b.date || ""`, `b.time || "13:00"`) and never that they
  are well-formed, so a legacy `"31/08/2026"` survives a read and is written
  back on the next save. **`persist` sends one multi-path `update()`, which RTDB
  applies atomically** — so one such booking would reject a whole optimiser
  reshuffle, the retry queue would replay and fail, and staff would be left
  unable to save a day that looks perfectly normal. Type-only still fixes what
  CT-2A-03 reported: `toMins(t)` is `t.split(":")`, which THROWS on a number and
  merely returns NaN on a bad string.
- **Table ids are not checked against the layout.** The layout is editable in
  Settings → Layout, so the rules would duplicate it and go stale.

Checking formats is a separate decision and needs evidence of what PROD actually
holds — not a guess committed to a file deployed by hand with no staging. On
ROADMAP.

### Deployment — rules can go FIRST, or at any time

Unlike v16.0.0 (app first) and v15.5.0 (a hard cutover), this needs no
coordination: **every client from v16.0.0 onward already writes the shapes and
stamps these rules require.** That is asserted, not assumed —
`tests/rules/database-rules.test.js` runs thirteen booking shapes produced by
the app's own `sanitize` (walk-in, anonymized, pending, no tables, no date, no
time, mega-combo, recurring occurrence, joined phone-less guest, …) through the
real rules and requires every one to be accepted.

1. Paste `database.rules.json` into the Firebase console → Realtime Database →
   Rules → **Publish**. PROD only; there is no CLI step, and
   `firebase deploy` must never be run from this repo (see above).
2. Nothing else. No app refresh, no quiet window.

**Rollback** is re-publishing the previous rules from git
(`git show <commit-before-this-one>:database.rules.json` — see the note in the
v17.16.7 section: `v17.16.0` is not a tag and does not resolve).

**One code path changed with it.** `usePersistence`'s lazy array→keyed migration
(v15.5.0) wrote each child with `updatedAt` and no `baseUpdatedAt`, so the new
create branch would refuse it. It now writes `baseUpdatedAt: 0`. The path is
unreachable on PROD — the node has been keyed since v15.5.0 and the branch is
gated on `Array.isArray` — but a recovery path left knowingly broken is how a
service is lost years later, by someone who reads the code and believes it
works.

### Two findings this version does NOT fix, and why

**CLOSED IN v17.16.7** — see that section above; what follows is the record of
why v17.16.1 could not close them, and it is still the reason the fix had to be
a restructure rather than an added rule.

Both need the same structural change and neither can be fixed by adding a rule.

- **CT-2A-04** — an authenticated client can delete the entire `/bookings` node
  in one call.
- **CT-2A-06** — a whole-node `remove()` bypasses the rev CAS (node gone, rev
  left behind), which `revGuard.js` and CLAUDE.md both used to say was
  impossible. Those claims are corrected in this version.

**RTDB write permission cascades from the root `.write` and cannot be revoked
lower down** — measured against the emulator: a child `.write: false` on
`bookings` does *not* deny the delete. Closing either finding means removing
`".write": "auth != null"` from the root and granting it per path, which was
also measured and carries two hazards:

1. **Deleting the last booking would be refused.** The natural predicate is
   `newData.exists() || !data.exists()`, and removing the only booking empties
   `/bookings`, so `newData.exists()` is false.
2. **Every path not explicitly granted becomes unwritable.** `presence` fails
   immediately in the probe — the one node this repo documents as deliberately
   having no rules of its own.

Both sit inside the documented single-restaurant trust model. See ROADMAP.

---

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
