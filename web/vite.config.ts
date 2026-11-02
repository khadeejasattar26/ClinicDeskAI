import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({ envDir: '..', plugins: [react()], server: { proxy: { '/api': loadEnv(mode, '..', '').VITE_PROXY_TARGET || process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3001' } }, test: { environment: 'jsdom', globals: true, setupFiles: './src/test-setup.ts', coverage: { reporter: ['text', 'lcov'] } } }));
