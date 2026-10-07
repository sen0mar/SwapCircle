// Loopback-only password form integration; disposable Auth users, no demo data.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers';
import { execFileSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../../api/dist/app.js';
import { createTokenVerifier } from '../../api/dist/auth/verify.js';

const fetch = globalThis.fetch;

const status = JSON.parse(
  execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
);
assert.equal(status.API_URL, 'http://127.0.0.1:55431');
const origin = 'http://127.0.0.1:4218';
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const app = createApp({
  allowedOrigins: [origin],
  verifyToken: createTokenVerifier(status.API_URL, status.ANON_KEY),
});
const server = app.listen(4338, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const ids = [];
let browser;
let preview;
try {
  execFileSync('pnpm', ['build'], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VITE_API_URL: 'http://127.0.0.1:4338',
      VITE_SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    },
  });
  preview = spawn(
    'pnpm',
    [
      'exec',
      'vite',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4218',
      '--strictPort',
    ],
    { cwd: new URL('..', import.meta.url), stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await fetch(origin)
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const page = await browser.newPage();
  for (let index = 0; index < 2; index++) {
    const email = `password-browser-${randomUUID()}@example.invalid`;
    const password = `Local-${randomUUID()}!`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert.equal(created.error, null, 'Synthetic user creation failed');
    ids.push(created.data.user.id);
    await page.goto(`${origin}/sign-in?next=https://evil.invalid`);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page
      .getByLabel('Password', { exact: true })
      .fill(`wrong-${randomUUID()}`);
    await page.getByRole('button', { name: 'Sign in with email' }).click();
    await expect(page.getByRole('alert')).toContainText('Sign-in failed.');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in with email' }).click();
    await expect(page).toHaveURL(`${origin}/account`);
    await expect(
      page.getByText('Your session is verified.', { exact: false }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('Your session is verified.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Open account' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Open account' }),
    ).toHaveCount(0);
  }
  console.info(
    'Real local password form: rejection, two accounts, safe redirect, verified Express identity, reload and logout passed.',
  );
} finally {
  await browser?.close();
  preview?.kill();
  await new Promise((resolve) => server.close(resolve));
  for (const id of ids)
    assert.equal(
      (await admin.auth.admin.deleteUser(id)).error,
      null,
      'Synthetic user cleanup failed',
    );
}
