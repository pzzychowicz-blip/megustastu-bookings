// tests/enter-leave-wake.test.js — v18.3.1
//
// A change nobody watched does not fade (ROADMAP, found by v18.3.0's
// /code-review). Measured on the restaurant's tablet: with the screen off, the
// page is hidden and ~6s later the connection drops, so changes made
// elsewhere arrive either while hidden or in the catch-up 0.5s after the
// reconnect on wake. Both used to play every fade at once, including a deleted
// booking reappearing to fade out. v18.3.2 (O3) carries the catch-up window to
// the two lists that fold since then. Comments stripped (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");

describe("useEnterLeave: a hidden or quiet diff is a replacement", () => {
  const hook = read("hooks/useEnterLeave.js");
  it("re-seeds on a resetKey change, a hidden page, or the caller's quiet window", () => {
    // v18.3.2: the predicate lives beside afterFrame, for its three callers.
    expect(read("lib/after-frame.js")).toMatch(/export function pageHidden\(\) \{\s*return typeof document !== "undefined" && document\.visibilityState === "hidden";/);
    expect(hook).toMatch(/import \{ afterFrame, pageHidden \} from "\.\.\/lib\/after-frame";/);
    expect(hook).not.toMatch(/function pageHidden\(/);
    expect(hook).toMatch(/const quiet = !!\(opts && opts\.quiet\);/);
    expect(hook).toMatch(/if \(seen\.key !== resetKey \|\| \(!sameDeps\(seen\.deps, deps\) && \(quiet \|\| pageHidden\(\)\)\)\) \{/);
  });
  it("the timeline passes the catch-up window, and App defines it once for all three consumers", () => {
    expect(read("components/TimelineView.jsx")).toMatch(/\{ speed: "move", quiet: catchingUp \}/);
    const app = read("App.jsx");
    expect(app).toMatch(/const catchingUp=reconnectShown\|\|resyncing;/);
    expect(app.match(/catchingUp=\{catchingUp\}/g) || []).toHaveLength(3);
    expect(app).not.toMatch(/catchingUp=\{reconnectShown/);
  });
});

describe("useRevealRows: a quiet or hidden diff is a replacement (v18.3.2, O3)", () => {
  const hook = read("hooks/useRevealRows.js");
  it("re-seeds on a membership change inside the caller's quiet window or while hidden, pending prunes included", () => {
    expect(hook).toMatch(/const quiet = !!\(opts && opts\.quiet\);/);
    // During render, as the resetKey re-seed is: the first committed dom is the new list.
    expect(hook).toMatch(/const \[seenSig, setSeenSig\] = useState\(sig\);/);
    expect(hook).toMatch(/if \(sig !== seenSig\) \{\s*setSeenSig\(sig\);\s*if \(quiet \|\| pageHidden\(\)\) \{\s*setRenderIds\(ids\.slice\(\)\);\s*setOpenIds\(new Set\(ids\)\);\s*setQuietResets\(quietResets \+ 1\);\s*\}\s*\}/);
    // ONE layout effect does the bookkeeping for both re-seeds (v18.3.2's
    // /code-review): the quiet re-seed's own copy of it is gone.
    expect(hook).toMatch(/useLayoutEffect\(function \(\) \{\s*prevKeys\.current = ids\.slice\(\);\s*cancelAll\(timers\);[^}]*\}, \[prevReset, quietResets\]\);/);
    expect(hook.match(/prevKeys\.current = ids\.slice\(\);/g), "one copy of the re-seed bookkeeping").toHaveLength(1);
  });
  it("the List's cards and the waitlist's rows pass the catch-up window", () => {
    expect(read("components/ListView.jsx")).toMatch(/useRevealRows\(activeIds, date, \{ speed: ROW_FOLD, instantIn: true, quiet: catchingUp \}\)/);
    expect(read("components/WaitlistPanel.jsx")).toMatch(/useRevealRows\(ids,date,\{speed:ROW_FOLD,instantIn:true,quiet:catchingUp\}\)/);
  });
});
