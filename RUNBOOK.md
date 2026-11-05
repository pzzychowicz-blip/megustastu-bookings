# RUNBOOK — when production goes wrong

What to do, in order, when the live app misbehaves. Written for v18.15.0
(2026-11-06). Each section links to where the details live; this file holds the steps.

| What | Where |
|---|---|
| The live app | `https://megustastu-bookings.vercel.app/` (Vercel project `megustastu-bookings`, PROD Firebase) |
| The test environment | `https://megustastu-bookings-wa-sandbox.vercel.app/` (DEV Firebase; follows `main` by itself) |
| Daily backups and the crash digest | the private repo `pzzychowicz-blip/mgt-backups` (its README) |
| The database rules | `database.rules.json`, deployed by hand (`database.rules.README.md`) |

---

## 1. A release broke something: roll back first, fix second

**Roll back in Vercel.** Project → the Production Deployment tile → **Instant Rollback**
→ pick the deployment → **Confirm Rollback**. It is instant. On the Hobby plan only the
**immediately previous** production deployment can be chosen. Then reload the devices
in the restaurant: the service worker fetches the page from the network first, so a
reload gets the rolled-back build.

**After a rollback, pushes to `main` no longer go live.** Vercel stops assigning the
production domain until you press **Undo Rollback** on the same tile (or promote a
deployment). That is what you want while the fix is being written.

**What a rollback does not undo:**

- **A raised `SCHEMA`.** A release that raises it (v18.15.0 does, 5 → 6) writes the new
  number to `/schema` the first time a manager or admin opens it. A build from before
  then sees the database ahead of it and **stops saving**, with a card saying the app
  needs a reload. After rolling back past such a release, set `/schema/v` back to the
  old build's number in the Firebase console (Realtime Database → Data). The console
  bypasses the rule that only lets the number go up. The number for a build is
  `SCHEMA` in `src/lib/schema.js` at that commit.
- **Data the bad build wrote.** Vercel only swaps the code. For damaged data, see
  section 2.
- **Database rules.** They are deployed by hand, apart from the app. To undo a rules
  change, deploy the previous `database.rules.json` the same way
  (`database.rules.README.md`, "Applying the rules").
- **Environment variables.** The rolled-back build keeps the variables it was built
  with. A variable changed since then does not reach it.
- **The service worker.** If the fault is in `public/sw.js`, load the
  `mgt-service-worker` skill before doing anything: a shipped worker cannot be withdrawn
  by deleting the file.

**Then fix it for good.** Revert the merge on `main` in a PR (`git revert -m 1 <merge>`)
or ship the fix in one, let CI pass, merge, and press **Undo Rollback** (or promote the
new deployment). The sandbox follows `main`, so it shows the fix first.

## 2. Data is damaged or missing: restore from a backup

**Where the backups are.** Every day the `mgt-backups` repo takes an encrypted copy of
the PROD database (`backup.yml`, about 04:30 UTC, often hours late because GitHub
starts scheduled jobs late). A second job (`freshness.yml`, every Monday) fails, and
GitHub emails you, when the newest backup is more than 48 hours old. Settings → General →
**Download backup** makes one by hand at any moment.

**Restoring** is a Firebase-console job, and it is written out step by step in
`database.rules.README.md` § Backups and restore. The short version:

1. Take a fresh backup of the current state first, even a damaged one.
2. Decrypt the chosen backup with the private key (it lives in the password manager
   only; the repo README says how).
3. Rehearse the import on DEV. Then import on PROD outside service hours. At the root
   it REPLACES THE WHOLE DATABASE; import one node at its own path to restore only that
   node.
4. Reload every device.

A restore was rehearsed on DEV on 2026-10-10 (15 of 15 nodes identical,
`verify-restore.mjs`).

## 3. The app does not open: the uptime monitor

**Set it up once (Patryk, outside the repo).** An UptimeRobot account (free plan: 50
monitors, a check every 5 minutes, email alerts; read its terms on commercial use when
signing up, since sources disagree on them). Add one monitor:

- Type **Keyword**, URL `https://megustastu-bookings.vercel.app/`, keyword
  `MGT Bookings` (the page's `<title>`), alert when the keyword is **missing**.
- Interval 5 minutes. Alert contact: your email.

**What it sees and what it does not.** It sees Vercel serving the page. It does not
see Firebase: a page that loads and then cannot reach the database still passes. The
app itself shows that case on every device ("Loading bookings…" that never finishes,
the connection dot), and the crash trail below catches a crash.

**When it alerts:** open the site yourself. If Vercel shows an error page, check
vercel.com/status and the project's latest deployment. If the page loads, it was a
blip; UptimeRobot also emails when it comes back.

## 4. Crashes: three ways to hear about one

1. **On the device.** Anything uncaught becomes a `crash` entry in the activity log
   (v18.13.0), at most five per page load, with no guest data.
2. **In the app (v18.15.0).** An admin sees a red number on the Settings gear, the
   Admin tab, **Open the log** and the **Crashes** chip: crashes they have not looked
   at yet. Turning the Crashes chip on clears it.
3. **By email (the crash digest).** A daily job in `mgt-backups` reads the last 24
   hours of crash entries and FAILS when there are any, so GitHub's failure email is
   the digest. No crashes, no email. (Added in that repo's own PR; until it merges,
   only 1 and 2 exist.)

**Reading a crash.** Settings → Admin → Open the log → Crashes → **Download crash
data**, then decode the stack by rebuilding that version (`scripts/CLAUDE.md`, "Reading
a crash's stack").

## 5. Spending: what can cost money, and what stops it

| Service | Plan today | What happens at the limit | What to watch |
|---|---|---|---|
| **Gemini** (WhatsApp drafts) | the key's Google AI Studio project | a paid tier bills per call; set a **monthly spend cap** on the project's Spend tab in AI Studio (it can overshoot by a few minutes of usage). A Google Cloud budget only ALERTS, it does not stop spending | the app makes at most 20 automatic drafts an hour per number (v18.15.0) |
| **Meta** (WhatsApp messages) | the WhatsApp Business account's payment method | replies inside the customer's 24-hour window are free; template messages outside it are billed | Settings → WhatsApp → the cost counter (what Meta billed this month and last) |
| **Vercel** (hosting, functions) | Hobby, free | no bill: a feature over its monthly allowance pauses for up to 30 days | Vercel → Usage. **Vercel's fair-use terms restrict Hobby to non-commercial, personal use**, which a restaurant's app is not. Moving to Pro ($20 a month) is the fix, and Patryk's call |
| **Firebase** (the database) | Spark, free | no bill: **over any monthly limit the app is turned off until the next cycle** | Firebase console → Realtime Database → Usage. On 2026-10-09 PROD used 0.15% of storage, 5.5% of a month's downloads and 4 of 100 connections (`ROADMAP.md`, the archive entry) |
| **GitHub Actions** (backups, digest) | free minutes on the private `mgt-backups` repo | jobs stop when the month's minutes run out, unless a spending limit is set | GitHub → Settings → Billing |

---

*Keep this file current: a change to how the app is deployed, backed up or watched
changes the section here in the same PR.*
