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

// v18.9.0: vercel.json carries TWO header rules, the app's and the /wa-connect
// page's, so every check here names the rule it reads rather than taking the
// first CSP it meets.
const APP_SOURCE = "/((?!wa-connect).*)";
const CONNECT_SOURCE = "/wa-connect(\\.html)?";
function cspOf(source) {
  const entry = (vercel.headers || []).find((e) => e.source === source);
  const h = entry && (entry.headers || []).find((x) => /content-security-policy/i.test(x.key));
  return h ? h.value : "";
}

function scriptSrc() {
  const m = /script-src ([^;]+)/.exec(cspOf(APP_SOURCE));
  return m ? m[1].trim() : "";
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

// v18.8.0: a WhatsApp photo or voice note reaches the page as a BLOB URL (the
// file needs the staff token, so the page fetches it and hands <img> / <audio>
// the bytes). Without `blob:` the browser refuses both, silently and in
// production only: the dev server sends no CSP. The pins say exactly what was
// widened, so a later edit cannot widen it further by accident.
function directive(name, source = APP_SOURCE) {
  const m = new RegExp("(?:^|;\\s*)" + name + " ([^;]+)").exec(cspOf(source));
  return m ? m[1].trim().split(/\s+/) : null;
}
describe("CSP ↔ WhatsApp media", () => {
  it("lets a photo be drawn from a blob URL, and nothing remote", () => {
    expect(directive("img-src")).toEqual(["'self'", "data:", "blob:"]);
  });
  it("lets a voice note play from a blob URL, and nothing remote", () => {
    expect(directive("media-src")).toEqual(["'self'", "blob:"]);
  });
  it("keeps plugins and remote scripts out, which a document opened from a blob would inherit", () => {
    expect(directive("object-src")).toEqual(["'none'"]);
    expect(directive("script-src").filter((v) => !v.startsWith("'sha256-"))).toEqual(["'self'"]);
  });
});

// ── v18.9.0: the /wa-connect page, the one document Meta's SDK may run in ────
// Embedded Signup needs connect.facebook.net's script, a facebook.com popup
// that talks back, and calls to facebook.com. The app must never allow any of
// that, so the page has a header rule of its own and the app's rule excludes
// it. What is pinned: the two rules cover every path between them and never
// one path twice (two CSPs on one response are BOTH enforced, which would
// block the SDK), the page's policy is the app's plus exactly the three
// additions and minus the boot script's hash (the page has no inline script
// for it to match), and every other security header is the same on both.
describe("CSP ↔ the /wa-connect page", () => {
  // Vercel matches `source` with path-to-regexp; these two patterns use only
  // a lookahead and an optional group, which mean the same in a JS RegExp.
  const matches = (source, path) => new RegExp("^" + source + "$").test(path);

  it("the app's rule covers every path but the page's, and the page's covers only it", () => {
    expect((vercel.headers || []).map((e) => e.source)).toEqual([APP_SOURCE, CONNECT_SOURCE]);
    for (const p of ["/", "/index.html", "/privacy", "/assets/index-x.css", "/api/wa-onboard", "/manifest.webmanifest"]) {
      expect([p, matches(APP_SOURCE, p), matches(CONNECT_SOURCE, p)]).toEqual([p, true, false]);
    }
    for (const p of ["/wa-connect", "/wa-connect.html"]) {
      expect([p, matches(APP_SOURCE, p), matches(CONNECT_SOURCE, p)]).toEqual([p, false, true]);
    }
  });

  it("is the app's policy plus Meta's three additions, without the boot script's hash", () => {
    const parse = (csp) => Object.fromEntries(csp.split(";").map((d) => d.trim()).filter(Boolean)
      .map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
    const app = parse(cspOf(APP_SOURCE));
    const page = parse(cspOf(CONNECT_SOURCE));
    const expected = Object.assign({}, app, {
      "script-src": app["script-src"].filter((v) => !v.startsWith("'sha256-")).concat("https://connect.facebook.net"),
      "connect-src": app["connect-src"].concat("https://*.facebook.com"),
      "frame-src": app["frame-src"].concat("https://*.facebook.com"),
    });
    expect(page).toEqual(expected);
  });

  it("the app's own policy lets none of Meta in", () => {
    expect(cspOf(APP_SOURCE)).not.toMatch(/facebook/);
  });

  it("carries the same other security headers as the app", () => {
    const others = (source) => (vercel.headers.find((e) => e.source === source).headers)
      .filter((h) => !/content-security-policy/i.test(h.key));
    expect(others(CONNECT_SOURCE)).toEqual(others(APP_SOURCE));
  });

  it("has no inline script, which its policy would block", () => {
    const page = readFileSync(join(ROOT, "wa-connect.html"), "utf8");
    expect(inlineScripts(page)).toEqual([]);
    // One script, the module the build replaces with its bundle.
    expect(page.match(/<script\b/g)).toHaveLength(1);
    expect(page).toMatch(/<script type="module" src="[^"]+"><\/script>/);
  });

  it("is served at /wa-connect by a rewrite", () => {
    expect(vercel.rewrites).toContainEqual({ source: "/wa-connect", destination: "/wa-connect.html" });
  });

  it.runIf(existsSync(join(ROOT, "dist/wa-connect.html")))("is built, and the built page has no inline script either", () => {
    expect(inlineScripts(readFileSync(join(ROOT, "dist/wa-connect.html"), "utf8"))).toEqual([]);
  });
});
