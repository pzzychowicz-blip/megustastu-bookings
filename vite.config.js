import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

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
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (/[\\/]node_modules[\\/](@firebase|firebase)[\\/]/.test(id)) return 'vendor-firebase';
        },
      },
    },
  },
})
