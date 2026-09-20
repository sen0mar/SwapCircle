import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => server.close());
const { Button } = await server.ssrLoadModule('/src/components/ui/button.tsx');
const { Input } = await server.ssrLoadModule('/src/components/ui/input.tsx');
const { FormFeedback } = await server.ssrLoadModule(
  '/src/components/ui/form-feedback.tsx',
);

test('buttons default to non-submitting and preserve disabled semantics', () => {
  const html = renderToStaticMarkup(
    createElement(Button, { disabled: true }, 'Save'),
  );
  assert.match(html, /type="button"/);
  assert.match(html, /disabled=""/);
});

test('input and feedback preserve accessible error associations and plain text', () => {
  const html = renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement('label', { htmlFor: 'title' }, 'Title'),
      createElement(Input, {
        id: 'title',
        'aria-invalid': true,
        'aria-describedby': 'title-error',
      }),
      createElement(
        FormFeedback,
        { id: 'title-error', tone: 'error' },
        '<script>Required</script>',
      ),
    ),
  );
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="title-error"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /id="title-error"/);
  assert.doesNotMatch(html, /<script>/);
});
