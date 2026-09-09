// tests/wa-sim-not-in-prod.test.js
//
// ── Why this file exists ─────────────────────────────────────────────────────
// v18.0.0 phase 5b. The WhatsApp simulator writes fake customer messages, drives
// Gemini calls we pay for, and seeds and clears sample bookings. It must be
// unreachable in production, and the release plan asked for four independent
// fail-closed gates. Three of them can be reasoned about in source; this file
// exists for the one that cannot, because it is a claim about what a BUNDLER did.
//
// The claim before this test was: "WA_SANDBOX folds to false in a production
// build, so Rollup strips the simulator." Measured on the phase-5a build, that
// was **half true, in the half nobody had checked**. The WaSimulator COMPONENT
// was stripped — none of its UI strings survived — while `lib/wa-sim.js`,
// `lib/wa-sim-scenarios.js` and `lib/wa-backend.js` all shipped in the entry
// chunk: `fetch("/api/wa-sim-inbound")`, the `[waSim]` logging and the fixture
// phone numbers were in `dist/`, in a build that had no way to run them.
//
// Two causes, and only one was a bundler question. The simulator's modules were
// imported STATICALLY by App.jsx (now dynamic, inside the dead branch), and
// `wa-backend.js` was imported by BOTH `useWhatsApp.js` — a production hook, in
// the entry — and the simulator. Under Rolldown a module with two audiences
// lands in the entry and keeps what the lazy chunks need, so tree-shaking was
// never going to remove it: the file genuinely had two audiences. It is split
// now (`wa-backend-sim.js`), and the rule that split encodes is the one worth
// keeping: **a module the simulator imports must not also be imported by
// production code.**
//
// ── What this checks, exactly ────────────────────────────────────────────────
// The ENTRY chunk — the JavaScript every production client downloads and
// executes on boot. NOT all of `dist/`: the simulator's own lazy chunks are
// still EMITTED (Rolldown emits a chunk for a dynamic `import()` even inside a
// branch it folded to dead code), and asserting they are absent would be
// asserting something the bundler does not promise. They are unreachable rather
// than absent — nothing in the entry can call the `import()` that names them,
// `WA_SANDBOX` is gone from the output entirely, and the endpoints they would
// talk to return 404 without `WA_SIM_ENABLED`. Saying so is the point: a guard
// that claims more than it checks is worse than one that states its limit.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist/assets");
const read = (p) => stripComments(readFileSync(join(ROOT, p), "utf8")).join("\n");

// Strings that exist ONLY in simulator code. Each is load-bearing: a marker that
// also appears in production code would pass forever without checking anything.
// **String literals and exported names only.** The first version of this list
// carried `__waSim`, `postFakeWebhook` and a WaSimulator UI string, and the
// "markers are real" guard at the foot of this file rejected all three: the
// minifier renames local identifiers, so an identifier marker asserts an absence
// that is guaranteed for the wrong reason and would keep passing after the
// simulator was linked straight into the entry. Everything here was verified
// present in `dist/` before being trusted to prove an absence.
const SIM_MARKERS = [
  "[waSim]",                 // wa-sim.js' console prefix
  "/api/wa-sim-inbound",     // wa-backend-sim's three endpoints, as written
  "/api/wa-sim-suggest",
  "/api/wa-sim-generate",
  "+34600123456",            // a wa-sim-scenarios fixture number
  "simulateInbound",         // an EXPORT name — preserved for inter-chunk linking
];

describe("the WhatsApp simulator cannot reach production", () => {
  // ── Gate 3: the server, and the only gate `api/` can have ──────────────────
  // Vercel deploys the directory wholesale, so there is no build-time way to
  // keep these handlers out of a production deployment. The runtime check being
  // the ONLY mechanism is why it must be first and fail-closed.
  ["generate", "inbound", "suggest"].forEach((name) => {
    it(`api/wa-sim-${name}.js refuses before it does anything else`, () => {
      const src = read(`api/wa-sim-${name}.js`);
      const body = src.slice(src.indexOf("export default async function handler"));
      const gate = body.indexOf("if (!simEnabled())");
      expect(gate, "the WA_SIM_ENABLED gate is missing from this handler").toBeGreaterThan(-1);
      // FIRST, not merely present: after the method check a GET would answer 405
      // and confirm the endpoint exists; after auth a 401 would do the same. The
      // gate's answer has to be indistinguishable from "no such endpoint".
      expect(
        gate,
        "the gate is not the first statement — something above it can answer, "
          + "and any answer other than 404 tells a prober the handler is there"
      ).toBeLessThan(body.indexOf('req.method !== "POST"'));
      expect(body.slice(gate, gate + 120)).toContain("404");
    });
  });

  it("simEnabled is fail-closed: absent, empty and any non-\"1\" value are OFF", () => {
    const src = read("api/_lib/env.js");
    // env(name, "") returns the fallback for undefined AND for "", so an absent
    // or blank variable can never equal "1".
    expect(src).toMatch(/export function simEnabled\(\)\s*\{\s*return env\("WA_SIM_ENABLED",\s*""\)\s*===\s*"1";\s*\}/);
  });

  // ── The rule the wa-backend split encodes ──────────────────────────────────
  it("no production module imports the simulator's half of the backend client", () => {
    const offenders = [];
    (function walk(dir) {
      for (const n of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, n.name);
        if (n.isDirectory()) { walk(p); continue; }
        if (!/\.(js|jsx)$/.test(n.name)) continue;
        const rel = p.slice(join(ROOT, "src").length + 1);
        // The three files that ARE the simulator may import it; nothing else may.
        if (/^(components\/whatsapp\/WaSimulator\.jsx|lib\/wa-sim\.js|lib\/wa-sim-scenarios\.js)$/.test(rel)) continue;
        if (stripComments(readFileSync(p, "utf8")).join("\n").includes("wa-backend-sim")) offenders.push(rel);
      }
    })(join(ROOT, "src"));
    expect(
      offenders,
      "these import wa-backend-sim. If one of them is loaded eagerly, its /api/wa-sim-* "
        + "calls ship in the production entry chunk — which is exactly the defect the "
        + "split fixed, and tree-shaking will not save you: a module with a production "
        + "audience lands in the entry with the exports its lazy consumers need."
    ).toEqual([]);
  });

  it("App reaches the simulator only through a dynamic import", () => {
    const app = read("src/App.jsx");
    expect(app, "a STATIC import puts the simulator in the entry chunk whatever WA_SANDBOX says")
      .not.toMatch(/^import .*from "\.\/lib\/wa-sim(-scenarios)?";$/m);
    expect(app).not.toMatch(/^import \{ WaSimulator \}/m);
    expect(app).toContain('import("./lib/wa-sim")');
    expect(app).toContain('import("./lib/wa-sim-scenarios")');
    expect(app).toContain('import("./components/whatsapp/WaSimulator")');
  });

  // ── Gate 2: the measurement, on the real artifact ──────────────────────────
  // Skipped without a build, and VISIBLY so (the csp.test.js convention): the
  // assertion most worth having is the one `npm test` alone cannot run.
  const entry = existsSync(DIST)
    ? readdirSync(DIST).find((f) => /^index-.*\.js$/.test(f))
    : null;

  it.runIf(entry)("the built ENTRY chunk contains no simulator code", () => {
    let js = readFileSync(join(DIST, entry), "utf8");
    // Vite's preload manifest is a list of chunk FILENAMES, not code. It names
    // every lazy chunk including the simulator's, which is not a leak — dropping
    // it here is what keeps the markers below meaningful rather than drowned.
    js = js.replace(/\[\s*"assets\/[^\]]*\]/g, "");
    const found = SIM_MARKERS.filter((m) => js.includes(m));
    expect(
      found,
      "simulator code is in the entry chunk — the bundle every production client "
        + "downloads and runs. Check whether a module the simulator uses has "
        + "gained a production importer, and re-read this file's header."
    ).toEqual([]);
    // WA_SANDBOX itself must fold away. If the identifier survives, the constant
    // was not statically replaced and every gate resting on it is a runtime
    // question rather than a settled one.
    expect(js).not.toContain("WA_SANDBOX");
    expect(js).not.toContain("VITE_FB_TARGET");
    // `__waSim` is checked separately from SIM_MARKERS and cannot join that list,
    // because it appears NOWHERE in dist/ — which is the strongest result here
    // and the reason it needs its own assertion. It is written only inside App's
    // `if(!WA_SANDBOX) return;` effect, so its absence everywhere is direct
    // evidence that the whole dead branch was eliminated rather than merely
    // moved. A marker that exists nowhere would fail the "markers are real"
    // guard below, correctly: as a member of that list it would prove nothing.
    expect(
      readdirSync(DIST).filter((f) => f.endsWith(".js"))
        .filter((f) => readFileSync(join(DIST, f), "utf8").includes("__waSim")),
      "the __waSim console helpers survived the build — App's WA_SANDBOX branch "
        + "is no longer being eliminated"
    ).toEqual([]);
  });

  it.runIf(entry)("…and the markers are real — they DO appear in the simulator's own chunks", () => {
    // The guard against the guard. Every assertion above is an absence, and an
    // absence passes just as well when the marker has been renamed out of
    // existence. This fails if the simulator stopped being built at all.
    const all = readdirSync(DIST)
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(DIST, f), "utf8"))
      .join("\n");
    const missing = SIM_MARKERS.filter((m) => !all.includes(m));
    expect(
      missing,
      "these markers appear nowhere in dist/, so the assertions above are checking "
        + "for strings that no longer exist. Re-derive them from the simulator source."
    ).toEqual([]);
  });
});
