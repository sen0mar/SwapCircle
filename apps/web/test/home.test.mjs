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

const { ListingCard, InterestChip, MemberPreview, ConversationPreview } =
  await server.ssrLoadModule('/src/features/home/Previews.tsx');

const member = {
  name: '<script>member</script>',
  location: 'Approximate area',
  interests: ['Books'],
};

const listing = {
  title: 'Blue backpack',
  condition: 'Good condition',
  owner: member,
  photo: '/test.jpg',
  photoAlt: 'A blue backpack',
};

const render = (Component, props = {}) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(Component, props)),
  );

test('independent previews render readable plain text without invented detail routes', () => {
  const html = render(ListingCard, { listing });

  for (const text of [
    'Blue backpack',
    'Good condition',
    'Approximate area',
    'A blue backpack',
  ])
    assert.ok(html.includes(text));

  assert.match(html, /&lt;script&gt;member&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<a |<script>/);
  assert.match(render(InterestChip, { children: 'Books' }), />Books</);

  const preview = render(MemberPreview, { member });

  assert.match(preview, /disabled="" aria-describedby=/);
  assert.match(preview, /Messaging is not available yet/);

  assert.match(
    render(ConversationPreview, {
      conversation: { member, preview: '<b>hello</b>' },
    }),
    /&lt;b&gt;hello&lt;\/b&gt;/,
  );
});

test('homepage without data is truthful with implemented navigation only', () => {
  const html = render(HomeContent);

  assert.match(html, /Listings are not available yet/);
  assert.match(html, /Members are not available yet/);
  assert.match(html, /Conversations are not available yet/);

  assert.deepEqual(
    [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]),
    ['/listings/new', '/browse', '/browse'],
  );

  assert.doesNotMatch(
    html,
    /role="dialog"|Demo|Synthetic conversation|Connect|Events|12K/,
  );
});

test('empty and loading collections have explicit states, even with no ready records', () => {
  for (const state of ['empty', 'ready']) {
    const html = render(HomeContent, { state });

    for (const subject of ['listings', 'members', 'conversations'])
      assert.ok(html.includes(`No ${subject} to show yet.`));
  }

  const loading = render(HomeContent, { state: 'loading' });

  assert.equal((loading.match(/role="status"/g) ?? []).length, 3);
  assert.match(loading, /Loading listings/);
});
