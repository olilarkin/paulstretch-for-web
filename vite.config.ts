import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['paulstretch-wasm'],
  },
  server: {
    fs: {
      // Allow serving files outside the project root so the local
      // paulstretch-wasm package (file:../libpaulstretch/npm) works.
      allow: ['..'],
    },
  },
});
