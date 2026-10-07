// tests/lint-cap.test.js — v18.4.5
//
// The lint gate caps WARNINGS (Patryk, 2026-10-07): `eslint . --max-warnings N`
// in the `lint` script, which is what both CI and the local gate run. The cap
// exists so a new warning fails the run; it is only worth having while nobody
// can raise it, or drop it, without a test saying so. Lowering it is the
// expected edit, when warnings are fixed, and passes.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CEILING = 63;

describe("the lint gate", () => {
  const lint = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.lint;

  it("caps warnings, at no more than the 2026-10-07 count", () => {
    const m = lint.match(/--max-warnings[ =](\d+)/);
    expect(m, "the lint script has no --max-warnings").not.toBeNull();
    expect(Number(m[1])).toBeLessThanOrEqual(CEILING);
  });

  it("is what CI runs, so the cap cannot be bypassed there", () => {
    const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toMatch(/^\s+run: npm run lint\s*$/m);
    expect(ci).not.toMatch(/run:.*\beslint\b/);
  });
});
