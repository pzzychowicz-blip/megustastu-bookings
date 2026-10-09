// tests/motion.test.js
//
// v17.15.0 — the exit-completeness guard.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// An element that animates OUT has two independent halves: a CSS keyframe class
// that runs for some duration, and a JS timeout that decides when to unmount the
// node. They are written in different files, in different languages, and nothing
// connects them. When the timeout is shorter than the animation, the exit is not
// broken in any way a reviewer can see — it plays part of the way and the node
// blinks out of existence at whatever opacity it had reached. It still looks
// like "an animation happened".
//
// It was wrong in FOUR places at once, by four different hand-typed numbers:
//
//   Presence          outMs 200  vs 240ms  → 83%
//   Presence sites    outMs 190  vs 240ms  → 79%   (six of them)
//   Toast             outMs 210  vs 240ms  → 87%
//   ModalPresence     outMs 200  vs 240ms  → 83%   (every modal in the app)
//   Reveal            unmount 300 vs 385ms → 78%
//   useRevealRows     PRUNE_MS 350 vs 385ms → 91%
//
// Measured live before the fix: closing the booking form ran `mgt-scrim-out`
// (duration 240) and unmounted it at currentTime 167 — the scrim disappeared at
// 70% of its own fade, still plainly visible on screen.
//
// Exactly ONE site in the app had it right — ConnectionStatus, whose comment
// read "outMs must match --t-move (240ms) or the node unmounts mid-animation".
// The knowledge existed and had not propagated, which is the condition this
// guard replaces: the holds are derived from the tokens now, and this test is
// what stops the next literal from creeping back in.
//
// ── What this checks ─────────────────────────────────────────────────────────
// 1. Every derived hold strictly exceeds the animation it is holding for.
// 2. `M.dur`'s raw numbers still match index.html's tokens — they are the only
//    values in the motion system that can drift, because a JS timeout and a
//    WAAPI easing cannot read a CSS var.
// 3. No component passes a hand-typed `outMs` again.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { join } from "node:path";
import { M, EXIT_MS, REVEAL_EXIT_MS, exitHold } from "../src/lib/constants.js";

const ROOT = join(import.meta.dirname, "..");
// v17.15.1: duration tokens now live in src/index.css (moved out of the
// inline <style> so the service worker can cache them). Same tokens.
// v18.0.0 phase 4: this one stays RAW and the choice is deliberate. It is CSS,
// and `stripComments` is the JS/JSX stripper — a bare `//` in a CSS value (an
// unquoted `url(https://…)`) is not a comment there, and it would truncate the
// rest of the line. `tests/stylesheet.test.js` keeps its own CSS stripper for
// the same reason. Every JS/JSX read below goes through `code()`.
const html = readFileSync(join(ROOT, "src", "index.css"), "utf8");
// Prose that names the thing a matcher hunts for is indistinguishable from the
// thing (three occurrences in this repo), so every JS source read is stripped.
const code = (...a) => stripComments(readFileSync(...a)).join("\n");

function token(name) {
  const m = html.match(new RegExp("--" + name + ":\\s*(\\d+)ms"));
  if (!m) throw new Error("token --" + name + " not found in src/index.css");
  return Number(m[1]);
}

describe("motion tokens", () => {
  it("M.dur mirrors index.html's duration tokens", () => {
    // These are hand-kept in step on purpose (a timeout / WAAPI easing cannot
    // read a CSS var) and are therefore the one place the system can drift.
    expect(M.dur.tap).toBe(token("t-tap"));
    expect(M.dur.move).toBe(token("t-move"));
    expect(M.dur.shift).toBe(token("t-shift"));
    expect(M.dur.reveal).toBe(token("t-reveal"));
    expect(M.dur.wipe).toBe(token("t-wipe"));
  });

  it("a disclosure is slower than a bare geometry move", () => {
    // The whole reason --t-reveal is its own token rather than a bigger
    // --t-shift. If this ever inverts, the token has lost its meaning.
    expect(M.dur.reveal).toBeGreaterThan(M.dur.shift);
  });
});

describe("exit holds outlast their animations", () => {
  it("EXIT_MS outlasts every *-out keyframe class", () => {
    // Every `.mgt-*-out` rule runs for --t-move. Assert that rather than trust
    // it: a future exit class on a different duration must fail here loudly
    // instead of being truncated silently.
    const outRules = [...html.matchAll(/\.mgt-[\w-]+-out\s*\{\s*animation:\s*[\w-]+\s+var\(--([\w-]+)\)/g)]
      .map((m) => m[1]);
    expect(outRules.length).toBeGreaterThan(0);
    for (const varName of outRules) {
      expect(EXIT_MS, "`.mgt-*-out` on var(--" + varName + ") outlives EXIT_MS")
        .toBeGreaterThan(token(varName));
    }
  });

  it("REVEAL_EXIT_MS outlasts a Reveal collapse", () => {
    expect(REVEAL_EXIT_MS).toBeGreaterThan(M.dur.reveal);
  });

  it("useRevealRows keeps a departed row alive past its own Reveal", () => {
    // A row contains a Reveal, so it must outlive it — not merely match it.
    const src = code(join(ROOT, "src/hooks/useRevealRows.js"), "utf8");
    expect(src).toMatch(/PRUNE_MS\s*=\s*REVEAL_EXIT_MS/);
    expect(src).not.toMatch(/PRUNE_MS\s*=\s*\d/);
  });

  // v18.3.2 (O3): measured on DEV, deleting the List's last card through its
  // confirm held the page ~380ms before the first frame; the fold began then and
  // a prune timed from the effect cut it at half height. Both holds under a
  // folding row start on the frame the fold starts on, and a change that lands
  // while the page is hidden snaps (it would otherwise play on wake).
  it("useRevealRows times its prune from the fold's first frame", () => {
    const src = code(join(ROOT, "src/hooks/useRevealRows.js"), "utf8");
    expect(src).toMatch(/import \{ afterFrame, pageHidden \} from "\.\.\/lib\/after-frame";/);
    expect(src).toMatch(/timers\.current\[id\] = afterFrame\(function \(\) \{\s*delete timers\.current\[id\];[\s\S]*?\}, pruneMs\);/);
    expect(src, "no prune timed from the effect").not.toMatch(/setTimeout\(/);
    expect(src, "timers hold afterFrame's cancel").not.toMatch(/clearTimeout\(/);
  });
  it("Reveal times its unmount and its reveal from the frame their transition starts on", () => {
    const atoms = code(join(ROOT, "src/components/atoms.jsx"), "utf8");
    const body = atoms.slice(atoms.indexOf("export function Reveal("), atoms.indexOf("export function AutoHeight("));
    expect(atoms.indexOf("export function AutoHeight(")).toBeGreaterThan(atoms.indexOf("export function Reveal("));
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/setOpen\(true\);\s*stopHold = afterFrame\(function \(\) \{ setRevealed\(true\); \}, exitHold\(speed\)\);/);
    expect(body).toMatch(/if \(pageHidden\(\)\) \{ setMounted\(false\); return undefined; \}\s*return afterFrame\(function \(\) \{ setMounted\(false\); \}, exitHold\(speed\)\);/);
    expect(body).toMatch(/if \(pageHidden\(\)\) \{ setOpen\(true\); setRevealed\(true\); return undefined; \}/);
    expect(body, "no hold started in the effect").not.toMatch(/setTimeout\(/);
  });

  // v18.3.3: those holds start after a commit, so the fold has to be drawn BY
  // that commit. Read from state, it began a render later (two, for a
  // useRevealRows row), which a busy main thread pushes frames later: measured
  // headless at 4× CPU, a cancelled List card was unmounted with ~35ms of its
  // fold left, and the tablet cut one at 3px. Both halves read `show` itself.
  it("Reveal draws closed from the render that receives show={false}", () => {
    const atoms = code(join(ROOT, "src/components/atoms.jsx"), "utf8");
    const body = atoms.slice(atoms.indexOf("export function Reveal("), atoms.indexOf("export function AutoHeight("));
    expect(body).toMatch(/const isOpen = show && open;/);
    expect(body).toMatch(/const isRevealed = show && revealed;/);
    expect(body).toMatch(/gridTemplateRows: isOpen \? "1fr" : "0fr"/);
    expect(body).toMatch(/gridTemplateColumns: isOpen \? "1fr" : "0fr"/);
    expect(body).toMatch(/opacity: isOpen \? 1 : 0/);
    expect(body.match(/overflow: isRevealed \?/g)).toHaveLength(2);
    expect(body, "no wrapper reads the state alone").not.toMatch(/[(:] open \?|overflow: revealed \?/);
  });
  it("useRevealRows reports a departed id closed in the render that loses it", () => {
    const src = code(join(ROOT, "src/hooks/useRevealRows.js"), "utf8");
    expect(src).toMatch(/return \{ renderIds, openIds: openNow \};/);
    expect(src).toMatch(/const openNow = gone \? new Set\(Array\.from\(openIds\)\.filter\(function \(id\) \{ return ids\.indexOf\(id\) !== -1; \}\)\) : openIds;/);
  });

  // v18.3.0 (O1): the timeline's arrivals and departures. Both holds clear the
  // entrance/exit classes, so a short one cancels the entrance (a class removed
  // mid-animation snaps to full) or unmounts the leaving copy mid-fade.
  it("useEnterLeave holds both halves for exitHold(speed), never a literal", () => {
    const src = code(join(ROOT, "src/hooks/useEnterLeave.js"), "utf8");
    expect(src).toMatch(/const hold = exitHold\(/);
    expect((src.match(/afterFrame\(function \(\) \{ set(?:Leaving|Arriving)\(NO_(?:SNAPS|IDS)\); \}, hold\)/g) || []).length,
      "both clears are timed by the derived hold").toBe(2);
    // …starting on the frame the animation starts on, not in the effect: a
    // tap's passive effects run before the paint (lib/after-frame.js).
    expect(src).toMatch(/import \{ afterFrame(, pageHidden)? \} from "\.\.\/lib\/after-frame"/);
    expect(src).not.toMatch(/\},\s*\d+\s*\)/);
    // …and the timeline asks for the speed its classes run on (--t-move).
    const tl = code(join(ROOT, "src/components/TimelineView.jsx"), "utf8");
    expect(tl).toMatch(/useEnterLeave\([\s\S]*?\{ speed: "move"(, quiet: catchingUp)? \}\s*\)/);
    // /code-review: the snapshots' lanes follow the layout and the clock too.
    expect(tl).toMatch(/\[bookings, late, warnings, clashes, freeing, chipsOn, layoutSig, nowMins\],/);
    expect(token("t-move")).toBe(M.dur.move);
  });

  // /review-animations: the shared primitive under every Presence, Toast and
  // ModalPresence. Its hold started in the effect that SETS `leaving`, one render
  // before the `-out` class commits, and a status pick blocks the page between
  // the two: the quick-status card's exit ran 170 of 240ms and vanished at 0.55.
  it("usePresenceLifecycle times its hold from the leaving frame", () => {
    const atoms = code(join(ROOT, "src/components/atoms.jsx"), "utf8");
    const body = atoms.slice(atoms.indexOf("function usePresenceLifecycle("), atoms.indexOf("export function Presence("));
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/if \(!leaving\) return undefined;\s*return afterFrame\(function \(\) \{ setRender\(false\); setLeaving\(false\); \}, outMs\);\s*\}, \[leaving, outMs\]\)/);
    expect(body, "no hold started in the effect that sets leaving").not.toMatch(/setTimeout\(/);
    const lib = code(join(ROOT, "src/lib/after-frame.js"), "utf8");
    expect(lib).toMatch(/requestAnimationFrame\(function \(\) \{ t = setTimeout\(fn, ms\); \}\)/);
  });

  // /review-animations: a popup closed by a PICK hands off to its result (the
  // wipe, a form, the split) and leaves at once; only a dismiss plays the exit.
  // The skip must be asked BEFORE the close, in the same handler, so the render
  // that closes already knows. Measured before: the quick-status card sat 88%+
  // opaque over the wipe's first 39%, the Plan popover over the booking form.
  it("a popup's picks skip the exit, and only ModalPresence honours it", () => {
    const atoms = code(join(ROOT, "src/components/atoms.jsx"), "utf8");
    expect(atoms).toMatch(/const skip = instant \|\| handoff;/);
    expect(atoms).toMatch(/if \(!render \|\| \(!show && skip\)\) return null;/);
    expect(atoms, "a skip is cleared while the surface is open").toMatch(/if \(show && instant\) setInstant\(false\);/);
    // /code-review: a close from OUTSIDE the popup hands off through the prop.
    // The timeline's drag arm closes the card that way, and the parent clears it on reopening.
    const tl = code(join(ROOT, "src/components/TimelineView.jsx"), "utf8");
    expect(tl).toMatch(/<ModalPresence show=\{!!quickStatus\} handoff=\{quickHandoff\}>/);
    expect(tl).toMatch(/if \(quickStatus && quickHandoff\) setQuickHandoff\(false\);/);
    expect(tl).toMatch(/if \(handOffQuick\) handOffQuick\(\); else setQuickStatus\(null\);/);
    expect((tl.match(/handOffQuick=\{handOffQuick\}/g) || []).length, "both live block sites get the hand-off").toBe(2);
    const sites = [
      ["src/components/QuickStatusPopup.jsx", ["onStatus(booking.id, st)", "onNoShow(booking.id)", "onDelete(booking.id)"]],
      ["src/components/PlanView.jsx", ["onPick(b)", "onWalkinHere()"]],
      ["src/components/SplitMenu.jsx", ["onConfirm({"]],
    ];
    for (const [file, picks] of sites) {
      const src = code(join(ROOT, file), "utf8");
      expect((src.match(/skipExit\(\);/g) || []).length, file + ": one skip per pick").toBe(picks.length);
      for (const pick of picks) {
        const at = src.indexOf(pick);
        expect(at, file + " still has " + pick).toBeGreaterThan(0);
        // v18.3.1: the ⋯ card's `handBack()` (focus only, it renders nothing) may sit between.
        expect(src.slice(Math.max(0, at - 80), at), file + ": skipExit() right before " + pick).toMatch(/skipExit\(\);\s*(handBack\(\);\s*)?$/);
      }
    }
  });

  // The hook compares its deps by IDENTITY during render, so a map prop that
  // defaults to `{}` is a new object on every pass and the body never settles.
  it("the timeline's snapshotted maps default to one frozen object", () => {
    const tl = code(join(ROOT, "src/components/TimelineView.jsx"), "utf8");
    for (const name of ["warnings", "clashes", "late", "freeing"]) {
      expect(tl, name).toMatch(new RegExp("\\b" + name + " = NO_MARKS\\b"));
    }
  });
});

// v17.15.0 — `Reveal` takes a `speed` naming an entry of the M scale, because
// the notification strip's PANE arriving is not the disclosure --t-reveal was
// written for (see the token's own note in index.html). The name buys one thing
// over a duration: the CSS timing and the unmount hold cannot be given
// separately, which is the exact defect this file was created for.
//
// A typo fails in complete silence and in BOTH halves at once. `M["slide"]` is
// undefined, so the transition string reads "grid-template-rows undefined" and
// the browser drops the declaration — no animation. `M.dur["slide"]` is
// undefined too, so the hold is NaN, `setTimeout` coerces that to 0 and the node
// unmounts on the next tick. A Reveal that neither animates nor waits, from one
// misspelt word.
describe("Reveal speeds name a real entry of the scale", () => {
  it("every M.dur entry has its CSS pair and a hold that outlasts it", () => {
    for (const speed of Object.keys(M.dur)) {
      expect(M[speed], "M." + speed + " has no CSS string").toBeTruthy();
      expect(exitHold(speed), "exitHold(" + speed + ") must outlast its own animation")
        .toBeGreaterThan(M.dur[speed]);
    }
  });

  it("Reveal derives both halves from the speed it was given", () => {
    const src = code(join(ROOT, "src/components/atoms.jsx"), "utf8");
    // The hold, twice (settle + unmount), and the easing — all from `speed`.
    expect((src.match(/exitHold\(speed\)/g) || []).length,
      "Reveal's two timeouts must both derive from its speed").toBe(2);
    expect(src).toMatch(/const ease = M\[speed\]/);
  });

  it("no call site names a speed that does not exist", () => {
    const names = new Set(Object.keys(M.dur));
    const offenders = [];
    // ALL of src/, recursively (/code-review). Scanning only `src/components`
    // and `src/App.jsx` left `src/hooks/` out, and `useReminders.jsx` is the one
    // hook that returns JSX — so the single place in the app where a Reveal can
    // be written outside a component file was the one place unguarded.
    const files = [];
    (function walk(dir, label) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name), label + e.name + "/");
        else if (/\.jsx?$/.test(e.name)) files.push([label + e.name, join(dir, e.name)]);
      }
    })(join(ROOT, "src"), "src/");
    for (const [label, full] of files) {
      for (const m of code(full, "utf8").matchAll(/\bspeed="([^"]*)"/g)) {
        if (!names.has(m[1])) offenders.push(label + ': speed="' + m[1] + '"');
      }
    }
    expect(offenders, "a speed must be a key of M.dur").toEqual([]);
  });
});

describe("no hand-typed exit delays", () => {
  it("no component passes a literal outMs", () => {
    // The defect was never one wrong number; it was that the number was
    // writable at the call site at all. Defaults come from the token now.
    const dir = join(ROOT, "src/components");
    const offenders = [];
    for (const f of readdirSync(dir)) {
      if (!/\.jsx?$/.test(f)) continue;
      if (/outMs=\{\d+\}/.test(code(join(dir, f), "utf8"))) offenders.push(f);
    }
    const app = code(join(ROOT, "src/App.jsx"), "utf8");
    if (/outMs=\{\d+\}/.test(app)) offenders.push("App.jsx");
    expect(offenders, "pass no outMs and take the EXIT_MS default").toEqual([]);
  });
});

// ── v18.5.0: the tag chip's check mark ───────────────────────────────────────
// It shipped for five phases as `{pressed ? <CheckIcon /> : null}`: there or
// gone between two frames, the chip 16px wider or narrower in that frame and
// every chip after it jumping with it (Patryk's report; measured on DEV as
// 58.7 → 74.7px in one commit). A conditional mount looks finished in source,
// which is why this is pinned: nothing else in the repo can see it come back.
describe("a pressed tag chip's mark arrives and leaves", () => {
  const chips = code(join(ROOT, "src/components/TagChips.jsx"), "utf8");

  it("the mark sits in a horizontal Reveal, never a conditional mount", () => {
    expect(chips).toContain('<Reveal horizontal show={pressed} speed="move"><span style={MARK}><CheckIcon size={IC.inline} /></span></Reveal>');
    // No second mark, and none that mounts on the state: `? <CheckIcon` is the
    // shape that snaps, in either branch order.
    expect((chips.match(/<CheckIcon\b/g) || []).length).toBe(1);
    expect(chips).not.toMatch(/\?\s*<CheckIcon\b/);
    expect(chips).not.toMatch(/&&\s*<CheckIcon\b/);
  });

  it("the gap to the name is inside the reveal, so the whole 16px eases", () => {
    // With the atom's own gap the Reveal is a flex child from mount to unmount,
    // and the chip jumps 4px at each end of a 12px ease.
    const pressable = chips.slice(chips.indexOf("const PRESSABLE"), chips.indexOf("const MARK"));
    expect(pressable).toMatch(/\bgap: 0\b/);
    expect(chips).toMatch(/const MARK = \{[^}]*paddingRight: SP\.tight[^}]*\}/);
  });

  it("the ring and the ink ease with it, and the hover lift keeps its own ease", () => {
    // An inline transition REPLACES .mgt-hover-scale's list, so the three
    // properties that class animates on this chip are restated beside the two
    // the state changes.
    const pressable = chips.slice(chips.indexOf("const PRESSABLE"), chips.indexOf("const MARK"));
    for (const [prop, speed] of [["transform", "tap"], ["background-color", "tap"], ["box-shadow", "tap"], ["border-color", "move"], ["color", "move"]]) {
      expect(pressable, prop).toContain('"' + (prop === "transform" ? "" : ", ") + prop + ' " + M.' + speed);
    }
    expect(chips).toContain('className="mgt-hover-scale" style={PRESSABLE}');
  });
});

// ── v18.5.0: an opened customer's tag chips stay under the finger ────────────
// The tag words under the phone number mounted ABOVE the chips of the opened
// row, so the first tag tapped (and the last removed) moved the chips 11px in
// the commit the tap caused (measured on DEV: 735.5 → 746.5 and back). The
// words are the closed row's now and fold away as it opens (Patryk's choice,
// 2026-10-09), so nothing above the chips changes while they can be tapped.
describe("a customer's tag words belong to the closed row", () => {
  const customers = code(join(ROOT, "src/components/CustomersSettings.jsx"), "utf8");

  it("the words sit in a Reveal that is shut while the row is open", () => {
    expect(customers).toContain('<Reveal show={!open && tagNames.length > 0}>{tagNames.length ? <div');
    // One place draws them, and it is that one.
    expect((customers.match(/tagNames\.join\(/g) || []).length).toBe(1);
    const at = customers.indexOf("tagNames.join(");
    expect(customers.lastIndexOf("<Reveal show={!open && tagNames.length > 0}>", at)).toBeGreaterThan(customers.lastIndexOf("</Reveal>", at));
  });

  it("it folds on the body's clock, so the row and its words move as one", () => {
    // The body is a default-speed Reveal; a `speed` on the words would finish
    // the header's 11px before or after the body beneath it.
    const words = customers.slice(customers.indexOf("<Reveal show={!open && tagNames.length > 0}"), customers.indexOf("tagNames.join("));
    expect(words).not.toContain("speed=");
    expect(customers).toContain("<Reveal show={open}>");
  });
});
