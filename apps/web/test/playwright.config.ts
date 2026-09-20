import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.spec.ts',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium' },
  webServer: [
    {
      command: 'pnpm dev --port 4173 --strictPort',
      env: { VITE_API_URL: 'http://127.0.0.1:4311' },
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      cwd: new URL('..', import.meta.url).pathname,
    },
    {
      command:
        'pnpm exec vite preview --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      cwd: new URL('..', import.meta.url).pathname,
    },
  ],
});
