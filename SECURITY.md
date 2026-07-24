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

**Report-only** (does not block yet — logs violations to the browser console):

- `Content-Security-Policy-Report-Only` — a full CSP shipped in **report-only**
  first, per the plan, so nothing can break in production while we confirm the
  policy is correct.

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
hash. While the CSP is report-only a stale hash is harmless (a console warning
only), but recompute it before enforcing:

```bash
npm run build
node -e 'const fs=require("fs"),c=require("crypto");const m=fs.readFileSync("dist/index.html","utf8").match(/<script>([\s\S]*?)<\/script>/);console.log("sha256-"+c.createHash("sha256").update(m[1],"utf8").digest("base64"))'
```

Paste the printed `sha256-…` into `vercel.json`'s `script-src`.

### Flipping report-only → enforce (do this deliberately, later)

1. Deploy; open the app on the Vercel preview/prod with DevTools open.
2. Exercise it (load, book, seat, offline/reconnect, Settings). Watch the
   console for **`Content-Security-Policy-Report-Only`** violation messages.
3. If any legitimate resource is blocked, add its origin to the right directive
   and redeploy. Repeat until the console is clean.
4. Rename the header key from `Content-Security-Policy-Report-Only` to
   `Content-Security-Policy` in `vercel.json` and redeploy — now enforced.

---

## 2. Firebase Auth — the #1 access-control item

The Realtime Database rules are `".read"/".write": "auth != null"`
(`database.rules.json`) — **any authenticated account has full read/write of the
entire database**, including all customer PII. That is acceptable *only* if you
control who can get an account.

**Action items (Firebase console — no code):**

1. **Verify self-signup is disabled.** In Firebase Console → Authentication →
   Settings → *User actions*, ensure **"Enable create (sign-up)"** is **OFF** for
   the Email/Password provider (or the project has no open sign-up path).
   Without this, anyone can self-register via the Identity Toolkit API and gain
   full DB access. The app has no sign-up UI, but that does not close the API.
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
