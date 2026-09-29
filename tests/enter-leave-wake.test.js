// tests/enter-leave-wake.test.js — v18.3.1
//
// A change nobody watched does not fade (ROADMAP, found by v18.3.0's
// /code-review). Measured on the restaurant's tablet: with the screen off, the
// page is hidden and ~6s later the connection drops, so changes made
// elsewhere arrive either while hidden or in the catch-up 0.5s after the
// reconnect on wake. Both used to play every fade at once, including a deleted
// booking reappearing to fade out. Comments stripped (tests/test-hygiene.test.js).
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
    expect(hook).toMatch(/return typeof document !== "undefined" && document\.visibilityState === "hidden";/);
    expect(hook).toMatch(/const quiet = !!\(opts && opts\.quiet\);/);
    expect(hook).toMatch(/if \(seen\.key !== resetKey \|\| \(!sameDeps\(seen\.deps, deps\) && \(quiet \|\| pageHidden\(\)\)\)\) \{/);
  });
  it("the timeline passes the catch-up window, and App defines it", () => {
    expect(read("components/TimelineView.jsx")).toMatch(/\{ speed: "move", quiet: catchingUp \}/);
    expect(read("App.jsx")).toMatch(/catchingUp=\{reconnectShown\|\|resyncing\}/);
  });
});
