import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

const apiUrl = 'http://127.0.0.1:4311';
let api: ChildProcess | undefined;
async function startApi() {
  api = spawn(process.execPath, ['dist/server.js'], {
    cwd: new URL('../../api', import.meta.url),
    env: {
      ...process.env,
      PORT: '4311',
      CORS_ORIGINS: 'http://127.0.0.1:4173',
    },
    stdio: 'pipe',
  });
  await expect
    .poll(async () => {
      try {
        return (await fetch(`${apiUrl}/api/v1/live`)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
}
async function stopApi() {
  if (api && api.exitCode === null && api.signalCode === null) {
    const exited = once(api, 'exit');
    api.kill('SIGTERM');
    await exited;
  }
  api = undefined;
}
test.afterEach(stopApi);

test('allowed origin, malformed errors, stopped API and real restart recovery', async ({
  page,
}) => {
  await startApi();
  await page.goto('/dev/api-status');
  await expect(page.getByRole('status')).toHaveText('API is reachable.');
  const malformed = await page.evaluate(async (base) => {
    const response = await fetch(`${base}/api/v1/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"secret":"do-not-reflect",',
    });
    return {
      status: response.status,
      body: await response.json(),
      id: response.headers.get('x-request-id'),
    };
  }, apiUrl);
  expect(malformed.status).toBe(400);
  expect(malformed.body.error.code).toBe('INVALID_JSON');
  expect(malformed.body.error.requestId).toBe(malformed.id);
  expect(JSON.stringify(malformed.body)).not.toMatch(
    /do-not-reflect|stack|SyntaxError/,
  );
  await stopApi();
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be reached');
  await page.screenshot({ path: 'test-results/api-stopped.png' });
  await startApi();
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('status')).toHaveText('API is reachable.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/api-recovered.png' });
  await page.goto('http://127.0.0.1:4174/dev/api-status');
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  const denied = await page.evaluate(async (base) => {
    try {
      await fetch(`${base}/api/v1/live`);
      return false;
    } catch {
      return true;
    }
  }, apiUrl);
  expect(denied).toBe(true);
});
