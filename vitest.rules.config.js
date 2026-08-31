// vitest.rules.config.js — the Firebase Security Rules suite, and ONLY that.
//
// A THIRD environment, beside the two the app already has:
//
//   npm run dev        → DEV Firebase    → manual app testing
//   production build   → PROD Firebase   → never reached from a dev machine
//   npm run test:rules → LOCAL EMULATOR  → the real database.rules.json
//
// This config exists because the rules suite cannot run where the other 21 test
// files run: it needs a Java process listening on 127.0.0.1:9000, and CI has no
// JVM. vite.config.js excludes `tests/rules/**` from the default run for that
// reason; this config includes exactly that directory and nothing else.
//
// No plugins: these tests import no JSX and render nothing. They talk to the
// emulator over the wire and assert on what the rules permit.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/rules/**/*.test.js"],

    // One emulator, one namespace, one rules evaluation at a time. Parallel
    // files would interleave writes into the same database and turn a rules
    // rejection into a race — the failure would be real but the cause would
    // read as flakiness.
    fileParallelism: false,

    // Emulator I/O, not pure logic. A cold first request pays for the jar's
    // rules compilation; the repo's other suites finish in ~1s and these
    // will not.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
