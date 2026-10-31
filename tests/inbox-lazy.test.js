// tests/inbox-lazy.test.js
//
// v18.8.0 phase 9. The WhatsApp inbox and the photo viewer are lazy chunks: a
// restaurant downloads them when somebody opens them, and one with the module
// switched off never does. As static imports in App they were in the startup
// bundle for every restaurant, and phase 8 took that bundle to 502.53 kB, past
// Vite's 500 kB warning. Lazy, the entry is 418.87 kB.
//
// A lazy split is undone by ONE static import anywhere, with no error and no
// warning (the v18.0.0 Admin panel: App imported it statically while Settings
// imported it lazily, and the static one won). So this file checks the source
// for the imports and the BUILD for the result: what the startup bundle holds.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { appCode } from "./app-source.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

// String literals that exist only in the lazy screens (a minifier keeps string
// literals and renames identifiers, so only these can prove an absence).
const MARKERS = {
  "src/components/whatsapp/DraftCard.jsx": ["Accept at another time", "Draft booking — parsed from message"],
  "src/components/whatsapp/ReplyComposer.jsx": ["Reply message"],
  "src/components/whatsapp/PhotoViewer.jsx": ["Save photo"],
};
const ALL_MARKERS = Object.values(MARKERS).flat();

// The chunks a browser loads before the app can paint: the entry, and every
// chunk it imports STATICALLY, transitively. A dynamic `import()` is not
// followed, which is the whole difference this file is about.
function startupChunks() {
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const entry = html.match(/<script type="module"[^>]*src="\/assets\/([^"]+)"/)[1];
  const seen = new Set();
  (function walk(f) {
    if (seen.has(f)) return;
    seen.add(f);
    const code = readFileSync(join(DIST, "assets", f), "utf8");
    for (const m of code.matchAll(/(?:^|[;}\n])\s*import\s*(?:[^"'()]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) walk(m[1]);
  })(entry);
  return [...seen];
}

describe("the WhatsApp inbox loads only when it is opened", () => {
  it("App reaches the inbox and the photo viewer through lazyChunk, never a static import", () => {
    const app = appCode();
    expect(app).not.toMatch(/^import \{ InboxPanel \}/m);
    expect(app).not.toMatch(/^import \{ PhotoViewer \}/m);
    expect(app).toMatch(/const InboxPanel = lazyChunk\(function\(\)\{return import\("\.\/components\/whatsapp\/InboxPanel"\)\.then\(function\(m\)\{return \{default:m\.InboxPanel\};\}\);\}/);
    expect(app).toMatch(/const PhotoViewer = lazyChunk\(function\(\)\{return import\("\.\/components\/whatsapp\/PhotoViewer"\)\.then\(function\(m\)\{return \{default:m\.PhotoViewer\};\}\);\}/);
    // Each mounts inside a Suspense, or the first open throws to the boundary.
    expect(app).toContain("<Suspense fallback={null}><InboxPanel");
    expect(app).toContain("<Suspense fallback={null}><PhotoViewer");
  });

  it("nothing outside the inbox imports one of its components statically", () => {
    const offenders = [];
    (function walk(dir) {
      for (const n of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, n.name);
        if (n.isDirectory()) { walk(p); continue; }
        if (!/\.(js|jsx)$/.test(n.name)) continue;
        const rel = p.slice(SRC.length + 1);
        if (rel.startsWith("components/whatsapp/")) continue;
        const src = stripComments(readFileSync(p, "utf8")).join("\n");
        if (/^import [^;]*from "[./]*(components\/)?whatsapp\/[A-Za-z]+"/m.test(src)) offenders.push(rel);
      }
    })(SRC);
    expect(offenders, "a static import of an inbox component puts the whole inbox back in the startup bundle").toEqual([]);
  });

  it("the markers are real: each is a string in its component's source", () => {
    for (const [file, list] of Object.entries(MARKERS)) {
      const src = readFileSync(join(ROOT, file), "utf8");
      list.forEach((m) => expect(src.includes(m), m + " is not in " + file).toBe(true));
    }
  });

  const built = existsSync(join(DIST, "index.html"));
  it.runIf(built)("the startup bundle holds none of the inbox's strings, and a lazy chunk holds them all", () => {
    const startup = startupChunks();
    const inStartup = ALL_MARKERS.filter((m) => startup.some((f) => readFileSync(join(DIST, "assets", f), "utf8").includes(m)));
    expect(inStartup, "these inbox strings are in the startup bundle (" + startup.join(", ") + ")").toEqual([]);
    // The guard against the guard: present in the build at all, so the absence
    // above is the split and not a renamed string.
    const all = readdirSync(join(DIST, "assets")).filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(DIST, "assets", f), "utf8")).join("\n");
    expect(ALL_MARKERS.filter((m) => !all.includes(m))).toEqual([]);
  });
});
