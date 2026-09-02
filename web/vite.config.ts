import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow importing ../shared from outside the web root.
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:3090',
      '/ws': { target: 'ws://localhost:3090', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
