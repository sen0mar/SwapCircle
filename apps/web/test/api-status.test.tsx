import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import ApiStatus from '../src/features/development/ApiStatus';

const endpoint = 'http://127.0.0.1:3001/api/v1/live';

function renderStatus() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <ApiStatus />
    </QueryClientProvider>,
  );
}

test('pending request disables checking, network failure offers retry, and retry recovers', async () => {
  let release!: () => void;

  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  let calls = 0;

  server.use(
    http.get(endpoint, async () => {
      calls++;
      await pending;

      return HttpResponse.error();
    }),
  );

  renderStatus();
  expect(screen.getByRole('status')).toHaveTextContent('Connecting to the API');

  expect(
    screen.getByRole('button', { name: 'Check connection' }),
  ).toBeDisabled();

  release();

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not be reached',
  );

  expect(calls).toBe(1);
  server.use(http.get(endpoint, () => HttpResponse.json({ status: 'ok' })));

  await userEvent.click(
    screen.getByRole('button', { name: 'Retry connection' }),
  );

  expect(await screen.findByRole('status')).toHaveTextContent(
    'API is reachable.',
  );

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  expect(
    screen.getByRole('button', { name: 'Check connection' }),
  ).toBeEnabled();
});

test('safe server errors display their request reference', async () => {
  const requestId = 'c7f4f6b5-676e-4342-9a22-016e4ed0e438';

  server.use(
    http.get(endpoint, () =>
      HttpResponse.json(
        {
          error: {
            code: 'UNAVAILABLE',
            message: 'Please retry.',
            requestId,
          },
        },
        { status: 503 },
      ),
    ),
  );

  renderStatus();

  expect(await screen.findByRole('alert')).toHaveTextContent(
    `Please retry.Request reference: ${requestId}`,
  );
});

test('invalid success data never claims the API is reachable', async () => {
  server.use(
    http.get(endpoint, () => HttpResponse.json({ status: 'invented' })),
  );

  renderStatus();

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'unexpected response',
  );

  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
