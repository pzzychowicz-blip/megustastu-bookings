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
import { join } from "node:path";
import { M, EXIT_MS, REVEAL_EXIT_MS, exitHold } from "../src/lib/constants.js";

const ROOT = join(import.meta.dirname, "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

function token(name) {
  const m = html.match(new RegExp("--" + name + ":\\s*(\\d+)ms"));
  if (!m) throw new Error("token --" + name + " not found in index.html");
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
    const src = readFileSync(join(ROOT, "src/hooks/useRevealRows.js"), "utf8");
    expect(src).toMatch(/PRUNE_MS\s*=\s*REVEAL_EXIT_MS/);
    expect(src).not.toMatch(/PRUNE_MS\s*=\s*\d/);
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
    const src = readFileSync(join(ROOT, "src/components/atoms.jsx"), "utf8");
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
      for (const m of readFileSync(full, "utf8").matchAll(/\bspeed="([^"]*)"/g)) {
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
      if (/outMs=\{\d+\}/.test(readFileSync(join(dir, f), "utf8"))) offenders.push(f);
    }
    const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
    if (/outMs=\{\d+\}/.test(app)) offenders.push("App.jsx");
    expect(offenders, "pass no outMs and take the EXIT_MS default").toEqual([]);
  });
});
