import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : '50%',
  reporter: 'list',
  testMatch: '*.browser.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm dev --port 4173 --strictPort',
      env: {
        VITE_API_URL: 'http://127.0.0.1:4311',
        VITE_SUPABASE_URL: 'http://127.0.0.1:55439',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key',
      },
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
