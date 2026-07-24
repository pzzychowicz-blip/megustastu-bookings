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
  (thousands of `style={…}` props + the big `<style>` block in `index.html`);
  `'unsafe-inline'` for **styles** is unavoidable and low-risk.
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

## 2. Firebase Auth — the #1 access-control item

The Realtime Database rules are `".read"/".write": "auth != null"`
(`database.rules.json`) — **any authenticated account has full read/write of the
entire database**, including all customer PII. That is acceptable *only* if you
control who can get an account.

**Action items (Firebase console — no code):**

1. ✅ **Self-signup is disabled** — verified by Patryk, 2026-07-24 (Firebase
   Console → Authentication → Settings → *User actions*). Without this, anyone
   could self-register via the Identity Toolkit API and gain full DB access
   (the app has no sign-up UI, but that alone does not close the API). If the
   Auth config is ever reset, re-verify this first.
2. **(Optional, defense-in-depth) UID allowlist.** Tighten the rules to an
   explicit staff list, e.g.

   ```json
   ".read":  "auth != null && root.child('staff').child(auth.uid).exists()",
   ".write": "auth != null && root.child('staff').child(auth.uid).exists()"
   ```

   with a `staff/{uid}: true` node per staff member. Deploy app-compatible and
   test on DEV first, per `database.rules.README.md`.

---

## 3. Customer data (PII / GDPR)

The database stores real customer names, phone numbers, and free-text notes for
an EU business (Fuerteventura, Spain), readable by any staff login. Current
posture and gaps:

- **Right to erasure:** "Delete customer" (Settings → Customers) **anonymizes**
  the bookings — name → "Data removed", phone/notes/history wiped, statistics
  kept. Good.
- **Retention:** there is **no automatic purge** of old bookings/PII (an
  auto-erase feature was investigated and dropped). If a retention policy is
  desired, it would need to be added (a scheduled anonymize of bookings older
  than N months).
- **Access:** all staff see all customer data (no per-role scoping) — acceptable
  for a single small team, but worth a conscious decision.

*This section is a stance to confirm, not a code change.*
