# ROADMAP

Pending work only — deferred features, follow-ups, and ideas that haven't shipped
yet. Nothing else belongs in this file: no rationale docs, no shipped-version
history (that's `REFACTOR_LOG.md`), no architecture notes (that's `CLAUDE.md`).

**Keep this current.** When an item ships, delete its entry here in the same
PR/commit that ships it — the shipped details go in `REFACTOR_LOG.md` instead.
An item that is SETTLED is deleted too, not annotated: a withdrawal ("it was not
there") and a deliberate won't-fix ("it is there and is not worth a version")
are both decisions rather than pending work, and an entry saying "we checked and
there is nothing here" is not pending work either. The measurement and the
decision go in `REFACTOR_LOG.md`, and any evergreen lesson in `CLAUDE.md`'s
Gotchas. When new deferred work or an idea surfaces, add it here. The `mgt-workflow`
skill is responsible for checking this file at the relevant points in a
session and keeping it in sync.

---

## Deferred

- **`tests/contrast.test.js` measures the wrong worst case in DARK.** Its two
  bases are `{light: white, dark: #24252a}`, described in the file as "the
  LIGHTEST (light) and DARKEST (dark) plausible base, i.e. the worst case for
  washout in each theme". That is right for a dark ink on a light fill and
  BACKWARDS for a pale ink on a dark one: a pale ink loses contrast as the
  surface behind it gets LIGHTER, so the dark half of every pairing is measured
  optimistically. Found while registering `--bg-soft` in v18.0.0 session 8 and
  measured on the shipped fix — `--text-muted` there registers **5.47:1**
  against the floor and paints at **4.11:1** on the real `rgb(57,57,59)`, a
  difference of 1.4 points. Nothing known is below spec (that one is a chevron,
  a graphical object at 3:1), but the guard's dark numbers are a ceiling rather
  than a floor across the whole palette, so the work is: give the dark base the
  lightest plausible surface, re-measure every entry, and record what moves.
  Scoped as its own change because it re-measures the entire registry.

- **The v18.0.0 production deploy.** Pending from the moment the release merges,
  and ordered: the six steps, and where each one's detail lives, are
  `database.rules.README.md` § *v18.0.0 — the production deploy, in order*.
  Delete this entry when the last of them — `enforceRoles` on — is done.

## Designed, not implemented

_(nothing pending)_

## Ideas

_(nothing pending)_
