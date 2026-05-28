import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

// SharedArrayBuffer (the streaming engine's audio ring) requires the page
// to be cross-origin-isolated. COOP same-origin + COEP require-corp is the
// standard recipe — same headers needed for the production deploy.
const coopCoepHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// On GitHub Pages the site is served from /<repo>/, so assets need that prefix.
// Locally and on previews we want '/'.
const base = process.env.GITHUB_ACTIONS ? '/paulstretch-for-web/' : '/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@olilarkin/paulstretch-wasm'],
  },
  server: {
    headers: coopCoepHeaders,
  },
  preview: {
    headers: coopCoepHeaders,
  },
});
