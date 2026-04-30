/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    // Vitest reuses Vite's transform pipeline, so JSX/TS just works.
    // jsdom gives us a DOM for component tests; no Playwright needed.
    environment: 'jsdom',
    globals: true,
    // Picks up colocated tests (`Foo.test.tsx`) and __tests__ folders.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // Reset DOM + mocks between tests so one test can't pollute another.
    restoreMocks: true,
    clearMocks: true,
  },
});
