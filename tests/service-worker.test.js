// tests/service-worker.test.js
//
// v17.10.1 (/code-review) — the worker had no tests, and it is the highest-
// consequence code in the version: v17.4.0's was withdrawn because a worker
// near the data path can starve the app of its data. CLAUDE.md's rule applies
// squarely — "if a behaviour is worth a REFACTOR_LOG paragraph it is worth
// being reachable by a test".
//
// public/sw.js is not importable (it is worker-scope script, not a module), so
// these tests read it as text and exercise the two things that are pure and
// decidable: the routing predicate, and the constant it shares with the app.
// That is deliberately not "test the whole worker" — the install/activate/
// fetch lifecycle was verified on the real tablet, which no unit test replaces.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SW_CACHE } from "../src/lib/serviceWorker.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SW = readFileSync(join(ROOT, "public/sw.js"), "utf8");

// Rebuild ASSET_RE from the worker's own source, so the test cannot drift from
// it by copying the pattern.
function assetRe() {
  const m = /const ASSET_RE = new RegExp\(([\s\S]*?)\n\);/.exec(SW);
  if (!m) throw new Error("ASSET_RE not found in public/sw.js — did it change shape?");
  return new Function("return new RegExp(" + m[1] + ")")();
}

describe("service worker — the cache name is shared with the app", () => {
  // THE drift case. Bumping the worker's cache version is the normal way to
  // invalidate a shell; if the app's copy is not bumped with it, turning
  // "Work offline" off unregisters the worker and strands its cache.
  it("public/sw.js CACHE matches lib/serviceWorker.js SW_CACHE", () => {
    const m = /const CACHE = "([^"]+)"/.exec(SW);
    expect(m, "CACHE not found in public/sw.js").not.toBeNull();
    expect(m[1]).toBe(SW_CACHE);
  });
});

describe("service worker — routing predicate", () => {
  const RE = assetRe();

  // The property that keeps the worker out of the data path. Cross-origin is
  // dropped before this predicate runs, but these are the same-origin paths a
  // Firebase-adjacent request could plausibly take.
  it.each([
    "/",                       // navigations are handled separately, not as assets
    "/src/App.jsx",            // dev module graph
    "/@vite/client",
    "/some/other/thing.json",
    "/iconography.svg",        // the over-matching case the anchoring fixed
    "/icon-legend.json",
  ])("does NOT cache-first %s", (path) => {
    expect(RE.test(path)).toBe(false);
  });

  it.each([
    "/assets/index-abc123.js",
    "/assets/index-abc123.css",
    "/icon.svg",
    "/icons.svg",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable-512.png",
    "/apple-touch-icon.png",
    "/favicon.svg",
    "/manifest.webmanifest",
    "/favicon.svg?v=17.4.2",           // index.html appends a version buster
    "/manifest.webmanifest?v=17.10.1",
  ])("cache-firsts %s", (path) => {
    expect(RE.test(path)).toBe(true);
  });
});

describe("service worker — the safety properties are still in the file", () => {
  // Each of these is load-bearing and documented in CLAUDE.md's architecture
  // section. They fail SILENTLY if removed: the worker keeps working, and gets
  // less safe. That is this file's entry criterion.
  it("has no skipWaiting CALL (nothing swaps under a shift in progress)", () => {
    // Comments legitimately mention it (the kill switch does call it), so the
    // assertion is on code, not on the word.
    const code = SW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(/skipWaiting\s*\(/.test(code)).toBe(false);
  });

  it("drops cross-origin requests before doing anything else", () => {
    expect(/url\.origin !== self\.location\.origin\) return/.test(SW)).toBe(true);
  });

  it("bounds how long a navigation waits for the network", () => {
    const m = /const NAV_TIMEOUT_MS = (\d+)/.exec(SW);
    expect(m, "navigation has no network timeout").not.toBeNull();
    expect(Number(m[1])).toBeGreaterThan(0);
    // Must stay well under index.html's 10s boot watchdog, or the watchdog
    // accuses a page that is still legitimately loading.
    expect(Number(m[1])).toBeLessThan(10000);
  });

  it("caches writes through waitUntil, never fire-and-forget", () => {
    const puts = SW.match(/\.put\(/g) || [];
    const waits = SW.match(/event\.waitUntil\(/g) || [];
    expect(puts.length).toBeGreaterThan(0);
    expect(waits.length).toBeGreaterThanOrEqual(puts.length);
  });
});
