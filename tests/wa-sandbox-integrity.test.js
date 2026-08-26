// tests/wa-sandbox-integrity.test.js
//
// ── Why this file exists ─────────────────────────────────────────────────────
// The sandbox's own edits to files that PROD also owns are the one thing a
// production sync can silently revert, and at the 17.15.0 sync it reverted two
// of them at once.
//
// The mechanism is worth stating exactly, because it is not obvious and it will
// recur: when a shared file conflicts, the fast resolution is to take prod's
// copy — `git checkout --theirs`. That does not resolve the conflicted HUNK, it
// discards the ENTIRE ours-side of the file, **including hunks that never
// conflicted**. `useKeyboardShortcuts.js` conflicted on ONE line (`anyModal`)
// and lost the module's only two keyboard entry points with it. `atoms.jsx`
// conflicted on `Overlay` and lost a `minWidth: 0` nine lines of comment
// explained, eight versions after it was added to fix the exact bug it came
// back as.
//
// Neither loss is reachable from any other test, and — this is the part that
// makes a guard necessary rather than nice — **prod will never reintroduce
// them**. They are fixes for problems only the sandbox has, so every future
// sync pulls a prod file that has never contained them, and the reverting
// commit looks like a clean merge.
//
// The mount card has always carried this as a prose checklist ("after every
// sync, re-check ..."). A checklist that runs in a human's head once per sync
// is exactly the shape of thing this repo has repeatedly found written down and
// read past. These are the same facts as a build gate.
//
// ── Entry criterion ──────────────────────────────────────────────────────────
// Same as tests/stylesheet.test.js' CRITICAL_SELECTORS: does it fail SILENTLY
// when missing? A dropped `minWidth: 0` still builds, still passes lint, still
// renders — it just renders wrongly, on one surface, at one width. A dropped
// key handler does nothing at all until someone presses the key. Anything whose
// absence throws, or that another test already covers, does not belong here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

describe("WA sandbox — edits to shared PROD files survive a sync", () => {
  it("Reveal's VERTICAL inner track keeps minWidth: 0", () => {
    const atoms = read("src/components/atoms.jsx");
    // The vertical branch is the one that reads `gridTemplateRows`; its inner
    // style is the `: { overflow ... }` arm of the `horizontal ? ... : ...`.
    const vertical = atoms.match(/:\s*\{\s*overflow:\s*revealed[^}]*\}/g) || [];
    expect(vertical.length, "Reveal's inner-style ternary changed shape — re-read this test").toBe(1);
    expect(
      /minWidth:\s*0/.test(vertical[0]),
      "Reveal's vertical inner track has lost `minWidth: 0`. It is a GRID ITEM, so its " +
      "default `min-width: auto` is its content's MIN-CONTENT width — wrap `white-space: nowrap` " +
      "text (the WA conversation rows) and every row renders as wide as its own longest line " +
      "instead of filling the pane, with the ellipsis dead. Fixed in b9fc8d0 (17.6.0-wa-sandbox), " +
      "reverted by the 17.15.0 sync, restored. Prod will never put it back for you."
    ).toBe(true);
  });

  it("both Reveal branches constrain BOTH axes", () => {
    // The original defect was an ASYMMETRY: the horizontal branch set minWidth
    // and minHeight, the vertical one set only minHeight. Stating the symmetry
    // catches the next version of this rather than only the last one.
    const atoms = read("src/components/atoms.jsx");
    const arms = atoms.match(/[?:]\s*\{\s*overflow:\s*revealed[^}]*\}/g) || [];
    expect(arms.length, "expected exactly two Reveal inner-style arms").toBe(2);
    arms.forEach((arm) => {
      expect(/minWidth:\s*0/.test(arm) && /minHeight:\s*0/.test(arm),
        "a Reveal inner track constrains one axis but not the other: " + arm).toBe(true);
    });
  });

  it("the I and X shortcuts exist and are WA_SANDBOX-gated", () => {
    const kb = read("src/hooks/useKeyboardShortcuts.js");
    expect(kb, "the WA_SANDBOX import is gone, so the gate below cannot be honoured")
      .toContain('from "../lib/waSandbox"');
    // Gated, not merely present: an ungated handler is a WhatsApp surface in a
    // PROD build, which is the leak the whole module is gated against.
    expect(/k==="i"\|\|k==="I"\)&&WA_SANDBOX/.test(kb),
      "the `I` shortcut (open inbox) is missing or no longer WA_SANDBOX-gated").toBe(true);
    expect(/k==="x"\|\|k==="X"\)&&WA_SANDBOX/.test(kb),
      "the `X` shortcut (open simulator) is missing or no longer WA_SANDBOX-gated").toBe(true);
  });

  it("useFlip still accepts the isQuiet predicate", () => {
    // Not superseded by v17.15.0's container-relative measurement: that cancels
    // a shift OF the container, this covers a sibling's height transition
    // easing rows WITHIN it. Losing it replays a move the user already watched.
    expect(read("src/components/atoms.jsx")).toMatch(/export function useFlip\(deps,\s*isQuiet\)/);
  });

  it("useRevealRows still accepts { speed, instantIn }", () => {
    const src = read("src/hooks/useRevealRows.js");
    expect(src).toMatch(/export function useRevealRows\(ids,\s*resetKey,\s*opts\)/);
    expect(src).toContain("instantIn");
    expect(src, "the prune window must derive from the caller's named speed").toContain("exitHold(speed)");
  });

  it("Reveal still offers `presentational`, and the conversation list still uses it", () => {
    // Without it the list stops OWNING its items — three levels of generic div
    // between `role="list"` and each `role="listitem"` — and a screen reader
    // loses the count and position the role exists to give. Nothing throws.
    expect(read("src/components/atoms.jsx")).toMatch(/export function Reveal\(\{[^}]*presentational[^}]*\}\)/);
    expect(read("src/components/whatsapp/ConversationList.jsx")).toMatch(/^\s*presentational\s*$/m);
  });

  it("Overlay still offers panel mode, and the inbox still uses it", () => {
    expect(read("src/components/atoms.jsx")).toMatch(/export function Overlay\(\{[^}]*panel[^}]*\}\)/);
    expect(read("src/components/whatsapp/InboxPanel.jsx")).toMatch(/<Overlay[^>]*panel=\{/);
  });

  it("AlertPanel still offers `action` and `onHeaderClick`, and both panes use them", () => {
    // v17.15.3. AlertPanel is a PROD file the sandbox extended, so it is now a
    // shared merge file and inherits this file's whole reason for existing.
    //
    // It meets the entry criterion exactly — does it fail SILENTLY when missing.
    // Both props are optional and read only through destructuring, so a sync
    // that took prod's copy wholesale would drop them and React would pass the
    // callers' `action={…}` / `onHeaderClick={…}` straight into the void: the
    // draft banner loses its only dismiss, the intent banner loses its Apply /
    // Handled buttons AND its collapse toggle, and the build, the lint and the
    // other 649 tests all stay green.
    const ap = read("src/components/AlertPanel.jsx");
    expect(ap).toMatch(/export function AlertPanel\(\{[^}]*\baction\b[^}]*\}\)/);
    expect(ap).toMatch(/export function AlertPanel\(\{[^}]*\bonHeaderClick\b[^}]*\}\)/);
    // …and it is actually RENDERED, not merely accepted and dropped.
    expect(ap).toMatch(/\{action \?/);
    expect(ap).toMatch(/onClick=\{onHeaderClick\}/);
    expect(read("src/components/whatsapp/DraftCard.jsx")).toMatch(/action=\{/);
    const ib = read("src/components/whatsapp/IntentBanner.jsx");
    expect(ib).toMatch(/action=\{/);
    expect(ib).toMatch(/onHeaderClick=\{toggle\}/);
  });

  it("the WhatsApp settings tab is spliced into the ONE tab list", () => {
    // Lose this and the whole WhatsApp settings tab disappears, taking
    // auto-archive-on-complete's only control with it — silently, since
    // SETTINGS_TABS is also what drives the ←/→ tab cycle.
    const chrome = read("src/components/SettingsChrome.jsx");
    expect(chrome).toMatch(/WA_SANDBOX \?[^:]*id: "whatsapp"/);
  });

  it("firebase.js keeps the VITE_FB_TARGET override, and forceWebSockets runs BEFORE getDatabase", () => {
    // The highest-stakes line in the sandbox: the override is what points the
    // DEPLOYED sandbox at DEV Firebase. Lose it and
    // megustastu-bookings-wa-sandbox.vercel.app writes to PROD.
    const fb = read("src/firebase.js");
    expect(fb, "the VITE_FB_TARGET override is gone — a deployed sandbox build would hit PROD Firebase")
      .toContain("VITE_FB_TARGET");
    // Ordering is a real SDK constraint, not style: transports must be chosen
    // before the first Database instance exists.
    expect(fb.indexOf("forceWebSockets()")).toBeGreaterThan(-1);
    expect(
      fb.indexOf("forceWebSockets()") < fb.indexOf("getDatabase(app)"),
      "forceWebSockets() must be called before getDatabase()"
    ).toBe(true);
  });

  it("the phone primitives are still imported from customers.js, with the explicit extension", () => {
    // The complementarity contract: ONE phone-identity primitive, never two.
    // The `.js` is load-bearing — this file is imported by Node ESM server code.
    expect(read("src/lib/whatsapp.js")).toMatch(
      /export \{[^}]*matchCustomerByPhone[^}]*\} from "\.\/customers\.js"/
    );
  });
});
