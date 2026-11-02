import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.FXSIM_PORT ?? 8787);

export default defineConfig(({ mode }) => ({
  root: 'client',
  base: mode === 'standalone' ? './' : '/',
  plugins: [react()],
  build: { outDir: mode === 'standalone' ? '../dist-mobile' : '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`,
      '/ws': { target: `ws://127.0.0.1:${API_PORT}`, ws: true },
    },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
}) as any);
