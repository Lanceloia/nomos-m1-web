import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    watch: { usePolling: true, interval: 1200 },
    proxy: { '/api': { target: process.env.M1_API_URL ?? 'http://127.0.0.1:8791', changeOrigin: true } },
  },
});
