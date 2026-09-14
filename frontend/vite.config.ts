/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single config for both the dev/build server and Vitest -- one less file
// to keep in sync, the same "don't split what doesn't need splitting"
// instinct backend/vitest.config.ts already follows.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    css: false,
  },
});
