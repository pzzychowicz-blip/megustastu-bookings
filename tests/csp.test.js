// tests/csp.test.js
//
// v17.10.1 — the CSP pins index.html's inline boot script by SHA-256, and
// nothing kept the two in sync.
//
// `vercel.json`'s `script-src` is `'self'` plus one hash. Edit the inline
// script and the hash no longer matches, so the browser BLOCKS it — silently,
// in production only, with the app otherwise looking fine. That had already
// happened: on `main` the pin was `Q6OfSa…` while the served script hashed to
// `AAYhJC…`, so in production the boot script was not running at all. It costs
// three things, none of which throw:
//
//   • the no-flash theme script (so the wrong theme flashes on every load),
//   • the `data-motion="reduce"` pre-mount stamp,
//   • the empty passive `touchstart` listener — which, per CLAUDE.md, is the
//     ONLY reason `:active` press feedback works on iOS at all.
//
// Verified by serving a fixture with the production CSP and watching Chrome
// refuse the script ("Executing inline script violates the following Content
// Security Policy directive"). Arithmetic alone would have been enough, but
// this class of bug has been believed-and-wrong here before.
//
// The hash is over the EXACT bytes between <script> and </script>. Vite does
// not currently transform that block, and this test asserts that too rather
// than assuming it: when dist/ exists, source and built must agree.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Inline blocks only: `<script>` with no attributes. The module bundle is
// `<script type="module" src=...>` and is covered by 'self', not by a hash.
function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("base64");

const html = readFileSync(join(ROOT, "index.html"), "utf8");
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));

function scriptSrc() {
  for (const entry of vercel.headers || []) {
    for (const h of entry.headers || []) {
      if (/content-security-policy/i.test(h.key)) {
        const m = /script-src ([^;]+)/.exec(h.value);
        if (m) return m[1].trim();
      }
    }
  }
  return "";
}

describe("CSP ↔ inline boot script", () => {
  const blocks = inlineScripts(html);

  it("has exactly one inline script to pin", () => {
    expect(blocks.length).toBe(1);
  });

  it("pins the inline script's actual hash in vercel.json", () => {
    const actual = sha256(blocks[0]);
    const src = scriptSrc();
    expect(src, "no script-src found in vercel.json").not.toBe("");
    expect(
      src.includes(`'sha256-${actual}'`),
      `script-src does not pin the boot script.\n`
        + `  expected: 'sha256-${actual}'\n`
        + `  found:    ${src}\n`
        + `  → the browser will BLOCK the boot script in production.`
    ).toBe(true);
  });

  it("does not pin a hash that matches nothing", () => {
    const pinned = [...scriptSrc().matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);
    const actual = blocks.map(sha256);
    for (const p of pinned) {
      expect(actual, `stale pin 'sha256-${p}' matches no inline script`).toContain(p);
    }
  });

  // Vite processes index.html; if it ever rewrites the inline block, the source
  // hash would pass here while production stayed blocked.
  //
  // /code-review: this used to `return` when dist/ was missing, which made the
  // one assertion covering "Vite rewrote the block" the one most likely never
  // to run — `npm test` alone skips it entirely, and CI only happens to build
  // first. A stale dist is the other half: during this session a pin refresh
  // preceded a rebuild and the comparison was against a build that no longer
  // corresponded. So: skipping is now VISIBLE, and a stale dist fails loudly
  // rather than comparing the wrong bytes.
  it.runIf(existsSync(join(ROOT, "dist/index.html")))(
    "built output matches the source block",
    () => {
      const built = inlineScripts(readFileSync(join(ROOT, "dist/index.html"), "utf8"));
      expect(built.length).toBe(blocks.length);
      expect(
        sha256(built[0]),
        "dist/index.html's boot script differs from the source — either Vite "
          + "rewrote it (in which case the pin must be computed from dist), or "
          + "dist/ is stale; re-run `npm run build`."
      ).toBe(sha256(blocks[0]));
    }
  );
});
