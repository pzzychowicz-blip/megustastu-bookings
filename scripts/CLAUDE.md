# scripts — notes

Moved here from the root `CLAUDE.md` on 2026-09-17 (`/doctor`), so it loads only when
Claude opens a file under `scripts/`. The root file keeps the one rule that matters
everywhere: never hand-edit the generated icons in `public/`.

---

## `gen-icons.py` — the icon pipeline

**`scripts/gen-icons.py`** (v17.4.2) regenerates the whole PWA icon family in `public/` — `icon.svg` · `favicon.svg` · `icon-192/512.png` · `apple-touch-icon.png` (full-bleed) · `icon-maskable-512.png` — from one source of truth, so the tiles can't drift between sizes. A **design tool, not part of `npm run build`**, but since v17.4.2 it needs only `pip install playwright pillow` and **runs anywhere** (the v17.4.0 version required macOS SF Pro + fontTools, so it couldn't run in a container or on CI — that is how a design and its "single source of truth" drift apart). `MGT_CHROMIUM` optionally points it at a system Chromium. Edit the `BARS` / `TILE_STOPS` constants there and re-run (`python3 scripts/gen-icons.py public`); **never hand-edit the generated SVGs**. The mark is the v17.4.2 booking-blocks-on-frosted-glass design and carries **no type at all**, so the SVG-`<text>` font hazard can't recur — if type ever returns it must be outlined (recover the fontTools conversion from git history at v17.4.1). Icons propagate on a normal browser refresh: the v17.10.1 service worker is cache-FIRST only for hashed `/assets/` files, and `index.html` and `public/` come back network-first, so there is nothing to invalidate (this line said "there is no service worker" until v17.14.0 — true at v17.4.1, stale since v17.10.1); v17.4.2 added `?v=<version>` tokens to the icon URLs in `index.html` + the manifest to carry a change past the HTTP cache (bump them with `__APP_SIGNATURE__` whenever the icon bytes change). A home-screen shortcut still keeps the icon the OS snapshotted when it was added (iOS never refreshes it, and no query string changes that), so a tile change needs remove + re-add there.

---

## Gotchas

| Issue | Constraint |
|---|---|
| SVG `<text>` in a shipped icon | An icon referencing `font-family="-apple-system, …"` renders a DIFFERENT face on every non-Apple platform (the pre-redesign v17.4.0 icon did exactly this — Android and the Chrome tab disagreed with iOS). Icons must carry type as OUTLINES; `scripts/gen-icons.py` does the conversion |
