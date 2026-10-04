import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { frontendOrigin } from './api-release.mjs';
import { apiOrigin } from './frontend-release.mjs';
import { requireUnavailableItem } from './frontend-smoke.mjs';

const { fetch, AbortSignal, URL } = globalThis;

export function assertReleaseEvidence(frontend, api, revision) {
  assert.match(revision ?? '', /^[a-f0-9]{40}$/);
  assert.equal(frontend.revision, revision, 'Unexpected frontend revision.');
  assert.equal(api.status, 'ready', 'API is not ready.');
  assert.equal(api.revision, revision, 'Unexpected API revision.');
}

async function releaseEvidence(revision) {
  const bodies = await Promise.all(
    [`${frontendOrigin}/release.json`, `${apiOrigin}/api/v1/ready`].map(
      async (url) => {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(60_000),
          redirect: 'error',
        });

        assert.equal(response.status, 200, 'Release evidence unavailable.');

        return response.json();
      },
    ),
  );

  assertReleaseEvidence(bodies[0], bodies[1], revision);
}

// Public, signed-out review only. No hosted credentials, Auth fixtures, domain
// writes, deployment or history cleanup are part of this command. Completing
// this audit does not satisfy the authenticated journeys or launch decisions.
export async function verifyPublicRelease(revision) {
  assert.match(revision ?? '', /^[a-f0-9]{40}$/);
  await releaseEvidence(revision);

  const require = createRequire(
    new URL('../apps/web/package.json', import.meta.url),
  );
  const { chromium, expect } = require('@playwright/test');
  const AxeBuilder = require('@axe-core/playwright').default;
  const directory = new URL(
    '../test-results/release-verification/',
    import.meta.url,
  );

  await mkdir(directory, { recursive: true });

  const browser = await chromium.launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    const violations = [];

    page.on('pageerror', () => errors.push('Page error'));
    await page.addInitScript(() => {
      globalThis.__releaseCspViolations = [];
      globalThis.document.addEventListener('securitypolicyviolation', (event) =>
        globalThis.__releaseCspViolations.push(event.violatedDirective),
      );
    });

    const collect = async () => {
      violations.push(
        ...(await page.evaluate(
          () => globalThis.__releaseCspViolations?.splice(0) ?? [],
        )),
      );
    };
    const visit = async (path) => {
      await collect();
      await page.goto(`${frontendOrigin}${path}`);
    };
    const reload = async () => {
      await collect();
      await page.reload();
    };

    for (const width of [360, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });

      for (const theme of ['light', 'dark']) {
        await visit('/');
        await page
          .getByRole('heading', { name: 'Less stuff. More connection.' })
          .waitFor();
        await page.getByLabel('Theme').selectOption(theme);
        await reload();
        await page
          .getByText('No available items shared yet.', { exact: true })
          .or(page.locator('.listing-card').first())
          .waitFor({ timeout: 60_000 });
        await page
          .getByText('Loading members…', { exact: true })
          .waitFor({ state: 'hidden' });
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        assert.equal(
          await page.locator('html').getAttribute('data-theme-preference'),
          theme,
        );
        assert.ok(
          await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth <=
              globalThis.innerWidth,
          ),
          'Public home overflows the viewport.',
        );

        const accessibility = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();

        assert.equal(
          accessibility.violations.length,
          0,
          'Public home accessibility check failed.',
        );
        await page.screenshot({
          path: new URL(`home-${width}-${theme}.png`, directory).pathname,
          fullPage: true,
        });
        console.info(`Public home ${width}px/${theme} passed.`);
      }
    }

    await visit('/account/profile');
    await page
      .getByRole('heading', { name: 'Sign in to SwapCircle' })
      .waitFor();
    await reload();
    await page
      .getByRole('heading', { name: 'Sign in to SwapCircle' })
      .waitFor();
    assert.equal(
      new URL(page.url()).searchParams.get('next'),
      '/account/profile',
    );
    await visit('/browse?condition=good');
    await reload();
    await page.getByRole('heading', { name: 'Browse', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Condition').inputValue(), 'good');
    await visit('/auth/callback?error=access_denied');
    await reload();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Sign-in could not be completed' })
      .waitFor();
    await visit('/listings/00000000-0000-4000-8000-000000000000');
    await requireUnavailableItem(page);
    await collect();
    assert.deepEqual(errors, [], 'Public review encountered a page error.');
    assert.deepEqual(
      violations,
      [],
      'Public review encountered a CSP violation.',
    );
    await releaseEvidence(revision);
    console.info(
      'Expected deployed revision, public routes, themes and layouts passed. Authenticated exchanges and launch decisions remain separate requirements.',
    );
  } finally {
    await browser.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  verifyPublicRelease(process.env.RELEASE_REVISION).catch(() => {
    // Assertions and browser errors may contain page/provider data. Keep the
    // console categorical; inspect the public screenshots locally for diagnosis.
    console.error('Public release review failed; page/provider data withheld.');
    process.exitCode = 1;
  });
}
