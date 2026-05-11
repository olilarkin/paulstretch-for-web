import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SharedArrayBuffer (the streaming engine's audio ring) requires the page
// to be cross-origin-isolated. COOP same-origin + COEP require-corp is the
// standard recipe — same headers needed for the production deploy.
const coopCoepHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['paulstretch-wasm'],
  },
  server: {
    headers: coopCoepHeaders,
    fs: {
      // Allow serving files outside the project root so the local
      // paulstretch-wasm package (file:../libpaulstretch/npm) works.
      allow: ['..'],
    },
  },
  preview: {
    headers: coopCoepHeaders,
  },
});
