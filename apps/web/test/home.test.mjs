import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

after(() => server.close());

const { HomeContent } = await server.ssrLoadModule(
  '/src/features/home/HomeContent.tsx',
);

test('homepage renders live content and navigation without demo sections', () => {
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(HomeContent, {
        listingContent: createElement('p', null, 'Live listings'),
        memberContent: createElement('p', null, 'Live members'),
      }),
    ),
  );

  assert.match(html, /Live listings/);
  assert.match(html, /Live members/);
  assert.match(html, /Less stuff/);
  assert.deepEqual(
    [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]),
    ['/listings/new', '/browse', '/browse'],
  );
  assert.doesNotMatch(
    html,
    /Portfolio demo|Development homepage preview|Sample content|Synthetic|A little more community|Conversations|right-rail|page-grid/,
  );
});
