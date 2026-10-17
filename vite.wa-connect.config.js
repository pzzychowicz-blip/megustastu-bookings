// vite.wa-connect.config.js — the /wa-connect page's build (v18.9.0), the
// second half of `npm run build`. Why it is a build of its own and not a
// second input of vite.config.js is written at `waConnectPage()` there:
// measured, a shared build moved the app's own modules into shared chunks.
//
// Three settings carry the weight:
//   · `outDir: "dist"` with `emptyOutDir: false`, so it writes beside the app
//     instead of deleting it (it runs second);
//   · `publicDir: false`, or `public/` would be copied again over the files the
//     app's build GENERATED there (the tenant's manifest and privacy notice);
//   · `react()` and nothing else: the simulator stub and the tenant files are
//     the app's, and this page imports none of them.
// The env (VITE_FB_TARGET, VITE_TENANT) reaches src/firebase.js the same way
// in both builds, so the page signs in to the same Firebase project as the
// app it sits beside.
import { join } from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: { "wa-connect": join(process.cwd(), "wa-connect.html") },
    },
  },
});
