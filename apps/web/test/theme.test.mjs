import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

after(() => server.close());

const {
  initializeTheme,
  applyTheme,
  saveTheme,
  isThemePreference,
  watchSystemTheme,
} = await server.ssrLoadModule('/src/theme/theme.ts');

function environment(saved, systemDark, blocked = false) {
  const root = {
    classList: {
      toggle(name, enabled) {
        this[name] = enabled;
      },
    },
    style: {},
    dataset: {},
  };

  const writes = [];

  return {
    root,
    writes,
    document: { documentElement: root },
    matchMedia: () => ({ matches: systemDark }),
    localStorage: {
      getItem(key) {
        assert.equal(key, 'swapcircle-theme');

        if (blocked) throw new Error('blocked');

        return saved;
      },
      setItem(...args) {
        if (blocked) throw new Error('blocked');

        writes.push(args);
      },
    },
  };
}

for (const [saved, systemDark, dark, preference] of [
  [null, true, true, 'system'],
  [null, false, false, 'system'],
  ['light', true, false, 'light'],
  ['dark', false, true, 'dark'],
  ['system', true, true, 'system'],
  ['system', false, false, 'system'],
  ['unexpected', true, true, 'system'],
]) {
  test(`prepaint resolves ${saved} with system dark=${systemDark}`, () => {
    const env = environment(saved, systemDark);

    runInNewContext(`(${initializeTheme.toString()})()`, env);
    assert.equal(env.root.classList.dark, dark);
    assert.equal(env.root.style.colorScheme, dark ? 'dark' : 'light');
    assert.equal(env.root.dataset.themePreference, preference);
    assert.deepEqual(env.writes, []);
  });
}

test('blocked storage still resolves system without throwing', () => {
  const env = environment(null, true, true);

  runInNewContext(`(${initializeTheme.toString()})()`, env);
  assert.equal(env.root.classList.dark, true);

  assert.doesNotThrow(() =>
    runInNewContext(
      `const storageKey = 'swapcircle-theme'; (${saveTheme.toString()})('light')`,
      env,
    ),
  );
});

test('runtime system changes update appearance; explicit choice ignores system', () => {
  const env = environment(null, false);

  for (const [preference, systemDark, expected] of [
    ['system', true, true],
    ['system', false, false],
    ['light', true, false],
    ['dark', false, true],
  ]) {
    runInNewContext(
      `(${applyTheme.toString()})('${preference}', ${systemDark})`,
      env,
    );

    assert.equal(env.root.classList.dark, expected);
  }
});

test('only valid theme preferences are accepted and only the preference is saved', () => {
  assert.equal(isThemePreference('sepia'), false);
  assert.equal(isThemePreference(null), false);

  for (const choice of ['light', 'dark', 'system']) {
    assert.equal(isThemePreference(choice), true);

    const env = environment(null, false);

    runInNewContext(
      `const storageKey = 'swapcircle-theme'; (${saveTheme.toString()})('${choice}')`,
      env,
    );

    assert.deepEqual(env.writes, [['swapcircle-theme', choice]]);
  }
});

test('Vite places the executable bootstrap before application assets', async () => {
  const html = await server.transformIndexHtml(
    '/',
    '<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>',
  );

  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

  assert.ok(script);
  assert.ok(html.indexOf(script) < html.indexOf('/src/main.tsx'));

  const env = environment('dark', false);

  runInNewContext(script, env);
  assert.equal(env.root.classList.dark, true);
});

test('system subscription follows live changes and removes its listener', () => {
  const env = environment(null, false);
  let listener;

  const media = {
    matches: false,
    addEventListener(name, callback) {
      assert.equal(name, 'change');
      listener = callback;
    },
    removeEventListener(name, callback) {
      assert.equal(name, 'change');
      assert.equal(callback, listener);
      listener = undefined;
    },
  };

  const stop = runInNewContext(
    `const applyTheme = ${applyTheme.toString()}; (${watchSystemTheme.toString()})('system', media)`,
    { ...env, media },
  );

  assert.equal(env.root.classList.dark, false);
  media.matches = true;
  listener();
  assert.equal(env.root.classList.dark, true);
  media.matches = false;
  listener();
  assert.equal(env.root.classList.dark, false);
  stop();
  assert.equal(listener, undefined);
});
