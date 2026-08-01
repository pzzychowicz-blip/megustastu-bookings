---
name: mgt-workflow
description: The standing workflow contract for the MGT Bookings repo (Me Gustas Tú booking system, github.com/pzzychowicz-blip/megustastu-bookings) — covers session-start context bootstrapping, git/branching/versioning (one version per branch, but one commit per feature — never bundle changes into a single commit), AND keeping ROADMAP.md (the pending-work/deferred-features/ideas file) in sync. Load this at the START of every session in this repo (even before any coding task is clear) to run a cheap staleness check and decide whether last session's thread summary is worth reading. ALSO load it before making any edit under src/, before any commit, push, branch, PR, or version bump, and before finishing any task — the branch name, whether you're even allowed to start, and whether ROADMAP.md needs an update all depend on decisions made before the first edit and at task close, not just at commit time. A mandatory `/code-review` gate runs before EVERY push — Claude cannot invoke it, so Patryk types "/code-review and push" and Claude carries the gate through to the push in that same turn — and "sum up this thread" means the branch is already merged and gets its merge-confirmations asked in one batch. Also triggers on "/code-review and push", "give me the deployment version", "give me changelog", "sum up this thread", "ship this", "let's deploy/release this", "continue where we left off", "what's on the roadmap", "add this to the roadmap/backlog", or anytime the user references prior context, branch naming, __APP_SIGNATURE__, REFACTOR_LOG.md, or ROADMAP.md. Use this instead of re-deriving the workflow from CLAUDE.md's prose each time — same rules, as a checklist that's hard to skim past.
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
- **An open PR listed?** Don't start a *new version* branch — that rule still holds,
  and it's what keeps two versions from being in flight at once. But adding another
  feature to the version that's already open is entirely normal (§3), so put the
  choice to the user: land this as another commit on the open branch under the same
  version, or wait for the merge and start the next version fresh. Recommend one
  rather than just listing both.
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

## 3. Versioning — one version per branch, one bump in the first commit

Single source of truth: `src/App.jsx` → `__APP_SIGNATURE__.version`. Schema
`MAJOR.MINOR.PATCH`.

| Bump | When |
|---|---|
| **Major/minor** | A user-visible feature shift — something staff would notice using the app. |
| **Patch** | A structural refactor, bug fix, or internal change with no new user-facing behavior. |

**A version can carry several features.** v16.3.0 shipped 11, v17.0.0 shipped 6,
v17.6.0 shipped 6 — one branch, one version, many commits. Size the bump by the
version's overall user-visible impact, not by counting features: a handful of internal
refactors together is still a patch; one new staff-facing view is a minor.

**The bump happens once, in the branch's first commit** — so the branch name and
`__APP_SIGNATURE__` agree from the very start, and a branch abandoned mid-way is still
self-consistent. Every later commit on that branch (another feature, a correction
round, a review fix) leaves the version line alone. There is no "ship without a bump":
if you're opening a PR against `main`, `__APP_SIGNATURE__` has moved exactly once.

## 4. The ship checklist

Three parts: set the branch up once, commit each change separately, ship the branch
out once. Don't skip a step because it "doesn't apply this time" — confirm it doesn't
apply, don't assume.

**Once, when the branch starts:**

1. [ ] Cut a fresh branch off `main`, named per §2.

**Then once per feature / fix / follow-up — each gets its OWN commit (§7):**

2. [ ] Make just that one change's edits in `src/`. Don't let a second feature ride along.
3. [ ] *First commit of the branch only:* bump `__APP_SIGNATURE__.version` (§3).
4. [ ] `REFACTOR_LOG.md` — the first commit creates this version's entry, every later
   commit **extends that same entry** (§5). Never a second entry for one version.
5. [ ] `CLAUDE.md` — only if *this particular* change touches the file-structure block
   or a locked decision (new hook/component, changed data shape, new architectural
   rule). Most commits won't.
6. [ ] `npm run build` **and** `npm test` pass. Together they run in ~1s here, so do it
   for every commit — a `git bisect` should never land on a broken one. Note the
   main-bundle gz delta.
7. [ ] Commit this one change (subject format below). **Only when the user has
   explicitly asked you to commit** — see §7.

   → Then loop back to step 2 for the next change.

**Once, when the version is ready to go out:**

8. [ ] **No push until `/code-review` has run over the branch diff.** You can't invoke
   it — Patryk types `/code-review and push`. Then fix critical findings unprompted and
   put everything else to him in one question. See the gate below.
9. [ ] `git push -u origin <branch>` — **only when explicitly asked.** A push is a
   shared-state action; a prior approval doesn't carry over to the next one.
10. [ ] `gh pr create --base main --head <branch> …` — body ends with the "Generated
    with Claude Code" line.
11. [ ] Patryk reviews and merges. **You never merge your own PR** — not even if asked
    to "just finish it up," since merge authority is explicitly his.
12. [ ] After merge, confirm the prod console boot banner / `window.__MGT_BUILD__`
    shows the new version — that's the real proof the deploy landed, not just that the
    PR merged.
13. [ ] Sync the local checkout: `git checkout main && git pull --ff-only`.

Review fixes arriving *after* the PR is open are just more passes through steps 2–7 on
the same branch — new commits, same version, same REFACTOR_LOG entry.

**Commit subject format** (established by repo history — keep it):

```
v17.0.0 phase 1: PENDING booking status
v16.3.0 (phase 11): recurring / standing bookings
v17.0.0 correction round 7: OverlapBanner + banner master switches
v17.6.0: extend the REFACTOR_LOG entry with commits 5/6 and 6/6
v16.3.0 follow-up: move 🔍 search next to the Settings gear
v16.3.0: /code-review fixes — deposit clamp · skipDate-gated delete
```

Lead with the version, then which slice of it this is (`phase N`, `correction round N`,
`follow-up`, `/code-review fixes`), then what it does. That prefix is what makes
`git log --oneline` read as one version's story. Body ends with the Claude co-author
trailer.

### The pre-push review gate — mandatory

**Nothing gets pushed until `/code-review` has run over the branch's diff** — every
push, every version, not only the risky-looking ones.

**You cannot invoke `/code-review` yourself.** It's marked `disable-model-invocation`,
so the Skill tool refuses it — only Patryk can type it. That shapes the whole gate:

- **He types `/code-review and push`.** The slash command loads the review into the
  turn; the trailing "and push" is your instruction to carry the gate through to the
  end in that same turn — run the review, act on the findings per the rules below,
  push. Don't stop to narrate progress partway through; doing it in one pass is the
  entire point of the phrase.
- **If a push is due and no review has run, don't push.** Say so plainly and ask him
  to re-issue as `/code-review and push`. The same applies if he says "review and
  push" without the slash command actually loading — you need the real review, not an
  approximation of it.
- **Never substitute a different review tool silently**, and never describe a review
  as having happened when it hasn't.

Sort the findings into two buckets and treat them differently:

- **Critical — fix them, don't ask.** Anything that risks losing or corrupting booking
  data, crashes or breaks a flow in PROD, opens a security hole, or breaks the build or
  the test suite. Asking permission here is the wrong instinct: this repo has lost
  production data twice, and a "should I fix this?" round-trip is exactly the delay
  that hurt. Fix each one as its own commit (§7), re-run build + tests, then say what
  you changed.
- **Everything else — ask, don't act.** Style, perf nits, simplifications, missing
  coverage, architectural suggestions. Gather them and put them to the user in **one**
  `AskUserQuestion`: apply them now, or push as-is and leave them. One question
  covering the whole set — never one per finding.

If the review comes back clean, say so in a line and carry on to the push. No question
needed when there's nothing to decide.

`/code-review ultra` is a different thing — a billed, multi-agent cloud review that
**only Patryk can launch**. Never attempt it yourself (via Bash or otherwise). If a
version genuinely looks like it warrants that depth, say so and let him decide.

## 5. REFACTOR_LOG.md discipline

Every shipped version gets **exactly one** entry — one per version, never one per
commit. Date, files changed, behavioural-change status (almost always "None" for pure
refactors), line delta, scope, key design decisions, verification results. Keep entries
**chronological, newest at the bottom** — never reorder history to group by topic.

**The first commit of a version creates the entry; every later commit extends it in
place.** That covers everything landing under that version — additional features,
correction rounds, review fixes, QA fixes after the PR is open. Appending a second
dated section for the same version implies a second version bump, which contradicts §3.
(`v17.6.0: extend the REFACTOR_LOG entry with commits 5/6 and 6/6` on main is exactly
this working as intended.)

## 6. ROADMAP.md upkeep — this skill owns it

`ROADMAP.md` (repo root) holds **pending work only**: deferred features, follow-ups,
ideas. It must contain *nothing else* — no shipped-version history (that's
`REFACTOR_LOG.md`), no design rationale (that's `CLAUDE.md`). Keeping it accurate is
this skill's job, not something to do only when asked.

**Check it at two points:**

1. **When a task finishes** (the change is committed, or ready for a PR per §4) —
   ask whether it resolves, replaces, or makes obsolete anything currently listed in
   `ROADMAP.md`. If so, **delete that entry in the same commit/PR** — don't leave a
   completed item sitting in a pending-work file. If the item has details worth
   preserving, that's what the `REFACTOR_LOG.md` entry (§5) is for, not ROADMAP.md.
2. **When new deferred work surfaces** — the user defers an idea ("not now, but..."),
   you identify a follow-up that's out of scope for the current change, or a
   feature gets designed but not built — add a short entry under the right heading
   (`Deferred`, `Designed, not implemented`, or `Ideas`). Keep entries terse: enough
   to act on later, not a full design doc (link out to a design-summary file if one
   exists, as the WhatsApp Phase 1b entry does).

**Don't** let this become a running commentary — a task that doesn't touch pending
work or introduce new deferred work leaves `ROADMAP.md` untouched. And don't move
shipped-history detail *into* CLAUDE.md's Gotchas/Critical-patterns sections just to
avoid deleting it from ROADMAP.md — evergreen lessons belong there regardless of
ROADMAP's lifecycle, but the "this is still pending" framing does not survive
shipping.

## 7. Hard rules (non-negotiable, not situational)

- **One change per commit — never bundle features.** Every feature, correction round,
  and follow-up gets its own commit, however small. A commit carrying two features
  can't be reviewed, reverted, or bisected independently, and that separability is the
  entire point.
- **Never `--amend` or force-push to fold a follow-up into an earlier commit.** The
  separate-commit record *is* the deliverable; rewriting it destroys exactly what the
  rule above protects. A fix to an already-made commit is a new commit.
- **One version per branch, one branch per PR.** A branch may carry many commits and
  many features, but only ever one version.
- **If a previous PR is open, don't start the next *version*** (§1). Another commit on
  the open branch under the same version is fine; a second version in flight is not.
- **Commit and push only when the user explicitly asks**, each time — this isn't a
  standing permission once granted. Making the edits and running the build does not
  imply "and now commit it."
- **No push without `/code-review` first** (§4). Critical findings — data loss, PROD
  breakage, security, broken build/tests — get fixed unprompted; everything else is one
  question, then push.
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

## 8. Known trigger phrases (already defined elsewhere — don't redefine)

These phrases have specific, already-documented behavior — recognize them and act
per CLAUDE.md, don't improvise a new interpretation:

- **"give me the deployment version"** — produce a production-ready file with
  Firebase integration, auth, cleanup logic, logout.
- **"give me changelog"** — generate a PDF changelog per
  `MGT_Changelog_Instructions.md`.
- **"/code-review and push"** — Patryk's shorthand for running the mandatory pre-push
  gate (§4) end-to-end in one turn. The slash command loads the review; "and push" is
  the instruction to finish the job without further prompting: review the branch diff →
  fix critical findings unprompted → one `AskUserQuestion` covering everything else
  (apply now, or push as-is) → push. You can't invoke `/code-review` yourself, so if a
  push is due without one, ask him to re-issue it in this form.

- **"sum up this thread"** — this phrase carries three things at once: **the branch is
  already merged** (assume that unless told otherwise), the summary needs writing, and
  any loose ends get closed out in the *same* pass. Do all of it in one go — sparing a
  second prompt that re-reads this whole context is the entire point.

  Before writing, work out which of these actually apply, and ask **only** those, in a
  single `AskUserQuestion`:
  - **PROD Firebase rules** — only if this version added a new persisted node or a
    `<name>Rev` pair needing the manual console step (see `database.rules.README.md`).
    A version that touched no rules never gets asked about rules.
  - **Unresolved threads to carry forward** — anything discussed but not shipped, so it
    lands in the summary and `ROADMAP.md` (§6) instead of evaporating.

  **If neither applies, ask nothing and just write the summary.** These confirmations
  exist to catch real gaps, not to perform a ritual.

  Then update *both* folders: the summary as `MGT_Bookings_<topic>_Thread_Summary.md`
  in the context folder, plus refreshed `CLAUDE.md` / `REFACTOR_LOG.md` mirrors there.
  Full mechanics are in CLAUDE.md's "Trigger phrases" section and in memory
  (`sum-up-thread-implies-merged.md`).

## When this skill doesn't apply

Sections 1-8 govern the moment work is actually about to land in `src/` with intent
to ship — pure exploration, reading code, or answering "how does X work" doesn't need
the branch/PR machinery. **§0 (session bootstrap) is the exception: it's cheap by
design and worth running even in a pure Q&A session**, since knowing whether you're
missing context is useful regardless of what the session turns into.

**Tooling-only changes** (`.claude/` skills/settings/hooks, CI config, this file
itself) that never touch `src/` don't get an `__APP_SIGNATURE__` bump or a
REFACTOR_LOG entry — those two are specifically about the shipped app's version
history, not the dev environment. §4, §7, §8 still apply in spirit (branch off main,
PR, Patryk merges) — only §3's version bump and §5's log entry are skipped. §6
(ROADMAP.md upkeep) still applies regardless — a tooling-only change can still
resolve or introduce pending work.

**Worktree sessions:** it's fine to *explore, read, and edit* on a harness-created
`claude/…` branch without renaming it first — that's the environment's own naming,
not a violation of §2. But this is exploration-only slack, not a way to skip §2: the
moment you're about to bump `__APP_SIGNATURE__` and commit — i.e. you've reached §4's
ship checklist for real — cut a proper `feat/v.../fix/v.../chore/...` branch off main
first, even if that means branching again from where you already are. Landing a
version bump on a `claude/…` branch is exactly the un-versioned, un-PR'd commit §2
exists to prevent; "I was already on a branch" is not an exception to it.
