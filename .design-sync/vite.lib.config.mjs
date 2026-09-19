// ── Library build for the Claude Design sync (/design-sync) ───────────────────
// The app has no library build — its dist/ is the app — and the sync's
// converter reads a compiled ES module. This config compiles .design-sync/entry.js
// with the app's OWN toolchain (Vite + @vitejs/plugin-react), so the components
// the design agent renders are compiled exactly as the app compiles them.
// vite.config.js is untouched: `--config` means Vite never reads it here.
//
//   npx vite build --config .design-sync/vite.lib.config.mjs
//
// Run from the repo root. Paths are built from process.cwd() rather than
// relative to this file: Vite bundles a config into node_modules/.vite-temp/
// before running it (see the vite.config.js gotcha in CLAUDE.md).
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = process.cwd();

export default defineConfig({
  root,
  // public/ holds the service worker and icons — nothing a library wants.
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: resolve(root, ".design-sync/.lib"),
    emptyOutDir: true,
    copyPublicDir: false,
    // Readable output: the converter re-bundles it, and a stack trace in a
    // preview should name the app's own functions.
    minify: false,
    sourcemap: false,
    lib: {
      entry: resolve(root, ".design-sync/entry.js"),
      formats: ["es"],
      fileName: () => "index.js",
      // The stylesheet entry.js imports, as .lib/index.css (cssEntry).
      cssFileName: "index",
    },
    rollupOptions: {
      // The converter supplies React from its own vendored copy.
      external: [/^react($|\/)/, /^react-dom($|\/)/],
    },
  },
});
