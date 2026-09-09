import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// ── v18.0.0 phase 5b/2: the simulator is not DEPLOYED, not merely unreachable ─
//
// Phase 5b got the simulator out of the ENTRY chunk, which is what stops it
// running. It did not stop it SHIPPING: Rollup emits a chunk for a dynamic
// `import()` even inside a branch it has folded to dead code, so
// `WaSimulator-*.js`, `wa-sim-*.js` and `wa-sim-scenarios-*.js` were still
// written to `dist/` and served from the restaurant's CDN. Inert, and still
// developer tooling on a production deployment (Patryk's call, session 5).
//
// This strips them at the source: in a production build the four simulator
// modules resolve to ONE virtual stub, so the chunks contain no simulator code
// to begin with. It is not an optimisation and not defence in depth — it is the
// difference between "cannot be run" and "is not there".
//
// **The condition mirrors `WA_SANDBOX` exactly** (`src/lib/waSandbox.js`:
// `import.meta.env.VITE_FB_TARGET === "dev" || import.meta.env.DEV`), because
// two conditions that merely agree today are two conditions:
//   · `serve` (the dev server)        → keep. WA_SANDBOX is true there.
//   · `build` with VITE_FB_TARGET=dev → keep. That is the sandbox deployment.
//   · `build` otherwise              → STRIP. That is production.
//
// The stub's functions THROW rather than no-op. They are unreachable — the
// caller sits behind the same `WA_SANDBOX` that chose this stub — so the choice
// only decides what happens if that ever stops being true, and a silent no-op
// simulator is the worse of the two failures.
const SIM_MODULES = [
  "src/components/whatsapp/WaSimulator.jsx",
  "src/lib/wa-sim.js",
  "src/lib/wa-sim-scenarios.js",
  "src/lib/wa-backend-sim.js",
];
const SIM_STUB_ID = "\0mgt:wa-sim-stub";
// One stub for all four, so the export lists cannot drift apart per module.
// Every name any importer destructures has to appear here or Rollup's import
// analysis fails the build — which is the right failure: it is a compile-time
// signal that a new simulator export reached production code.
const SIM_STUB = [
  "const gone = (name) => () => {",
  "  throw new Error('[wa-sim] ' + name + ' is not available in this build. The',",
  "    'simulator is stripped from production by vite.config.js; reaching this',",
  "    'means a WhatsApp surface lost its sandbox gate.');",
  "};",
  "export const SCENARIOS_BY_ID = {};",
  "export const SCENARIOS = [];",
  "export const WaSimulator = gone('WaSimulator');",
  "export const simulateInbound = gone('simulateInbound');",
  "export const seedSampleBookings = gone('seedSampleBookings');",
  "export const clearWaSimBookings = gone('clearWaSimBookings');",
  "export const simulateBurst = gone('simulateBurst');",
  "export const backendInbound = gone('backendInbound');",
  "export const postFakeWebhook = gone('postFakeWebhook');",
  "export const postSimInbound = gone('postSimInbound');",
  "export const suggestCustomerReply = gone('suggestCustomerReply');",
  "export const generateScenario = gone('generateScenario');",
].join("\n");

function stripSimulator(isSandbox) {
  return {
    name: "mgt-strip-wa-simulator",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      if (isSandbox) return null;
      if (source === SIM_STUB_ID) return SIM_STUB_ID;
      // Resolve through Vite first so a relative specifier from any importer
      // lands on the same absolute path this list is matched against.
      return this.resolve(source, importer, { skipSelf: true }).then((r) => {
        if (!r) return null;
        const id = r.id.split("?")[0].replace(/\\/g, "/");
        return SIM_MODULES.some((m) => id.endsWith("/" + m)) ? SIM_STUB_ID : null;
      });
    },
    load(id) {
      return id === SIM_STUB_ID ? SIM_STUB : null;
    },
  };
}

// /code-review: hoisted out of the manualChunks callback. A regex literal is
// re-evaluated every time control reaches it, so inline these allocated two
// RegExp objects per module id inspected, on every build.
//
// The alternations are ordered LONGEST-FIRST. `react` before `react-dom` also
// works, but only because the trailing separator fails on the hyphen and the
// engine backtracks — correctness resting on a backtrack that a later edit to
// the terminator would silently remove, taking every `react-*` package with it.
const VENDOR_REACT = /[\\/]node_modules[\\/](react-dom|react|scheduler)[\\/]/;
const VENDOR_FIREBASE = /[\\/]node_modules[\\/](@firebase|firebase)[\\/]/;

// https://vite.dev/config/
export default defineConfig(function ({ command }) {
  // Exactly `WA_SANDBOX`'s two truthy cases; see the note above the plugin.
  const isSandbox = command === "serve" || process.env.VITE_FB_TARGET === "dev";
  return {
  plugins: [react(), stripSimulator(isSandbox)],

  // ── The rules suite runs somewhere else, on purpose ──────────────────────
  // `tests/rules/**` drives a LOCAL Firebase RTDB emulator against the real
  // database.rules.json. The emulator is a Java jar, and CI (.github/workflows/
  // ci.yml) runs `npm test` on ubuntu-latest with no JVM and no emulator — so
  // leaving those files inside vitest's default include would break every PR.
  //
  // They run under their own config instead: `npm run test:rules`, which starts
  // the emulator via `firebase emulators:exec` and shuts it down afterwards.
  // See vitest.rules.config.js and database.rules.README.md.
  //
  // The import above moved from 'vite' to 'vitest/config' (a superset) so that
  // `configDefaults` is available — spelling the default excludes out by hand
  // would silently drop node_modules/dist the day vitest changes them.
  test: {
    exclude: [...configDefaults.exclude, "tests/rules/**"],
  },

  build: {
    rollupOptions: {
      output: {
        // ── v17.15.1: vendor chunking ──────────────────────────────────────
        // React and Firebase are ~60% of the main chunk and do not change
        // between OUR releases — but before this every version bump handed the
        // tablet a fresh 203 kB gz to download, because it was all one file
        // with one content hash.
        //
        // Split out, their hashes stay put across a deploy, so the service
        // worker's cache-first /assets/ branch (public/sw.js) serves them from
        // disk and only the app chunk is re-fetched. This app ships versions
        // often, which is exactly what makes the split worth having.
        //
        // Firebase is one group, not three: app/auth/database share internal
        // @firebase/* utils, and splitting them finer just moves shared code
        // into a fourth chunk without reducing what a release invalidates.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (VENDOR_REACT.test(id)) return 'vendor-react';
          if (VENDOR_FIREBASE.test(id)) return 'vendor-firebase';
        },
      },
    },
  },
  };
})
