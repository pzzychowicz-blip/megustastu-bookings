import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

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
export default defineConfig({
  plugins: [react()],

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
})
