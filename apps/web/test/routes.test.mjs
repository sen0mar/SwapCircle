import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

after(() => server.close());

const { App } = await server.ssrLoadModule('/src/App.tsx');

function render(path) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(App),
      ),
    ),
  );
}

test('Home renders and marks only Home as current', () => {
  const html = render('/');

  assert.match(html, /Less stuff\./);
  assert.match(html, /aria-current="page"[^>]*href="\/"/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /href="\/browse"[^>]*>Browse items/);
});

test('Browse renders on a direct URL and marks Browse as current', () => {
  const html = render('/browse');

  assert.match(html, /<h1[^>]*>Browse<\/h1>/);
  assert.match(html, /aria-current="page"[^>]*href="\/browse"/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /Loading items/);
});

test('Unknown paths offer a useful route home without an active nav link', () => {
  const html = render('/missing/nested-page');

  assert.match(html, /Page not found/);
  assert.match(html, /href="\/"[^>]*>Back to Home/);
  assert.doesNotMatch(html, /aria-current="page"/);
});
