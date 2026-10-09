// tests/doc-size.test.js — v18.5.0
//
// The root CLAUDE.md is loaded into EVERY session, whatever it is about, and
// Claude Code warns once it passes 40,000 characters. It crossed that line
// silently on 2026-09-19 and was 43,967 by 2026-10-09: every version adds a
// paragraph, and nothing counted. This counts.
//
// When it fails, do not shorten sentences. Move a passage that is about app
// code, the API or the tests to the CLAUDE.md that loads with that code
// (`src/`, `src/lib/`, `src/hooks/`, `src/components/`, `api/`, `tests/`), word
// for word, and leave the RULE here in a sentence or two with a pointer. That is
// what the 2026-10-09 trim did with four passages (REFACTOR_LOG, v18.5.0).
//
// The limit is the tool's own line, not a target: the number below is where the
// warning starts.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LIMIT = 40000;

describe("the root CLAUDE.md stays under the size every session pays for", () => {
  const text = readFileSync(fileURLToPath(new URL("../CLAUDE.md", import.meta.url)), "utf8");

  it("is at most " + LIMIT + " characters", () => {
    expect(text.length, "root CLAUDE.md is " + text.length + " characters: move a passage to the CLAUDE.md beside the code it is about").toBeLessThanOrEqual(LIMIT);
  });
  it("still says so itself, where the next edit will see it", () => {
    expect(text).toContain("`tests/doc-size.test.js` fails it above 40,000 characters");
  });
});
