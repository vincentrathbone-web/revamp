/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { playwright } from '@vitest/browser-playwright';

// Browser tests run in the installed Microsoft Edge: same Chromium engine as
// Tauri's WebView2 on Windows, and no browser download is needed.
export default defineConfig({
  clearScreen: false,
  server: { port: 5199, strictPort: true },
  build: { target: 'es2022', outDir: 'dist' },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          testTimeout: 30000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { channel: 'msedge' } }),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 1000, height: 700 },
          },
        },
      },
    ],
  },
});
