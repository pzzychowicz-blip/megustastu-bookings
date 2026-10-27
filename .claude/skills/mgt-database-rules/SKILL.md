---
name: mgt-database-rules
description: >-
  What Firebase RTDB security rules cannot express, and the two traps that came from it in MGT Bookings. Load BEFORE writing or changing a rule in database.rules.json, or a test in tests/rules/ — rules cannot count children, and a predicate copied across sibling rules needs a capability-exact sweep, not just a presence sweep.
---

# Writing a rule in `database.rules.json`

Moved verbatim from the root `CLAUDE.md` Gotchas table on 2026-10-27, so it loads when
the task is a rule rather than in every session. The root file keeps the Rule of law, the
CAS exemptions and a pointer row to this skill.

## A rule that has to COUNT children

RTDB has no `numChildren()`; `hasChildren()` answers "any at all", and there is no iteration, query or string manipulation — so "never leave `/roles` with no admin" is not expressible as written, and neither is "claim the invitation matching my email", though both were in an approved plan. **Find the DERIVED invariant that IS expressible** rather than building the state the literal reading needs: v18.0.0 refuses an admin stripping their OWN admin, which makes zero unreachable because only a holder may write `/roles` at all — one clause, no counter node, nothing to drift. The rejected alternative looks reasonable, which is why it is worth knowing: a maintained `adminCount` with delta validation IS expressible, and it turns every role write into a 2-path atomic update whose repair path is the exact Firebase-console step the guard exists to avoid

## A predicate repeated across sibling rules

`database.rules.json` has no macros, so v18.0.0's `settingsWrite` gate is written out SIXTEEN times — this repo's most-repeated defect shape ("any set of facts written out N times will be written out N−1 times by somebody") in a file where it cannot be refactored away. Two mitigations, both needed: APPLY it by script asserting each substitution lands exactly once, and SWEEP it in the emulator over a list DERIVED from the rules file, so a pair added later is covered without a test edit — a hand-typed sixteenth copy and a hand-typed test list are the same bug twice. **A derived sweep still misses half of it:** phase 3 re-pointed four pairs (`operatingHours`/`dayShifts` → `hoursEdit`, `layout` → `layoutEdit`) and the sweep passed regardless, because it drives a STAFF account holding neither capability — all sixteen could still have named `settingsWrite`. A sweep proves the gate is PRESENT; only an account carrying exactly one capability as an extra proves it is the RIGHT one, and the load-bearing half is the negative one: an account holding every capability EXCEPT the path's own must still be refused
