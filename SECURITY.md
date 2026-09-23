# Security — headers, CSP, and Firebase access

Operational notes for the app's security posture. Companion to
`database.rules.json` / `database.rules.README.md` (the Realtime Database rules).

---

## 1. HTTP security headers (`vercel.json`)

`vercel.json` sets response headers on every route (`source: "/(.*)"`). Vercel
applies them to the deployed site only — **they do NOT apply to
`npm run dev` on localhost**, so local development is unaffected.

**Enforced** (safe, no app impact):

| Header | Value | Purpose |
|---|---|---|
| `X-Frame-Options` | `DENY` | Anti-clickjacking (no framing). |
| `X-Content-Type-Options` | `nosniff` | Block MIME sniffing. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Don't leak full URLs off-site. |
| `Strict-Transport-Security` | `max-age=31536000` | Force HTTPS for a year. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` | Disable APIs the app never uses; opt out of FLoC. |

**Enforced since 2026-07-24** (shipped report-only first per the plan; flipped
after verifying on production: `curl -I` showed all headers live, the deployed
inline-script hash matched the pinned `sha256-…` byte-for-byte, and a static
scan of the built bundle found no `eval`, no worker instantiation, no external
fonts/images, and every network endpoint covered by `connect-src`):

- `Content-Security-Policy` — the full policy below.

### CSP directives, and why each is what it is

- `script-src 'self' 'sha256-…'` — the Vite module bundle is same-origin
  (`'self'`); the **one inline `<script>`** (the no-flash theme init in
  `index.html`) is pinned by **hash**, so `script-src` never needs the much
  weaker `'unsafe-inline'`.
- `style-src 'self' 'unsafe-inline'` — the app is inline-style-based
  (thousands of `style={…}` props; the stylesheet itself has been a hashed
  `src/index.css` asset since v17.15.1, no longer a `<style>` block in
  `index.html`); `'unsafe-inline'` for **styles** is unavoidable and low-risk.
- `connect-src` — Firebase Realtime Database (`*.firebasedatabase.app`,
  `*.firebaseio.com`, both https + wss) and Auth/installations
  (`*.googleapis.com`).
- `img-src 'self' data:` · `font-src 'self'` (system-font stack, no web fonts)
  · `frame-src 'self' https://*.firebaseapp.com` (defensive — email/password
  auth needs no iframe, but the SDK may create one) · `object-src 'none'` ·
  `base-uri 'self'` · `form-action 'self'` · `frame-ancestors 'none'`.

### If you change the inline no-flash script

The CSP hash is computed over the **exact bytes** of the inline `<script>` in
`index.html`. Editing that script (e.g. new localStorage keys) changes the
hash. **The CSP is now ENFORCED — a stale hash breaks the theme no-flash script
in production.** Recompute it in the same PR as any edit to that script:

```bash
npm run build
node -e 'const fs=require("fs"),c=require("crypto");const m=fs.readFileSync("dist/index.html","utf8").match(/<script>([\s\S]*?)<\/script>/);console.log("sha256-"+c.createHash("sha256").update(m[1],"utf8").digest("base64"))'
```

Paste the printed `sha256-…` into `vercel.json`'s `script-src`.

### If the enforced CSP ever blocks something legitimate

Symptom: a red `Refused to load/connect …` console error naming the directive.
Fix: add the origin to that directive in `vercel.json` and redeploy. As an
emergency rollback, rename the key back to
`Content-Security-Policy-Report-Only` — the app works again immediately while
you diagnose.

---

## 2. Who can read and write the database

Rewritten for v18.0.0 on 2026-09-23. The earlier version described a single
`".read"/".write": "auth != null"` pair for the whole database, which stopped being
true in v16.0.0 for writes and never covered roles, the server tier or WhatsApp.

**Reads: every signed-in account can read everything.** `.read` is `auth != null`
at the ROOT, and read permission cascades down and cannot be revoked at a child. So any
account that can sign in reads every booking and phone number, the vouchers, the
activity log, roles and invites, and (once WhatsApp is live) every conversation and
message. This is why nothing secret may ever be stored in the database, and why the
item below is still the most important one.

1. ✅ **Self-signup is disabled.** Verified by Patryk on 2026-07-24 (Firebase Console →
   Authentication → Settings → *User actions*). Without it, anyone could register
   through the Identity Toolkit API and read the whole database, because the app having
   no sign-up screen does not close the API. **If the Auth configuration is ever reset,
   check this first.** (`api/_lib/env.js` makes the same point from the server side:
   Firebase's DEFAULT is signup on, so "has a token" is not "is staff".)

**Writes are granted per path, never globally.** There has been no root `.write` since
v17.16.7. Every writable node carries its own grant, and every write proves it was based
on the data it replaces: a per-child compare-and-swap for `bookings`, `vouchers`, `roles`
and `invites`, or a `<name>Rev` +1 pair for whole-node collections. `activity` is
append-only and bound to its author, and `presence` is per-connection.
`database.rules.README.md` has every node.

**Roles (v18.0.0).** Each account has a level and capability grants at `/roles/$uid`.
The rules gate eight capabilities: `settingsWrite`, `settingsAdmin`, `hoursEdit`,
`layoutEdit`, `reminderManage`, `recurringManage`, `bookingDelete` and
`customerDelete`.
**`settings/admin.enforceRoles` is ON in production.** All six deploy steps were done
(confirmed by Patryk, 2026-09-23). An account with no role row reads as staff. **One
capability has no rule behind it: `dataExport`** (Download backup). The file is built
from reads, and reads cannot be restricted per account (above), so hiding the button is
the whole of that control.

2. **(Optional, defence in depth) Restrict READS to accounts with a role row**, e.g.
   root `.read`: `auth != null && root.child('roles').child(auth.uid).exists()`. Every
   real account has had a row since v18.0.0, so this would be the read-side twin of the
   role gates. It is not done, and it needs its own design: a new account writes its
   row as the app loads, and every listener would fail until that write lands. Test in
   the emulator and on DEV before PROD.

**The server tier (`api/`, v18.0.0).** Production routes four functions: `wa-inbound`,
`wa-send`, `wa-recheck` and `wa-config`. They write through **firebase-admin, which
bypasses the security rules entirely**, so their gates are in code:
- `wa-send`, `wa-recheck` and `wa-config` verify a Firebase ID token
  (`verifyStaffToken`, `api/_lib/rtdb.js`). When sending live, or when pointed at any
  database but DEV, they also require the account's email to be on `WA_STAFF_EMAILS`
  (`requireStaffAllowList`, `api/_lib/env.js`).
- `wa-inbound` is a public webhook and checks Meta's HMAC signature
  (`api/_lib/meta.js`).
- Keys (the Meta token, the Gemini key, the service account) live in the deployment's
  environment variables and never in the database.
- The simulator's endpoints are left out of production deployments by `.vercelignore`,
  and return 404 unless `WA_SIM_ENABLED=1`.

---

## 3. Personal data (GDPR)

An EU business (Fuerteventura, Spain). What the app keeps about people, and where:

| Where | What | Kept for |
|---|---|---|
| `bookings` | guest names, phone numbers, free-text notes (allergies, occasions), history | **no automatic purge** (an auto-erase was investigated and dropped) |
| `vouchers` | free-text `notes`, and `issuedBy` (the issuing account's email) | never deleted, only voided (the code is the key) |
| `activity` | every entry's author (`uid`, `email`). Guest names are never stored, except a DELETED booking's `subject` and `guestKey` | pruned after `settings/admin.activityRetentionDays` (default 365, at most 3650) |
| `conversations`, `messages` (WhatsApp, when the module is on) | the guest's phone number (the key) and message text, up to 4,000 characters per message | **no retention: nothing deletes them automatically** |
| Download backup | the database on a device: the whole of it since v18.1.1, partial before that | as long as the file is kept. Treat it as the database |

**Where data leaves Firebase** (the database itself is Google Firebase, in
`europe-west1`):
- **Meta (WhatsApp Cloud API):** every WhatsApp message, in both directions.
- **Google (Gemini API):** in live parse mode (`WA_LLM_MODE=live`), the first 1,000
  characters of each inbound message (`WA_PARSE_TEXT_LEN`), plus up to 12 recent
  messages of the conversation on a re-check, go out to be parsed.
- **Vercel (function logs):** `api/_lib/gemini.js` logs **the first 200 characters of
  every parsed message** and the parse result on every parse. The result holds name,
  party size, date, time and `notes`, which the prompt fills with allergies,
  birthdays and wheelchair needs. **Those notes are health data** (GDPR Art. 9). A
  re-check logs its parse result too. Vercel's log retention applies.

**Right to erasure.** Settings → Customers → **Delete customer & all data**
anonymizes that guest's bookings (name → "Data removed", phone, notes and history
wiped, statistics kept) and redacts their entries in the activity log. **It does not
touch WhatsApp.** The guest's `conversations/<phone>` and `messages/<phone>` survive,
and the only way to remove them is deleting the conversation from the Inbox. That
gap has to close before WhatsApp goes live (`ROADMAP.md`).

**Access:** every signed-in account sees every customer's data (§2). That's acceptable
for one small team, but it's a decision, not an accident.

**Open, to decide before WhatsApp goes live:**
- a retention period for messages
- whether the parse log line keeps the message text and `notes` in live mode
- erasure reaching WhatsApp data
- per-role read scope

The public `/privacy` page Meta requires draws on this section.

---

## 4. This repository is public

The code, `REFACTOR_LOG.md`'s incident notes and the rules reasoning in
`database.rules.README.md` can all be read by anyone. `LICENSE` calls the code
"proprietary and confidential", which is a statement about rights and does not make
the contents private. Keep that in mind when writing either.

- **No secrets are in the tree or the history.** Scanned on 2026-09-23 for private
  keys, Meta and GitHub tokens, and Gemini key values: none. The two Firebase web
  `apiKey`s (`src/firebase.js` for DEV, `src/tenants/mgt.js` for PROD) are public by
  design, since they ship in every browser bundle. Access is controlled by §2, not by
  the key.
- **Optional hardening:** restrict each browser key by HTTP referrer in the Google
  Cloud console (APIs & Services → Credentials), trying it on DEV first.
- **Keep personal data out of it:** no backup files, exports or screenshots with real
  guests. That includes GitHub Actions artifacts and logs, which are public on a public
  repository.
