# Claude Design sync — notes for the next run

What `/design-sync` needs to know about this repo that `config.json` cannot say.
Read this first; add to it whenever a sync teaches something new.

## Status

- **First sync, started 2026-09-19.** Built, validated with zero warnings, and all
  75 components graded `good` locally. **Not uploaded yet**: DesignSync needs a
  one-time `/design-login` from an interactive `claude` session on this Mac.
  The project is to be called **MGT Bookings** (the app's name, not the
  restaurant's). There is no `projectId` in `config.json` until it is created.

## Decisions (Patryk, 2026-09-19)

- **Scope:** the whole UI kit (`atoms.jsx`, the token scales, the `mk*` style
  factories, every icon) plus seven signature screens: `TimelineView`,
  `ListView`, `PlanView`, `WeekView`, `BookingFormModal`, `TableGrid`,
  `MessageBubble`.
- **Font: Inter, in the design system only.** The app keeps the device's
  system font (SF Pro on the restaurant's Apple devices). The design system
  ships Inter so every viewer sees the same face. The known difference: Inter
  is slightly wider, and one line wraps where the app's does not (the
  timeline's empty-day prompt orphans "in.").
- **Guidelines:** a short `conventions.md` (the README header), not all of
  `DESIGN.md`. At 112 KB and mostly history and code-level rules, `DESIGN.md`
  is too heavy for the design agent to read on every design.
- **Icons:** one shared preview template (`previews/_shared/icon-card.tsx`)
  instead of blank floor cards.

## How the build works

- The app has no library build, so `.design-sync/entry.js` is a barrel that
  re-exports the kit and the seven screens. `vite.lib.config.mjs` compiles it
  with the app's own Vite + React plugin into `.design-sync/.lib/`, which is
  git-ignored. `buildCmd` runs that build.
- **Five components are deliberately absent**: `Settings`, `AdminSettings`,
  `VouchersSettings`, `LoginScreen` and `WaSimulator`. Their import graphs reach
  `src/firebase.js`, which would initialise Firebase inside every design. Check
  the import graph of anything you add to the barrel.
- **Stylesheet:** the barrel imports `src/index.css` and then
  `design-font.css`, and Vite emits both, in that order, as `.lib/index.css`
  (`cssEntry`). The converter copies `cssEntry` verbatim and does not follow
  `@import`, and its `extraFonts` step keeps only `@font-face` rules. That is
  why the `--font-app` override has to be compiled into the one file.
- **Inter's files** come from `@fontsource-variable/inter@5.3.0` (SIL OFL 1.1),
  installed into the git-ignored `.ds-sync/`. `fonts.css` points there. After
  the skill re-stages `.ds-sync/`, reinstall before building:
  `cd .ds-sync && npm install --no-save @fontsource-variable/inter@5.3.0`.
  Two files ship: Latin (48 KB) and Latin Extended (85 KB).
- `runtimeFontPrefixes: ["SF Pro"]`: the app's own `--font-app` declaration is
  still in the stylesheet, overridden, so the validator sees SF Pro named.
  Nothing renders in it.
- **Environment:** Node 24.14.1. `engines` says 22.x, but no 22 is installed
  here, and nothing in the sync cared. Playwright 1.60.0 with its cached
  `chromium-1223`.

## Previews — what made them render right

- **Modal previews go inside `ModalStage`** (`previews/_shared/backdrop.tsx`).
  `Overlay` is `position: fixed`, and the card wraps each story in a
  transformed element, which becomes the containing block. With nothing sized
  around it, the modal centres in a zero-height box. The stage gives it a real
  size and paints an app page behind the scrim for the blur. It also blurs the
  active element after mount: `Overlay` focuses its dialog, and without a
  pointer event first the browser draws a keyboard focus ring round the card.
- **Modal screens are single cards** (`Overlay`, `ModalPresence`, `WeekView`,
  `BookingFormModal`): the validator flags fixed-position content in a grid
  card (GRID_OVERFLOW). The other stories stay graded; the card shows the
  primary one.
- **Wide screens are column cards with tall viewports.** The capture is cut at
  the viewport height, and a cut sheet hid the "finished" fold and the plan's
  hint line.
- **Fixtures follow the real clock** (`previews/_shared/fixtures.ts`).
  `PlanView` and `WeekView` call `todayStr()` themselves, so the sample day is
  always "today". The capture browser's clock is frozen at 2024-05-15, so
  sheets show that date. The service is frozen at 20:10 through `nowMins`.
- **`BookingFormModal` previews run with `autoOptimizer` off.** With it on,
  the form previews a whole-day re-plan, and because the sample tables are
  hand-placed it correctly announces a move on every edit.
- `WeekView` keeps its mode internally. The Month and Stats stories press the
  segment button inside their own stage; a window-level key would switch every
  mounted WeekView at once.
- Use the app's real strings, labels and modal colours. An invented message
  or a red invalid border was caught more than once. The real ones are in
  `App.jsx` (`setError`) and each component's `ModalTitle`.

## Converter behaviour worth knowing

- A full `package-build` wipes `ds-bundle/_screenshots`, so recapture after it.
- Changing `overrides` makes `preview-rebuild` refuse with CONFIG_STALE, so run
  a full build. `cardMode` and `primaryStory` are the exception: they are
  presentation-only.
- Grades are keyed on the preview's source. Editing a `.tsx` clears its grade,
  and `package-capture --force` clears grades too.

## Known render warnings

None as of 2026-09-19. The validator exits with zero warnings.

## Re-sync risks

- A new export from `atoms.jsx`, `Icons.jsx` or `WaIcons.jsx` enters the bundle
  through `export *`. It still needs a `componentSrcMap` entry, a doc in
  `docs/`, a `dtsPropsFor` body and a preview. For an icon, copy any generated
  `*Icon.tsx` and change the name and label.
- A new per-booking field: add it to `bk()` in `fixtures.ts` too. The fixture
  mirrors `sanitize`.
- A prop change on one of the seven screens: update its `dtsPropsFor` body and
  its doc. Both were written by hand from the source.
- A layout change to `DEFAULT_LAYOUT` (table ids): update the `FLOOR` fixture,
  whose table entries are keyed by id.
