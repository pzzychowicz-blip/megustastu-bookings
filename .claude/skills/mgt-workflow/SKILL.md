---
name: mgt-workflow
description: The standing workflow contract for the MGT Bookings repo (Me Gustas Tú booking system, github.com/pzzychowicz-blip/megustastu-bookings) — covers both session-start context bootstrapping AND git/branching/versioning. Load this at the START of every session in this repo (even before any coding task is clear) to run a cheap staleness check and decide whether last session's thread summary is worth reading. ALSO load it before making any edit under src/, and before any commit, push, branch, PR, or version bump — the branch name and whether you're even allowed to start depend on decisions made before the first edit, not just at commit time. Also triggers on "give me the deployment version", "give me changelog", "sum up this thread", "ship this", "let's deploy/release this", "continue where we left off", or anytime the user references prior context, branch naming, __APP_SIGNATURE__, or REFACTOR_LOG.md. Use this instead of re-deriving the workflow from CLAUDE.md's prose each time — same rules, as a checklist that's hard to skim past.
---

# MGT Bookings — workflow contract

Patryk is the sole developer and sole merger of this repo. This skill exists so its
conventions get *applied* consistently, not re-explained every session. If anything
here conflicts with what CLAUDE.md says, CLAUDE.md wins — this is a distillation of
its "Workflow" section into something you act on step-by-step, not a replacement for
it.

## 0. Session bootstrap — do you need last session's context?

CLAUDE.md is auto-loaded fresh from disk into every session, so it is never "stale"
as a *file* — but it can be **silent about unfinished business**: a decision made,
a plan agreed, or a bug half-diagnosed in a previous conversation that never made it
into CLAUDE.md/REFACTOR_LOG because the session ended first. That's what a thread
summary (`MGT_Bookings_<topic>_Thread_Summary.md`, in the context folder) exists to
carry forward. Reading one costs real tokens, so do it only when there's an actual
signal you need it — not by default, and not just because one exists.

**Run this cheap check at the start of every session, before anything else:**

1. Read `src/App.jsx`'s `__APP_SIGNATURE__.version` and the version heading at the
   **bottom** of `REFACTOR_LOG.md` (its most recent entry). These should match.
2. If they **don't** match, or `git log -5` shows commits that don't correspond to
   REFACTOR_LOG's latest entry — that's a documentation-drift signal: something
   happened that wasn't wrapped up. Worth investigating before you proceed.
3. Separately, read the user's opening message for **phrasing cues**: "like we
   discussed," "continue where we left off," a named decision/bug/feature that isn't
   documented anywhere in CLAUDE.md or REFACTOR_LOG. That's a second, independent
   trigger — state can be perfectly in sync while a conversational thread is still
   dangling.

**If neither signal fires:** proceed normally. CLAUDE.md + REFACTOR_LOG + memory
already give you everything you need — reading a thread summary here would just
burn tokens for no benefit. This is the common case; don't go looking by habit.

**If either signal fires:** check the context folder for a relevant summary —
**use the absolute path**, not a relative one:

```bash
ls -t "/Users/patrykzychowicz/Desktop/megustastu-bookings context"/MGT_Bookings_*_Thread_Summary.md 2>/dev/null | head -5
```

(A relative `../megustastu-bookings context` breaks inside a worktree session — see
the worktree-path gotcha in CLAUDE.md. Always use the absolute path above.)

Read the **most recently modified** match — `ls -t` already sorts newest-first, so
the first line is it. Don't read every summary in the folder; one file is almost
always the right amount of context. If the drift signal (step 2) and the phrasing
cue (step 3) point at clearly different topics, use judgment — the phrasing cue
usually wins, since it's the user telling you directly what they need.

**Keep this cheap for the *next* session too.** CLAUDE.md already asks for a fresh
thread around the ~25-message mark ("Conversation budget" in Workflow) — take that
seriously and suggest it proactively rather than waiting to be asked, since a
"sum up this thread" you prompted for is exactly what makes next session's step 3
a non-event instead of a guessing game.

## 1. Before you touch anything in `src/`

Run this check as the first thing you do, before writing a single line of code:

```bash
git branch --show-current
/opt/homebrew/bin/gh pr list --state open --base main
```

(`gh` is not on `$PATH` in this environment — always use the full path above.)

- **On `main`?** Branch first. Never commit work-in-progress directly to `main`.
- **An open PR listed?** Stop and tell the user. Per the locked deployment flow, a new
  version branch does not start until the previous PR merges — bundling two versions'
  worth of change across branches is exactly what this rule prevents. Wait, or ask
  whether they want to continue on the existing branch instead of starting a new one.
- **Clean, no open PR, already on a `feat/v.../fix/v.../chore/...` branch?** Carry
  on — you're already mid-version, no need to re-branch.
- **Clean, no open PR, but on some other branch** (main, or a harness-assigned
  `claude/…` session branch) **and about to actually ship a version bump?** Still
  cut a fresh, properly-named branch per §2 first. Being "already off main" is not
  the same as being on a version branch — don't let it substitute for one.

Only after this check do you decide the branch name (§2) and start editing.

## 2. Branch naming

Cut fresh off an up-to-date `main`:

```bash
git checkout main && git pull --ff-only
git checkout -b feat/v{X.Y.Z}-{slug}   # user-visible feature / behavior change
git checkout -b fix/v{X.Y.Z}-{slug}    # bug fix / hotfix that still bumps the version
git checkout -b chore/{slug}           # docs, tooling, pure refactor — no version-worthy behavior change
```

`{X.Y.Z}` is the version this branch will ship *as* — decide it now (§3), not at commit
time, so the branch name and `__APP_SIGNATURE__` never disagree.

(CLAUDE.md's prose only spells out `feat/`/`chore/`, but repo history establishes
`fix/` for bug fixes and hotfixes — e.g. `fix/v17.4.1-sw-killswitch`, the PWA
kill-switch hotfix. Use it for that case rather than forcing a bug fix into `feat/`.)

## 3. Versioning — decide the bump before you branch

Single source of truth: `src/App.jsx` → `__APP_SIGNATURE__.version`. Schema
`MAJOR.MINOR.PATCH`.

| Bump | When |
|---|---|
| **Major/minor** | A user-visible feature shift — something staff would notice using the app. |
| **Patch** | A structural refactor, bug fix, or internal change with no new user-facing behavior. |

**Every meaningful change bumps the version, in the same branch/PR.** There is no
"ship without a bump" — if you're opening a PR against `main`, `__APP_SIGNATURE__` has
moved. A same-version follow-up commit (fixing review feedback on a still-open PR)
does *not* get its own bump or its own REFACTOR_LOG section — see §5.

## 4. The ship checklist

Work through this in order. Don't skip a step because it "doesn't apply this time" —
confirm it doesn't apply, don't assume.

1. [ ] On a fresh branch off `main`, named per §2.
2. [ ] Edits made in `src/`.
3. [ ] `__APP_SIGNATURE__.version` bumped in `src/App.jsx` (§3).
4. [ ] `CLAUDE.md` updated — **only if** this change affects the file-structure block or
   a locked-decision — i.e. a new hook/component, a changed data shape, a new
   architectural rule. A pure bugfix with no structural change touches neither.
5. [ ] `REFACTOR_LOG.md` gets an entry (§5) — append at the bottom, never renumber
   history.
6. [ ] `npm run build` succeeds. Note the main-bundle gz size delta in the commit
   message or REFACTOR_LOG entry — this is how bundle bloat gets caught early.
7. [ ] Commit — descriptive message, ends with the Claude co-author trailer. **Only
   when the user has explicitly asked you to commit** — see the hard rules below.
8. [ ] `git push -u origin <branch>` — **only when explicitly asked.** A push is a
   shared-state action; a prior approval to push doesn't carry over to the next one.
9. [ ] `gh pr create --base main --head <branch> …` — body ends with the "Generated
   with Claude Code" line.
10. [ ] Patryk reviews and merges. **You never merge your own PR** — not even if asked
    to "just finish it up," since merge authority is explicitly his.
11. [ ] After merge, confirm the prod console boot banner / `window.__MGT_BUILD__`
    shows the new version — this is the actual verification that the deploy landed,
    not just that the PR merged.
12. [ ] Sync the local checkout: `git checkout main && git pull --ff-only`.

## 5. REFACTOR_LOG.md discipline

Every shipped version gets one entry: date, files changed, behavioral-change status
(almost always "None" for pure refactors), line delta, scope, key design decisions,
verification results. Keep entries **chronological, newest at the bottom** — never
reorder history to group by topic.

**Same-version follow-up ≠ new entry.** If the user asks for a change on a branch
that's still open (addressing review feedback, a QA fix before merge), *extend* the
existing version's entry rather than appending a new dated section. A new section
implies a new version bump, which contradicts §3.

## 6. Hard rules (non-negotiable, not situational)

- **Never bundle multiple versions on one branch.** One version per branch, one
  branch per PR, always.
- **If a previous PR is open, wait for it to merge** before starting the next version
  branch (§1). Don't work around this by stacking branches.
- **Commit and push only when the user explicitly asks**, each time — this isn't a
  standing permission once granted. Making the edits and running the build does not
  imply "and now commit it."
- **Never use `-i`/interactive git flags** (`rebase -i`, `add -i`, etc.) — unsupported
  in this environment and would silently hang or fail.
- **`gh` is at `/opt/homebrew/bin/gh`**, not on `$PATH` — always call it by full path
  or the command will appear to not exist.
- **Local dev is `npm run dev` only.** Never `npm run preview` — `dev` hits the DEV
  Firebase project (the safe sandbox, per `src/firebase.js`'s `import.meta.env.DEV`
  split); the split must never be bypassed. Production-build verification is Patryk's
  job, not something to attempt from this environment.
- **DEV Firebase is a sandbox you can write to freely; never touch PROD data** while
  inspecting or testing, even read-only exploration should stay mindful of which
  environment a given action targets.

## 7. Known trigger phrases (already defined elsewhere — don't redefine)

These phrases have specific, already-documented behavior — recognize them and act
per CLAUDE.md, don't improvise a new interpretation:

- **"give me the deployment version"** — produce a production-ready file with
  Firebase integration, auth, cleanup logic, logout.
- **"give me changelog"** — generate a PDF changelog per
  `MGT_Changelog_Instructions.md`.
- **"sum up this thread"** — produce a markdown thread-summary and update *both* the
  context folder and this repo's `CLAUDE.md`/`REFACTOR_LOG.md` mirrors. The full
  dual-folder mechanics are already spelled out in CLAUDE.md's "Trigger phrases"
  section (and in memory as `sum-up-thread-implies-merged.md`) — read those rather
  than reconstructing the behavior from scratch.

## When this skill doesn't apply

Sections 1-7 govern the moment work is actually about to land in `src/` with intent
to ship — pure exploration, reading code, or answering "how does X work" doesn't need
the branch/PR machinery. **§0 (session bootstrap) is the exception: it's cheap by
design and worth running even in a pure Q&A session**, since knowing whether you're
missing context is useful regardless of what the session turns into.

**Tooling-only changes** (`.claude/` skills/settings/hooks, CI config, this file
itself) that never touch `src/` don't get an `__APP_SIGNATURE__` bump or a
REFACTOR_LOG entry — those two are specifically about the shipped app's version
history, not the dev environment. §4-7 still apply in spirit (branch off main, PR,
Patryk merges) — only §3's version bump and §5's log entry are skipped.

**Worktree sessions:** it's fine to *explore, read, and edit* on a harness-created
`claude/…` branch without renaming it first — that's the environment's own naming,
not a violation of §2. But this is exploration-only slack, not a way to skip §2: the
moment you're about to bump `__APP_SIGNATURE__` and commit — i.e. you've reached §4's
ship checklist for real — cut a proper `feat/v.../fix/v.../chore/...` branch off main
first, even if that means branching again from where you already are. Landing a
version bump on a `claude/…` branch is exactly the un-versioned, un-PR'd commit §2
exists to prevent; "I was already on a branch" is not an exception to it.
