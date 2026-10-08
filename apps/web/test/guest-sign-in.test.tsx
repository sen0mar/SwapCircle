import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { server } from './setup';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../src/features/auth/AuthProvider';
import GuestSignIn from '../src/features/auth/GuestSignIn';

function setup(setSession = vi.fn().mockResolvedValue({ error: null })) {
  const pending = vi.fn();
  const client = {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      setSession,
    },
    removeAllChannels: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider client={client as unknown as SupabaseClient}>
        <GuestSignIn disabled={false} onPending={pending} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { setSession, pending };
}

test('guest adopts a server-issued session through the SDK and prevents repeat submissions', async () => {
  let finish!: () => void;
  const delay = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let requests = 0;
  server.use(
    http.post('http://127.0.0.1:3001/api/v1/auth/guest', async () => {
      requests++;
      await delay;
      return HttpResponse.json({
        access_token: 'synthetic-access',
        refresh_token: 'synthetic-refresh',
      });
    }),
  );
  const { setSession, pending } = setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Continue as guest' }));
  await waitFor(() => expect(requests).toBe(1));
  expect(screen.getByRole('button', { name: 'Opening demo…' })).toBeDisabled();
  expect(screen.getByText(/shared demo account/)).toBeVisible();
  finish();
  await waitFor(() =>
    expect(setSession).toHaveBeenCalledWith({
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-refresh',
    }),
  );
  await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
  expect(pending).toHaveBeenCalledWith(true);
  expect(requests).toBe(1);
});

test('missing seed and SDK failures are generic and allow retry without storing a password', async () => {
  server.use(
    http.post('http://127.0.0.1:3001/api/v1/auth/guest', () =>
      HttpResponse.json(
        {
          error: {
            code: 'GUEST_UNAVAILABLE',
            message: 'private-provider-detail',
          },
        },
        { status: 503 },
      ),
    ),
  );
  const { setSession } = setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Continue as guest' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again later');
  expect(screen.queryByText('private-provider-detail')).not.toBeInTheDocument();
  expect(setSession).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Continue as guest' }),
  ).toBeEnabled();
});
