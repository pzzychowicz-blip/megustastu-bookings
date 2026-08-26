---
name: mgt-workflow
version: 3
description: The standing workflow contract for the MGT Bookings repo (Me Gustas Tú booking system, github.com/pzzychowicz-blip/megustastu-bookings) — session bootstrapping, plan-mode effort calibration, git/branching/versioning (one version per branch, but one commit per feature — never bundle changes into a single commit), the mandatory pre-push `/code-review` gate, and keeping the four living docs (CLAUDE.md · DESIGN.md · GLOSSARY.md · ROADMAP.md) current. Load this at the START of every session in this repo — even before any coding task is clear — and AGAIN the moment PLAN MODE opens: the effort level gets checked before the research starts, and every plan ends with an effort recommendation for executing it and for `/code-review and push`. ALSO load it before any edit under src/, before any commit, push, branch, PR or version bump, and before finishing any task — the branch name, whether you're even allowed to start, and which docs need updating are all decided before the first edit and at task close, not at commit time. Claude never settles a judgement call alone here: anything with a defensible alternative goes to AskUserQuestion with a recommendation attached. Also triggers on "/code-review and push", "give me the deployment version", "give me changelog", "sum up this thread", "ship this", "let's deploy/release this", "continue where we left off", "what's on the roadmap", "add this to the roadmap/backlog", or any reference to prior context, branch naming, __APP_SIGNATURE__, REFACTOR_LOG.md, DESIGN.md, GLOSSARY.md or ROADMAP.md. Use this instead of re-deriving the workflow from CLAUDE.md's prose each time — same rules, as a checklist that's hard to skim past.
---

# MGT Bookings — workflow contract (v3)

Patryk is the sole developer and sole merger of this repo. This skill exists so its
conventions get *applied* consistently, not re-explained every session. If anything
here conflicts with CLAUDE.md, CLAUDE.md wins — this is a distillation of its
"Workflow" section into something you act on step-by-step.

**The rule that governs all the others: ask, don't decide** (§8). Any fork with a
defensible alternative is his call, offered as an `AskUserQuestion` with your
recommendation attached — never a decision announced after the fact.

## 0. Session bootstrap — do you need last session's context?

CLAUDE.md is auto-loaded fresh into every session, so it is never stale as a *file* —
but it can be **silent about unfinished business**: a decision made, a plan agreed, a
bug half-diagnosed in a previous conversation that ended before it reached
CLAUDE.md/REFACTOR_LOG. That is what a thread summary carries forward. Reading one
costs real tokens, so do it only on a signal.

**Cheap check, start of every session:**

1. `src/App.jsx` → `__APP_SIGNATURE__.version` vs the version heading at the **bottom**
   of `REFACTOR_LOG.md` (its newest entry). These should match.
2. If they don't — or `git log -5` shows commits with no corresponding log entry —
   that is documentation drift: something wasn't wrapped up. Investigate before
   proceeding.
3. Read the opening message for **phrasing cues**: "like we discussed", "continue
   where we left off", a named decision/bug/feature documented nowhere. An independent
   trigger — state can be in sync while a conversational thread dangles.

**Neither fires:** proceed. CLAUDE.md + REFACTOR_LOG + memory already cover you; a
summary here is burnt tokens. This is the common case — don't go looking by habit.

**Either fires:** find the summary by **absolute path** (a relative
`../megustastu-bookings context` breaks in a worktree — see CLAUDE.md's worktree
gotcha):

```bash
ls -t "/Users/patrykzychowicz/Desktop/megustastu-bookings context"/MGT_Bookings_*_Thread_Summary.md 2>/dev/null | head -5
```

Read the newest match only — one file is almost always the right amount. If the drift
signal and the phrasing cue point at different topics, the phrasing cue usually wins:
that's the user telling you directly what he needs.

**Keep it cheap for next session too.** CLAUDE.md asks for a fresh thread around ~25
messages — suggest it proactively rather than waiting, since a "sum up this thread"
you prompted for is what makes next session's step 3 a non-event.

## 1. Plan mode — check the effort first, name it at the end

Effort levels here, lowest to highest: **low · medium · high · extra · max ·
ultracode**. The live setting is readable:

```bash
grep -o '"effortLevel"[^,]*' ~/.claude/settings.json
```

Treat it as a strong signal rather than a fact — it can lag a mid-session change — but
a stated level he can correct in one word beats a blind prompt. **Empty output means
the key isn't set, not that the level is fine** — `grep` exits 1 and prints nothing.
Never fill that silence with a guess: ask him what he's on, the same way as a mismatch
below.

**On entering plan mode, before researching anything:** read that setting, judge what
the task actually needs, and compare. Both mismatches matter, in both directions:

- **Below what the work needs** — stop and `AskUserQuestion` *before* the research.
  A plan built on too-shallow reading looks finished, which is exactly why it has to
  be caught before the plan exists rather than after it's approved.
- **Above what the work needs** — flag it the same way. Planning a one-file copy edit
  at `max` burns rate limit for nothing, and he can only spend that budget once.
- **Right for the job** — one line saying so, then carry on. No question when there is
  nothing to decide.

**Every plan ends with an effort handoff** as its final section — both lines, always:

```
**Effort** — execute at `high` · `/code-review and push` at `medium`
```

Executing an agreed plan is usually a step below the research that produced it: the
hard thinking is already in the plan. The review turn is sized by what the diff will
*contain*, not by how hard it was to design — a wide, subtle, or data-touching diff
wants more than a mechanical one however easy the plan was.

Starting calibration — adjust per task, this is a floor to reason from, not a rule:

| Work | Level |
|---|---|
| Doc/copy edit, single mechanical file change | low–medium |
| One feature inside one component, tests included | medium–high |
| Cross-cutting change, new hook or data shape, motion or a11y work | high–extra |
| Multi-file architecture, live-measured perf work, a version carrying several features | max |
| The genuinely hardest passes — reserve it, and say why you're asking | ultracode |

Same handoff applies whenever you finish work and a push is due (§5): name the effort
the `/code-review and push` turn wants before he types it.

## 2. Before you touch anything in `src/`

First thing, before a line of code:

```bash
git branch --show-current
/opt/homebrew/bin/gh pr list --state open --base main
```

(`gh` is not on `$PATH` — always the full path.)

- **On `main`?** Branch first. Never commit work-in-progress to `main`.
- **An open PR listed?** Don't start a *new version* branch — that's what keeps two
  versions from being in flight. But adding another feature to the version already
  open is normal (§4), so put the choice to him: another commit on the open branch
  under the same version, or wait for the merge and start the next version fresh.
  Recommend one rather than listing both.
- **Clean, no open PR, already on `feat/v…` / `fix/v…` / `chore/…`?** Carry on —
  you're mid-version.
- **Clean, no open PR, on some other branch** (main, or a harness `claude/…` branch)
  **and about to ship a version bump?** Cut a fresh, properly-named branch per §3
  first. Being "already off main" is not being on a version branch.

## 3. Branch naming

Cut fresh off an up-to-date `main`:

```bash
git checkout main && git pull --ff-only
git checkout -b feat/v{X.Y.Z}-{slug}   # user-visible feature / behavior change
git checkout -b fix/v{X.Y.Z}-{slug}    # bug fix / hotfix that still bumps the version
git checkout -b chore/{slug}           # docs, tooling, pure refactor — no version bump
```

`{X.Y.Z}` is the version this branch ships *as* — decide it now (§4), not at commit
time, so the branch name and `__APP_SIGNATURE__` never disagree.

(CLAUDE.md spells out only `feat/`/`chore/`; repo history establishes `fix/` for bug
fixes and hotfixes — e.g. `fix/v17.4.1-sw-killswitch`. Use it rather than forcing a
bug fix into `feat/`.)

## 4. Versioning — one version per branch, one bump in the first commit

Single source of truth: `src/App.jsx` → `__APP_SIGNATURE__.version`, `MAJOR.MINOR.PATCH`.

| Bump | When |
|---|---|
| **Major/minor** | A user-visible feature shift — something staff would notice using the app. |
| **Patch** | A structural refactor, bug fix, or internal change with no new user-facing behavior. |

**A version can carry several features** — v16.3.0 shipped 11, v17.0.0 six, v17.6.0
six: one branch, one version, many commits. Size the bump by the version's overall
user-visible impact, not by counting features.

**The bump happens once, in the branch's first commit**, so the branch name and
`__APP_SIGNATURE__` agree from the start and an abandoned branch is still
self-consistent. Every later commit leaves the version line alone. There is no
"ship without a bump": opening a PR against `main` means `__APP_SIGNATURE__` moved
exactly once.

## 5. The ship checklist

Set the branch up once, commit each change separately, ship the branch out once.
Don't skip a step because it "doesn't apply this time" — confirm it doesn't, don't
assume.

**Once, when the branch starts:**

1. [ ] Cut a fresh branch off `main`, named per §3.

**Then once per feature / fix / follow-up — each gets its OWN commit (§8):**

2. [ ] Make just that one change's edits in `src/`. No second feature riding along.
3. [ ] *First commit of the branch only:* bump `__APP_SIGNATURE__.version` (§4).
4. [ ] **Added or edited a transition?** Verify it plays **in and out** before calling
   it done — DESIGN.md's rule, and the app's most common motion defect precisely
   because a one-way transition looks finished. "The node just unmounts" is the bug,
   not the exit.
5. [ ] `REFACTOR_LOG.md` — first commit creates this version's entry, every later
   commit **extends that same entry** (§6). Never a second entry for one version.
6. [ ] The other three living docs — CLAUDE.md · DESIGN.md · GLOSSARY.md — updated if
   *this* change made one of them stale (§7). Most commits touch one; some touch none.
7. [ ] `npm run build` **and** `npm test` pass. Together ~1s, so run them per commit —
   a `git bisect` should never land on a broken one. Note the main-bundle gz delta.
8. [ ] Commit this one change (subject format below). **Only when he has explicitly
   asked you to commit** — see §8.

   → Then loop back to step 2 for the next change.

**Once, when the version is ready to go out:**

9. [ ] **No push until `/code-review` has run over the branch diff.** You can't invoke
   it — he types `/code-review and push`. Name the effort that turn wants (§1) when
   you hand the work back.
10. [ ] `git push -u origin <branch>` — **only when explicitly asked.** A push is a
    shared-state action; a prior approval never carries to the next one.
11. [ ] `gh pr create --base main --head <branch> …` — body ends with the "Generated
    with Claude Code" line.
12. [ ] He reviews and merges. **You never merge his PR** — not even if asked to
    "just finish it up".
13. [ ] After merge, confirm the prod console boot banner / `window.__MGT_BUILD__`
    shows the new version — that's proof the deploy landed, not just that the PR did.
14. [ ] `git checkout main && git pull --ff-only`.

Review fixes arriving *after* the PR opens are more passes through 2–8 on the same
branch — new commits, same version, same REFACTOR_LOG entry.

**Commit subject format** (repo history — keep it):

```
v17.0.0 phase 1: PENDING booking status
v16.3.0 (phase 11): recurring / standing bookings
v17.0.0 correction round 7: OverlapBanner + banner master switches
v17.6.0: extend the REFACTOR_LOG entry with commits 5/6 and 6/6
v16.3.0 follow-up: move 🔍 search next to the Settings gear
v16.3.0: /code-review fixes — deposit clamp · skipDate-gated delete
```

Version first, then which slice of it (`phase N`, `correction round N`, `follow-up`,
`/code-review fixes`), then what it does. That prefix is what makes `git log --oneline`
read as one version's story. Body ends with the Claude co-author trailer.

### The pre-push review gate — mandatory

**Nothing is pushed until `/code-review` has run over the branch diff** — every push,
every version, not only the risky-looking ones.

**You cannot invoke `/code-review` yourself.** It's `disable-model-invocation`; the
Skill tool refuses it. That shapes the gate:

- **He types `/code-review and push`.** The slash command loads the review into the
  turn; "and push" is your instruction to carry it through to the end in that same
  turn — review, act on findings per the rules below, push. Don't stop to narrate
  progress partway; one pass is the entire point of the phrase.
- **Push due and no review has run?** Don't push. Say so plainly and ask him to
  re-issue as `/code-review and push`. Same if "review and push" arrives without the
  slash command actually loading — you need the real review, not an approximation.
- **Never substitute a different review tool silently**, and never describe a review
  as having happened when it hasn't.

Two buckets, treated differently:

- **Critical — fix them, don't ask.** Anything risking loss or corruption of booking
  data, a PROD crash or broken flow, a security hole, or a broken build/test suite.
  Asking permission here is the wrong instinct: this repo has lost production data
  twice, and the round-trip is exactly the delay that hurt. Fix each as its own commit
  (§8), re-run build + tests, then report what changed. **This is the one carve-out
  from §8's ask-first rule, and it is narrow on purpose** — it covers damage already
  in the diff, never a judgement about scope or design.
- **Everything else — ask, don't act.** Style, perf nits, simplifications, missing
  coverage, architectural suggestions. One `AskUserQuestion` covering the whole set:
  apply now, or push as-is and leave them. Never one question per finding.

Clean review? Say so in a line and carry on to the push.

`/code-review ultra` is a different thing — a billed, multi-agent cloud review **only
he can launch**. Never attempt it (via Bash or otherwise). If a version genuinely
warrants that depth, say so and let him decide.

## 6. REFACTOR_LOG.md discipline

Every shipped version gets **exactly one** entry — one per version, never one per
commit. Date, files changed, behavioural-change status (usually "None" for pure
refactors), line delta, scope, key design decisions, verification results.
**Chronological, newest at the bottom** — never reorder history to group by topic.

**The first commit creates the entry; every later commit extends it in place** —
additional features, correction rounds, review fixes, post-PR QA fixes. A second dated
section for one version implies a second bump, contradicting §4. (`v17.6.0: extend the
REFACTOR_LOG entry with commits 5/6 and 6/6` on main is this working as intended.)

## 7. The four living docs — keep them as current as the code

`CLAUDE.md`, `DESIGN.md`, `GLOSSARY.md` and `ROADMAP.md` are updated **in the same
commit or PR as the change that made them stale**, not later. A doc that lags is worse
than no doc, because it gets quoted with confidence.

Each owns one thing, and where they overlap the owner wins:

- **CLAUDE.md** — architecture, data rules, gotchas. A new or changed hook, component,
  data shape or persisted node; a new architectural rule; a gotcha someone would
  otherwise re-discover the hard way.
- **DESIGN.md** — the visual system: tokens, surfaces, colour, motion, icons, the
  accessibility contract. **A design decision is recorded there, never in CLAUDE.md.**
- **GLOSSARY.md** — one name per thing. A new user-visible surface, control or state
  gets its row, with the code identifier so the row stays greppable.
- **ROADMAP.md** — **pending work only**: deferred features, follow-ups, ideas.
  Nothing shipped, no design rationale.

**Don't answer one question in two files.** All three of the first three say the same
thing in their own headers — a duplicated rule is the defect they warn about. If a rule
already lives in one, point at it instead of restating it. (That is why §5's checklist
*points* at DESIGN.md's in-and-out transition rule rather than repeating it, and why
this skill holds no copy of it either.)

**ROADMAP.md has two check points, and this skill owns both:**

1. **When a task finishes** — does it resolve, replace, or obsolete anything listed?
   **Delete that entry in the same commit/PR.** Details worth preserving belong in the
   REFACTOR_LOG entry (§6), not in a pending-work file.
2. **When new deferred work surfaces** — he defers an idea, you spot an out-of-scope
   follow-up, or something gets designed but not built — add a terse entry under the
   right heading (`Deferred`, `Designed, not implemented`, `Ideas`): enough to act on
   later, not a design doc.

Don't let this become running commentary: a change touching no pending work leaves
ROADMAP.md alone. And don't shift shipped-history detail into CLAUDE.md's Gotchas just
to avoid deleting it from ROADMAP — evergreen lessons belong there regardless, but the
"still pending" framing does not survive shipping.

## 8. Hard rules (non-negotiable, not situational)

- **Ask, don't decide.** Anything with a defensible alternative — shipped behaviour,
  UI, data shape, scope, version number, branch or commit structure, which doc a rule
  belongs in, what to do about an ambiguous instruction — goes to `AskUserQuestion`
  **with your recommendation marked**, before you act, not as a decision reported
  afterwards. Proposing a solution is welcome and expected; choosing it for him is
  not. The line: mechanical steps *inside* a decision he has already made proceed
  without asking. The only carve-out is a critical `/code-review` finding (§5) — real
  damage already in the diff, fixed unprompted.
- **A transition added or edited works both ways — never one direction only.** Verify
  in *and* out; DESIGN.md holds the rule and the reasoning.
- **DEV Firebase is a scratch database — leave your mess in it.** Test bookings,
  seeded settings, demo waitlist rows: **no cleanup pass, ever.** It exists to be
  written to, and tokens spent tidying a sandbox are tokens wasted. PROD data stays
  untouchable, and every action should be mindful of which environment it targets.
- **One change per commit — never bundle features.** Every feature, correction round
  and follow-up gets its own commit, however small. A commit carrying two features
  can't be reviewed, reverted or bisected independently; that separability is the
  entire point.
- **Never `--amend` or force-push** to fold a follow-up into an earlier commit. The
  separate-commit record *is* the deliverable. A fix to a made commit is a new commit.
- **One version per branch, one branch per PR.** Many commits and features per branch,
  only ever one version.
- **A previous PR open? Don't start the next *version*** (§2). Another commit on the
  open branch under the same version is fine; a second version in flight is not.
- **Commit and push only when explicitly asked**, each time — never a standing
  permission. Making edits and running the build does not imply "and now commit it."
- **No push without `/code-review` first** (§5).
- **Never use `-i`/interactive git flags** — unsupported here; they hang or fail
  silently.
- **`gh` is at `/opt/homebrew/bin/gh`**, not on `$PATH`.
- **Local dev is `npm run dev` only.** Never `npm run preview` — `dev` hits DEV
  Firebase (the sandbox, per `src/firebase.js`'s `import.meta.env.DEV` split), and the
  split is never bypassed. Production-build verification is his job.

## 9. Known trigger phrases (defined elsewhere — don't redefine)

- **"give me the deployment version"** — a production-ready file with Firebase
  integration, auth, cleanup logic, logout.
- **"give me changelog"** — a PDF changelog per `MGT_Changelog_Instructions.md`.
- **"/code-review and push"** — the pre-push gate (§5) run end-to-end in one turn:
  review the branch diff → fix critical findings unprompted → one `AskUserQuestion`
  covering everything else → push. You can't invoke `/code-review` yourself, so if a
  push is due without one, ask him to re-issue it in this form.
- **"sum up this thread"** — carries three things at once: **the branch is already
  merged** (assume so unless told otherwise), the summary needs writing, and loose ends
  get closed in the *same* pass. Sparing a second prompt that re-reads all this context
  is the entire point.

  Before writing, work out which of these actually apply and ask **only** those, in a
  single `AskUserQuestion`:
  - **PROD Firebase rules** — only if this version added a persisted node or a
    `<name>Rev` pair needing the manual console step (`database.rules.README.md`).
    A version that touched no rules is never asked about rules.
  - **Unresolved threads to carry forward** — discussed but not shipped, so it lands
    in the summary and ROADMAP.md (§7) instead of evaporating.

  **If neither applies, ask nothing and write the summary.** These confirmations catch
  real gaps; they are not a ritual.

  Then update *both* folders: the summary as `MGT_Bookings_<topic>_Thread_Summary.md`
  in the context folder, plus refreshed `CLAUDE.md` / `REFACTOR_LOG.md` mirrors there.
  Mechanics: CLAUDE.md's "Trigger phrases" section and memory
  (`sum-up-thread-implies-merged.md`).

## When this skill doesn't apply

§2–§9 govern the moment work is about to land in `src/` with intent to ship — pure
exploration, reading code, or "how does X work" needs none of the branch/PR machinery.
**§0 and §1 are the exceptions**: the bootstrap check is cheap by design, and the
effort check belongs to plan mode whatever the plan turns out to be.

**Tooling-only changes** (`.claude/` skills/settings/hooks, CI config, this file) that
never touch `src/` get no `__APP_SIGNATURE__` bump and no REFACTOR_LOG entry — those
are about the shipped app's version history, not the dev environment. §5, §8, §9 still
apply in spirit (branch off main, PR, he merges); only §4's bump and §6's entry are
skipped. §7 still applies in full — a tooling change can still resolve or introduce
pending work, and can still make a doc stale.

**Worktree sessions:** exploring, reading and editing on a harness `claude/…` branch
without renaming it is fine — that's the environment's naming, not a §3 violation. But
it is exploration slack, not a way to skip §3: the moment you're about to bump
`__APP_SIGNATURE__` and commit — §5's checklist, for real — cut a proper
`feat/…`/`fix/…`/`chore/…` branch off main first, even if that means branching again
from where you are. "I was already on a branch" is not an exception.
