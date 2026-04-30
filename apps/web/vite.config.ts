import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Move Vite's dep-pre-bundle cache out of the project tree. The
  // default location (`apps/web/node_modules/.vite/deps`) sits inside
  // a path that contains spaces and dots and is watched by OneDrive +
  // Windows Defender + the TS language service. The combination
  // produces intermittent EPERM errors when Vite renames
  // `deps_temp_*` → `deps`, which leaves the page blank. Putting the
  // cache in the OS tmpdir sidesteps every one of those watchers.
  cacheDir: join(tmpdir(), 'dr-abc-vite'),
  // Read the .env from the repo root, not apps/web/. Workspace packages
  // get spawned with cwd = the package dir, so the default Vite envDir
  // (apps/web/) misses the single .env the architect actually edits at
  // F:/Dr.ABC.../Dr.Abc_V5/.env. Pointing envDir up two levels wires
  // the web's import.meta.env.VITE_* vars to that file.
  envDir: '../..',
  // `pg` is a server-only dependency reached via a dynamic import inside
  // `@dr-abc/agents/library-pgvector` — it's never executed in the
  // browser (the catch handler kicks in immediately and we fall back to
  // BM25). Rollup still tries to statically resolve the import string,
  // so we mark it external to keep the bundler happy.
  build: {
    // 1.5 MB raises the warning floor — the heavy chunks are split out
    // below so this only fires if a true regression sneaks in.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      external: ['pg'],
      output: {
        // Manual chunking keeps the initial bundle under ~1 MB so the
        // landing + login paint fast on cold load. Heavy ML / 3D libs
        // ship in their own chunks that lazy-load on the relevant
        // route (brain map, face mirror, scribe).
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('three') || id.includes('@react-three')) return 'vendor-three';
            if (id.includes('@mediapipe')) return 'vendor-mediapipe';
            if (id.includes('framer-motion')) return 'vendor-framer';
            if (id.includes('pdf-lib')) return 'vendor-pdf';
            if (id.includes('react-i18next') || id.includes('i18next')) return 'vendor-i18n';
            if (id.includes('react-hook-form') || id.includes('zod')) return 'vendor-forms';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    // Fail loud if 5173 is taken — silently jumping to 5174 leaves the
    // architect loading the wrong port and seeing a blank page.
    strictPort: true,
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'],
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
