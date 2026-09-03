---
name: mgt-workflow
version: 5
description: The standing workflow contract for the MGT Bookings repo (Me Gustas Tú booking system, github.com/pzzychowicz-blip/megustastu-bookings) — session bootstrapping (dev server + Preview bridge up first), plan-mode effort calibration, git/branching/versioning (one version per branch, but one commit per feature — never bundle changes into a single commit; commits land as work lands, pushes never do), the full local gate that matches CI (build · test · lint · check:style, plus test:rules when the rules move), the mandatory pre-push review gate, and keeping the four living docs (CLAUDE.md · DESIGN.md · GLOSSARY.md · ROADMAP.md) current. Load this at the START of every session in this repo — even before any coding task is clear — and AGAIN the moment PLAN MODE opens: the effort level gets checked before the research starts, and every plan ends with an effort recommendation for executing it and for the ship run. ALSO load it before any edit under src/, before any commit, push, branch, PR or version bump, and before finishing any task — the branch name, whether you're even allowed to start, and which docs need updating are all decided before the first edit and at task close, not at commit time. Two rules govern everything here: Claude never settles a judgement call alone (anything with a defensible alternative goes to AskUserQuestion with a recommendation attached), and Claude never asserts what it has not measured. Also triggers on "/code-review and ship" (the one-run ship gate — review, verify, fix, build, commit, push, PR and thread summary in a single turn; the older "/code-review, fix all findings, push and sum up the thread" and "/code-review and push" name the same run), "give me the deployment version", "give me changelog", "sum up this thread", "ship this", "let's deploy/release this", "continue where we left off", "what's on the roadmap", "add this to the roadmap/backlog", or any reference to prior context, branch naming, __APP_SIGNATURE__, REFACTOR_LOG.md, DESIGN.md, GLOSSARY.md or ROADMAP.md. Use this instead of re-deriving the workflow from CLAUDE.md's prose each time — same rules, as a checklist that's hard to skim past.
---

# MGT Bookings — workflow contract (v5)

Patryk is the sole developer and sole merger of this repo. This skill exists so its
conventions get *applied* consistently, not re-explained every session. If anything
here conflicts with CLAUDE.md, CLAUDE.md wins — this is a distillation of its
"Workflow" section into something you act on step-by-step.

**Two rules govern all the others.**

**Ask, don't decide** (§8). Any fork with a defensible alternative is his call, offered
as an `AskUserQuestion` with your recommendation attached — never a decision announced
after the fact.

**Verify, don't assume** (§8). Every claim you make and every finding you act on is
backed by something you ran, read or measured, and the report names it. This repo's
hardest-won lessons are all this shape: a synthetic `:active` press that measured the
tooling rather than the app, an accessible name read out of an automation tree instead
of computed by the browser, a perf fix aimed at a component that measured as noise, a
crash-test finding withdrawn once StrictMode was off, a lint run read through `tail`
that reported "0 errors" over an error. Reasoning that *sounds* right is how each of
those shipped. The two rules are not in tension — verifying first is what makes the
questions you do ask real ones, and it is what keeps §5's one-run ship gate from
turning "fix all findings" into "comply with all findings".

## 0. Session bootstrap

### Bring the tools up first

`npm run dev` (DEV Firebase — never `npm run preview`) **and** the Preview bridge
(`preview_start` on the dev URL — the bare tool name, because the `mcp__<server>__`
prefix is harness config that differs between sessions, and a stale one fails at the
first instruction of the first step). CLAUDE.md asks for the pair at the start of
*every* coding session, not only visual ones, and the reason is the second governing
rule: with them up, any change can be checked live before it's called done;
without them, "it should work" is the best sentence available. Tell him the localhost
URL. Pure planning, exploration or doc work can let the pair wait until edits begin —
but "I'll start it if I turn out to need it" is how a session ends with an unverified
claim in it.

**In a worktree, `preview_start` serves the MAIN checkout, not the one you're editing**
(memory: `preview-server-worktree-prefix.md`). `npm --prefix` does *not* fix it — the
launch config needs `sh -c "cd <worktree> && npm run dev"`, and a cache-busted fetch is
what proves you're looking at the right tree rather than at main's.

### Assume the previous PR merged

A new session means the last version went out, unless the opening prompt says
otherwise. He starts a session after finishing a unit of work, so a turn spent asking
"did that merge?" is a turn spent on something he already knows — this is the
session-start twin of the `sum up this thread` default (§9, memory
`sum-up-thread-implies-merged.md`).

It's a **default, not a belief**. §2's `gh pr list --state open --base main` is one
command and settles it for real, so the rule is *don't spend a turn asking* — not
*don't check*. Where the check and the default disagree, the check wins.

### Do you need last session's context?

CLAUDE.md is auto-loaded fresh into every session, so it is never stale as a *file* —
but it can be **silent about unfinished business**: a decision made, a plan agreed, a
bug half-diagnosed in a previous conversation that ended before it reached
CLAUDE.md/REFACTOR_LOG. That is what a thread summary carries forward. Reading one
costs real tokens, so do it only on a signal.

**Cheap check, start of every session:**

1. `src/App.jsx` → `__APP_SIGNATURE__.version` vs the version heading at the **bottom**
   of `REFACTOR_LOG.md` (its newest entry). These should match. **Read both values** —
   done from memory of how last session ended, the check is worse than not running it,
   because it returns an answer either way.
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
messages — suggest it proactively rather than waiting, since a summary you prompted for
is what makes next session's step 3 a non-event.

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
**Effort** — execute at `high` · `/code-review and ship` at `medium`
```

Executing an agreed plan is usually a step below the research that produced it: the
hard thinking is already in the plan. The ship run is sized by what the diff will
*contain* **and by the fixing it will carry** — it does review, verification, fixes,
build, commits, push, PR and the thread summary in one turn, so it sits a notch above
what a review-only turn wanted. A wide, subtle or data-touching diff wants more than a
mechanical one however easy the plan was.

Starting calibration — adjust per task, this is a floor to reason from, not a rule:

| Work | Level |
|---|---|
| Doc/copy edit, single mechanical file change | low–medium |
| One feature inside one component, tests included | medium–high |
| Cross-cutting change, new hook or data shape, motion or a11y work | high–extra |
| Multi-file architecture, live-measured perf work, a version carrying several features | max |
| The genuinely hardest passes — reserve it, and say why you're asking | ultracode |

Same handoff applies whenever you finish work and a push is due (§5): name the effort
the ship run wants before he types it.

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

**In a worktree, `git checkout main` fails** — main is checked out in the primary
clone and git refuses a second checkout of one branch. Branch off the remote instead:
`git fetch origin && git checkout -b <name> origin/main`.

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

Set the branch up once, commit each change separately as it lands, ship the branch out
in one run. Don't skip a step because it "doesn't apply this time" — confirm it
doesn't, don't assume.

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
7. [ ] **Run the whole gate and report its numbers** — see "The gate" below.
8. [ ] **Commit this one change** (subject format below), as it lands. Commits do not
   wait for permission (§8); pushes always do.

   → Then loop back to step 2 for the next change.

**Once, when the version is ready to go out:**

9. [ ] **Nothing is pushed until the review has run over the branch diff.** You can't
   invoke it — he types **`/code-review and ship`**, and that one turn carries the work
   through review → verification → fixes → gate → commits → push → PR → thread summary.
   It is specified in full below. Name the effort that turn wants (§1) when you hand
   the work back.
10. [ ] He reviews and merges. **You never merge his PR** — not even if asked to
    "just finish it up".
11. [ ] After merge, confirm the prod console boot banner / `window.__MGT_BUILD__`
    shows the new version — that's proof the deploy landed, not just that the PR did.
12. [ ] `git checkout main && git pull --ff-only`.

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

### The gate — what step 7 actually runs

**All four, because that is exactly what CI's `verify` job runs.** A green run here and
a green PR then mean the same thing; running two of four just means the PR is the first
place the other two get tried.

**Run this exact block — both lines.** It is the whole gate, filtered down to the four
numbers worth reporting, so there is nothing left for you to trim by hand:

```bash
set -o pipefail
npm run build 2>&1 | tail -3 && npm test 2>&1 | grep -E "Tests +[0-9]" && npm run lint 2>&1 | grep -E "✖.*problems" && npm run check:style 2>&1 | tail -1
```

Four lines out, in order: main-bundle gz size · test count · lint problem count · the
style verdict. Measured on this repo: **0.1s · 1.8s · 4.0s · 0.3s** — about six seconds
for all four, so run them per commit; a `git bisect` should never land on a broken one.
`lint` is a **hard** gate at 0 errors (warnings don't block; there are ~71 by design).

**`set -o pipefail` is load-bearing — without it this line lies.** A pipeline's exit
status is its LAST element's, and every stage here ends in a filter that succeeds on
empty input, so `&&` never short-circuits and the chain runs to the end reporting
whatever the surviving stages say. Measured against a genuinely broken tree: the build
failed, its errors were filtered away to nothing, and the run continued to print
`Tests 494 passed (494)` — 323 tests silently *missing* from the run rather than
failing, because the broken import took whole files out — then the style verdict, then
**exit 0**. Three green-looking lines and a passing status over a tree that does not
compile. `pipefail` makes the pipeline carry the *first* non-zero status instead, so
the chain stops where it broke.

**And `build` is tailed while `lint` is grepped — on purpose.** A build's useful output
on failure is its error tail, so `tail -3` shows the gz line when it works and the
error when it doesn't. `lint` is the opposite: `eslint` prints two trailing lines and
the reassuring one is not the verdict — `0 errors and 1 warning potentially fixable
with the --fix option` is about what `--fix` could *repair*, while `✖ N problems (E
errors, W warnings)` is what CI gates on. `tail -2` shows the first and hides the
second; two consecutive commits were verified that way and reported "0 errors" while
carrying an error (CLAUDE.md's gotcha). A v5 eval run then did it again, typing
`npm run lint 2>&1 | tail -8` with the correct grep eight lines away in this file,
because it was batching three gates and trimmed all three the same way. **A prohibition
you have to remember loses to a habit; a command you paste doesn't** — so paste the
block above rather than assembling your own. Both of that block's own defects were
found by running it against a broken tree, which is the only way either could have
been: it was written, and verified, against a passing one.

**A fifth gate, when the diff touches the rules.** Changed `database.rules.json`,
`tests/rules/**`, `firebase.json` or `vitest.rules.config.js`? Also run
`npm run test:rules` (121 tests against a local RTDB emulator). It is a **separate CI
job**, so nothing in the four above will catch a rules regression — you'd find out
after the push. It needs a JVM and a global `firebase-tools`; if it can't run where you
are, say so plainly rather than reporting a gate you didn't clear. A new `<name>Rev`
pair also joins `PAIRS` in the same PR (`database.rules.README.md`).

**Report the numbers, not the verdict** — the test count, the lint problem count, the
main-bundle gz delta. "Build and tests pass" is the sentence you can write without
having run either, which is what makes it worthless; a count that moved unexpectedly is
a finding in its own right. Same for any figure you quote from a doc — CLAUDE.md's own
line counts say "re-measure rather than trust this number".

**Red suite? Establish whose fault it is before you debug it.** A failure is not
evidence that your change caused it. On 2026-09-02 a stale date literal in
`tests/reconcile.test.js` turned `main` red — and every branch cut from it — for
reasons having nothing to do with any work in flight; the real cost was distrusting the
working tree first. So check whether the same test fails on `origin/main` before
reading a line of your own diff. **Not with a bare `git stash`**: the stash stack is
shared with every worktree and another session can pop yours. Use a throwaway commit,
or run the failing file from a clean clone.

### The ship run — `/code-review and ship`

**One turn, start to finish.** The expensive part of a ship turn is context, not
tokens spent thinking: reading the branch diff, the four living docs and the
REFACTOR_LOG entry. Handing the work back mid-way to ask about a style nit pays that
cost a second time for an answer that was never really in doubt. The phrase exists so
it is paid once — so don't stop to narrate progress partway, and don't finish early
with "shall I push now?". One pass is the entire point.

**You still cannot invoke `/code-review` yourself.** It's `disable-model-invocation`;
the Skill tool refuses it. That shapes the gate:

- **He types the phrase.** The slash command loads the real review into the turn; the
  rest of the sentence is your instruction to carry it to the end in that same turn.
- **Push due and no review has run?** Don't push. Say so plainly and ask him to
  re-issue the phrase. Same if the words arrive without the slash command actually
  loading — you need the real review, not an approximation of one.
- **Never substitute a different review tool silently**, and never describe a review
  as having happened when it hasn't.

**Every finding is verified before it is acted on.** "Fix all findings" means fix
everything that survives a check — not comply with everything the reviewer emitted. A
review is evidence, not a verdict, and a fix aimed at a non-bug adds risk while buying
nothing. Each finding lands in one of three buckets, and **all three are reported**:

- **Confirmed** — you reproduced it, or read the code path and can state the failing
  case. Fix it, as its own commit (§8). Critical ones first: anything risking loss or
  corruption of booking data, a PROD crash or broken flow, a security hole, or a broken
  build/test suite. This repo has lost production data twice; those don't wait.
- **Disproved** — the check shows the finding is wrong or unreachable. **Don't fix it.**
  Report the measurement that disproves it, naming the command, file and line. v17.16.3
  withdrew findings exactly this way, one of them because the accessibility tree the
  tool printed was its own summary rather than the browser's computed name. A finding
  you fixed to be obedient is a change nobody can justify later.
- **Real but out of scope** — it holds up, but fixing it would change shipped behaviour
  or means a refactor wider than the diff under review. Add a terse `ROADMAP.md` entry
  in the same run (§7) and report it. **Don't build it** — a review finding must not
  become the back door through which a feature gets redesigned unasked.

**No `AskUserQuestion` inside this run.** The phrase is the authorisation for the whole
chain: review, fixes, gate, commits, push, PR and summary. This is §8's one carve-out
from ask-first, and the third bucket is what bounds it — the run can fix what's broken,
never decide what the app should do. §8 governs everything outside it, unchanged.

Then, in order:

1. **Run the full gate after the fixes, before the push** — all four, plus
   `test:rules` if the rules moved. Report the actual output (see "The gate").
2. **Push** (`git push -u origin <branch>`), then open the PR:
   `/opt/homebrew/bin/gh pr create --base main --head <branch> …`, body ending with
   the "Generated with Claude Code" line. If the branch
   already has an open PR, the push updates it and no second PR is created — check
   rather than assume. **Never merge** — that is his, always, even if asked.
3. **Write the thread summary — and the PR is OPEN, not merged.** A standalone "sum up
   this thread" assumes the branch already merged (§9, and memory
   `sum-up-thread-implies-merged.md`), because he types it after a finished unit of
   work. Here you created the PR seconds ago, so you *know* it hasn't: give it PR-open
   status with the number, and list what remains — his merge, then the prod boot-banner
   check, then `git checkout main && git pull --ff-only`. A determination, not an
   assumption; this is the one place the default would be wrong.
4. **Update both folders.** The summary as `MGT_Bookings_<topic>_Thread_Summary.md` in
   `/Users/patrykzychowicz/Desktop/megustastu-bookings context` (absolute path — a
   relative one silently targets the wrong place in a worktree), plus refreshed
   `CLAUDE.md` and `REFACTOR_LOG.md` mirrors there. **Nothing reminds you of this step
   here**: the `UserPromptSubmit` hook greps for "sum up this/the thread", which
   `/code-review and ship` does not contain, so this list is the only thing standing
   between the run and a stale context folder.
5. **§9's two sum-up questions are checks here, not questions.** Whether PROD Firebase
   rules need the manual console step is answerable from the diff — a new persisted
   node or `<name>Rev` pair (`database.rules.README.md`) — so grep for it and state the
   answer. Unresolved threads are in the conversation you just had. Ask only what is
   genuinely undeterminable.
6. **One closing report**: findings raised, fixed (with commit subjects), disproved
   (with the evidence), deferred to ROADMAP; the gate's numbers; the PR URL; the
   summary's path.

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
   follow-up, something gets designed but not built, or a review finding lands in the
   third bucket (§5) — add a terse entry under the right heading (`Deferred`,
   `Designed, not implemented`, `Ideas`): enough to act on later, not a design doc.

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
  without asking. The only carve-out is the ship run (§5), where the phrase he typed
  *is* the decision — and even there, a finding that would change shipped behaviour
  goes to ROADMAP rather than getting built.
- **Verify, don't assume.** Don't report a state you inferred, a fix you didn't run, a
  test suite you didn't watch pass, or a review finding you didn't check. Name the
  evidence: the command, the file and line, the number. Where a measurement contradicts
  a plausible story, the measurement wins — and check the instrument before the app,
  because more than once here the thing that was wrong was the tool doing the
  measuring. If you can't verify something, say that instead of rounding it to a claim.
- **A transition added or edited works both ways — never one direction only.** Verify
  in *and* out; DESIGN.md holds the rule and the reasoning.
- **DEV Firebase is a scratch database — leave your mess in it.** Test bookings,
  seeded settings, demo waitlist rows: **no cleanup pass, ever.** It exists to be
  written to, and tokens spent tidying a sandbox are tokens wasted. PROD data stays
  untouchable, and every action should be mindful of which environment it targets.
- **One change per commit — never bundle features.** Every feature, correction round
  and follow-up gets its own commit, however small. A commit carrying two features
  can't be reviewed, reverted or bisected independently; that separability is the
  entire point. Review fixes follow the same rule inside the ship run.
- **Commit as you go; never push on your own.** These are two rules, not one. A
  finished, green change gets its own commit **immediately, without asking** — waiting
  for permission is what produces the bundled commit the rule above exists to prevent,
  since the answer is always yes and by the time it arrives the next change is already
  in the tree. **Push, PR and merge stay explicit every time**, never a standing
  permission: a stray push once put a Vercel preview on PROD Firebase (memory:
  `never-push-without-permission.md`). The ship-run phrase is that explicit ask, for
  that run only.
- **Never `--amend` or force-push** to fold a follow-up into an earlier commit. The
  separate-commit record *is* the deliverable. A fix to a made commit is a new commit.
- **One version per branch, one branch per PR.** Many commits and features per branch,
  only ever one version.
- **A previous PR open? Don't start the next *version*** (§2). Another commit on the
  open branch under the same version is fine; a second version in flight is not.
- **No push before the review has run** (§5).
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
- **"/code-review and ship"** — the ship run (§5), end to end in one turn: review the
  branch diff → verify each finding → fix the ones that survive, one commit each →
  full gate → push → open the PR → write the thread summary into both folders → one
  closing report. No question mid-run; a finding that would change shipped behaviour
  goes to ROADMAP.md instead of being built. You can't invoke `/code-review` yourself,
  so if a push is due without one, ask him to issue the phrase.

  **Older wordings name the same run** and still trigger it in full:
  `/code-review, fix all findings, push and sum up the thread` (v4's, tail step
  included — v5 spells that step "sum up **this** thread" everywhere, which is what §9
  below and the `UserPromptSubmit` hook both use) and `/code-review and push` (v3's).
  Only the name got shorter — habit shouldn't quietly buy back the old two-turn
  behaviour.
- **"sum up this thread"** — two modes, and which one applies is something you know
  rather than guess:
  - **Standalone** (the usual case): **the branch is already merged.** Assume so unless
    told otherwise — he types it at the end of a finished unit of work, and asking
    wastes a turn (memory: `sum-up-thread-implies-merged.md`). Mark the version MERGED,
    with the prod boot-banner check and syncing local to main as the only steps left.
  - **As the tail of the ship run** (§5): you opened the PR minutes ago, so it is
    **open** — write it that way, with the PR number.

  Either way the summary needs writing and loose ends get closed in the *same* pass;
  sparing a second prompt that re-reads all this context is the entire point. Before
  writing, work out which of these actually apply, and prefer checking to asking:
  - **PROD Firebase rules** — only if this version added a persisted node or a
    `<name>Rev` pair needing the manual console step (`database.rules.README.md`).
    That is a grep over the diff, not a question. A version that touched no rules is
    never asked about rules.
  - **Unresolved threads to carry forward** — discussed but not shipped, so it lands
    in the summary and ROADMAP.md (§7) instead of evaporating. You were in the
    conversation; list them and let him correct the list.

  **If nothing is genuinely undeterminable, ask nothing and write the summary.** These
  confirmations catch real gaps; they are not a ritual.

  Then update *both* folders: the summary as `MGT_Bookings_<topic>_Thread_Summary.md`
  in `/Users/patrykzychowicz/Desktop/megustastu-bookings context`, plus refreshed
  `CLAUDE.md` / `REFACTOR_LOG.md` mirrors there. Mechanics: CLAUDE.md's "Trigger
  phrases" section.

## When this skill doesn't apply

§2–§9 govern the moment work is about to land in `src/` with intent to ship — pure
exploration, reading code, or "how does X work" needs none of the branch/PR machinery.
**§0 and §1 are the exceptions**: the bootstrap is cheap by design, and the effort
check belongs to plan mode whatever the plan turns out to be. The two governing rules
at the top apply everywhere, always.

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
