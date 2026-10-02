import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { scaleIndex } from './scale-index.ts';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), scaleIndex()],
  // The index of ~5k scales is most of the bundle (~190 kB gzipped).
  build: { chunkSizeWarningLimit: 800 },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
