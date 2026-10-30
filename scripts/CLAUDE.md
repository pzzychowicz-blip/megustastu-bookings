# scripts — notes

Moved here from the root `CLAUDE.md` on 2026-09-17 (`/doctor`), so it loads only when
Claude opens a file under `scripts/`. The root file keeps the one rule that matters
everywhere: never hand-edit the generated icons in `public/`.

---

## `gen-icons.py` — the icon pipeline

**`scripts/gen-icons.py`** (v17.4.2) regenerates the whole PWA icon family in `public/` — `icon.svg` · `favicon.svg` · `icon-192/512.png` · `apple-touch-icon.png` (full-bleed) · `icon-maskable-512.png` — from one source of truth, so the tiles can't drift between sizes. A **design tool, not part of `npm run build`**, but since v17.4.2 it needs only `pip install playwright pillow` and **runs anywhere** (the v17.4.0 version required macOS SF Pro + fontTools, so it couldn't run in a container or on CI — that is how a design and its "single source of truth" drift apart). `MGT_CHROMIUM` optionally points it at a system Chromium. Edit the `BARS` / `TILE_STOPS` constants there and re-run (`python3 scripts/gen-icons.py public`); **never hand-edit the generated SVGs**. The mark is the v17.4.2 booking-blocks-on-frosted-glass design and carries **no type at all**, so the SVG-`<text>` font hazard can't recur — if type ever returns it must be outlined (recover the fontTools conversion from git history at v17.4.1). Icons propagate on a normal browser refresh: the v17.10.1 service worker is cache-FIRST only for hashed `/assets/` files, and `index.html` and `public/` come back network-first, so there is nothing to invalidate (this line said "there is no service worker" until v17.14.0 — true at v17.4.1, stale since v17.10.1); v17.4.2 added `?v=<version>` tokens to the icon URLs in `index.html` + the manifest to carry a change past the HTTP cache (bump them with `__APP_SIGNATURE__` whenever the icon bytes change). A home-screen shortcut still keeps the icon the OS snapshotted when it was added (iOS never refreshes it, and no query string changes that), so a tile change needs remove + re-add there.

---

## Reading a crash's stack — rebuild on demand (v18.13.0)

Production ships no source maps, and nothing about production changes for this. A crash
entry's frames are minified positions (`assets/index-x.js:1:123456`), read by rebuilding the
commit that crashed, with a map, in a throwaway copy.

1. Settings → Admin → **Open the log** → **Crashes** → **Download crash data**. Each entry
   carries its `version`.
2. Find that version's merge on `main`:

   ```bash
   git log --first-parent origin/main --format='%h %s' --grep='v18.13.0'
   ```

3. Rebuild that commit. **`VERCEL_ENV=production` is not optional**, and the reason is below:

   ```bash
   git worktree add /tmp/mgt-rebuild <commit>
   cd /tmp/mgt-rebuild && npm ci && VERCEL_ENV=production npx vite build --sourcemap hidden
   ```

4. The printed `index-….js` must be the name in the entry's frames. If it is not, stop: this
   is not the build that crashed, and every line it would give you is wrong.
5. Decode, from the main checkout. A frame this rebuild has no file for says so:

   ```bash
   node scripts/decode-stack.mjs ~/Downloads/mgt-crashes-<date>.json /tmp/mgt-rebuild/dist
   ```

6. `git worktree remove --force /tmp/mgt-rebuild`.

**Why it can be trusted, measured 2026-10-30.** A commit builds to the same bytes every time:
34 of 34 output files from a clean copy, in another directory, on Node 24. CI's build of
`bb168e15` (Linux, Node 22) and a local one (macOS, Node 24) both gave `index-BIhywGog.js`.
**That is not production's name.** `vite.config.js` inlines `VERCEL_ENV` as
`VITE_DEPLOY_ENV`, so Vercel's build of the same commit is `index-y47v6LRu.js` (its build log,
430.02 kB, 125.64 kB gz), and a local build with `VERCEL_ENV=production` gives that exact name
and size. Without the variable the file is ten characters shorter from `useSchemaGate` onward,
so a map from it would answer every later frame with a real-looking wrong line.

`--sourcemap hidden` leaves the bundle byte-identical, where plain `--sourcemap` adds a comment.
Proved end to end on a production rebuild: three strings found in the real bundle, handed to
the script as frames, came back as the exact lines holding them.

`vite build` rather than `npm run build`, because the second half of that is `/wa-connect`.
A frame from it decodes the same way with `-c vite.wa-connect.config.js`. A preview's frames
want `VERCEL_ENV=preview`, and the sandbox's `VITE_FB_TARGET=dev` as well.

## Gotchas

| Issue | Constraint |
|---|---|
| SVG `<text>` in a shipped icon | An icon referencing `font-family="-apple-system, …"` renders a DIFFERENT face on every non-Apple platform (the pre-redesign v17.4.0 icon did exactly this — Android and the Chrome tab disagreed with iOS). Icons must carry type as OUTLINES; `scripts/gen-icons.py` does the conversion |
