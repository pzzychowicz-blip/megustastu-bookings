// tests/sandbox-branch.test.js
//
// ── Why this file exists ─────────────────────────────────────────────────────
// v18.4.3. The deployed sandbox is the `sandbox` branch, which
// .github/workflows/sandbox.yml GENERATES from main on every push to main: main
// plus one appended .vercelignore line. Two files on main therefore decide what
// a branch nobody edits contains, and nothing else in the gate reads either of
// them for that purpose.
//
// What can go wrong, and what each assertion is for:
//   · the re-include lands on MAIN → the three simulator endpoints deploy to the
//     restaurant's project. They import firebase-admin (which bypasses the
//     security rules) and the Gemini client (which spends money).
//   · the workflow appends a line that is not EXACTLY the negation of main's
//     exclusion → the sandbox deploys without its backend, silently.
//   · the workflow gains a second push target → the standing permission to push
//     without asking covers `sandbox` and nothing else.
//   · the version suffix goes back to being a source edit → a generated branch
//     cannot carry one, so the sandbox would report the production version.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const rules = (text) => text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

const EXCLUDE = "api/wa-sim-*.js";
const INCLUDE = "!" + EXCLUDE;

describe("the generated sandbox branch", () => {
  it("main's .vercelignore excludes the simulator endpoints and never re-includes them", () => {
    const lines = rules(read(".vercelignore"));
    expect(lines).toContain(EXCLUDE);
    expect(
      lines.filter((l) => l.startsWith("!")),
      "a negation in main's .vercelignore — the sandbox workflow appends the only "
        + "one, on the `sandbox` branch. Here it ships the simulator to production."
    ).toEqual([]);
  });

  it("the workflow appends exactly the negation of that exclusion, after it", () => {
    const wf = read(".github/workflows/sandbox.yml");
    // The printf's payload, unescaped the way the shell will write it.
    const m = wf.match(/printf '([^']*)' >> \.vercelignore/);
    expect(m, "the append step is gone or no longer a single printf").not.toBeNull();
    const appended = rules(m[1].replace(/\\n/g, "\n"));
    expect(appended).toEqual([INCLUDE]);
    // What the sandbox deployment reads: main's file, then the appended text.
    const result = rules(read(".vercelignore") + m[1].replace(/\\n/g, "\n"));
    expect(result.indexOf(INCLUDE)).toBeGreaterThan(result.indexOf(EXCLUDE));
    // Both guards the step runs before appending.
    expect(wf).toContain("grep -qxF '" + EXCLUDE + "' .vercelignore");
    expect(wf).toContain("grep -qxF '" + INCLUDE + "' .vercelignore");
  });

  it("the workflow builds from main and pushes `sandbox`, and only `sandbox`", () => {
    const wf = read(".github/workflows/sandbox.yml");
    expect(wf).toMatch(/ref: main\n/);
    const pushes = wf.split("\n").map((l) => l.trim()).filter((l) => /^git push\b/.test(l));
    expect(pushes).toEqual(["git push --force origin sandbox"]);
    expect(wf).toMatch(/on:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:/);
  });

  it("the version is ONE literal, suffixed by the build and not by an edit", () => {
    // Stripped: both files explain the version line in prose beside it.
    const app = stripComments(read("src/App.jsx")).join("\n");
    const versions = app.match(/^\s*version:.*$/gm) || [];
    expect(versions.length, "more than one version line in App.jsx").toBe(1);
    expect(versions[0].trim()).toMatch(/^version:"\d+\.\d+\.\d+"\+\(SANDBOX_DEPLOY\?"-sandbox":""\),$/);
    // Narrower than WA_SANDBOX on purpose: the dev server is not a deployment.
    // And the env var is read ONCE: WA_SANDBOX is built from SANDBOX_DEPLOY.
    const flags = stripComments(read("src/lib/waSandbox.js")).join("\n");
    expect(flags).toContain('export const SANDBOX_DEPLOY = import.meta.env.VITE_FB_TARGET === "dev";');
    expect(flags).toContain("export const WA_SANDBOX = SANDBOX_DEPLOY || import.meta.env.DEV;");
    expect(flags.split("VITE_FB_TARGET").length - 1).toBe(1);
  });
});
