import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from '../src/features/auth/AuthProvider';
import { safeDestination } from '../src/features/auth/safe-destination';
import { identitySchema } from '@swapcircle/contracts';
import { http, HttpResponse } from 'msw';
import { server } from './setup';

function fixture() {
  let callback: (_event: string, session: Session | null) => void = () => {};
  let session: Session | null = null;

  let restore!: (value: {
    data: { session: Session | null };
    error: null;
  }) => void;

  const initial = new Promise<{
    data: { session: Session | null };
    error: null;
  }>((resolve) => {
    restore = resolve;
  });

  const remove = vi.fn().mockResolvedValue([]);
  const unsubscribe = vi.fn();

  const client = {
    auth: {
      onAuthStateChange: vi.fn((fn) => {
        callback = fn;

        return { data: { subscription: { unsubscribe } } };
      }),
      getSession: vi.fn().mockImplementation(() => initial),
      signOut: vi.fn(async () => {
        session = null;
        callback('SIGNED_OUT', null);

        return { error: null };
      }),
    },
    removeAllChannels: remove,
  };

  return {
    client: client as unknown as SupabaseClient,
    remove,
    unsubscribe,
    restore,
    emit(id: string | null) {
      session = id
        ? ({ user: { id }, access_token: `token-${id}` } as Session)
        : null;

      client.auth.getSession.mockImplementation(async () => ({
        data: { session },
        error: null,
      }));

      callback(id ? 'SIGNED_IN' : 'SIGNED_OUT', session);
    },
  };
}

test('safe destinations preserve implemented routes and reject external or auth-loop targets', () => {
  for (const value of [
    'https://evil.invalid',
    '//evil.invalid',
    '/\\evil.invalid',
    '/auth/callback',
    '/sign-in',
    '/unimplemented',
    'javascript:alert(1)',
    '/%2f%2fevil.invalid',
  ])
    expect(safeDestination(value)).toBe('/account');

  expect(safeDestination('/browse?q=books#list')).toBe('/browse?q=books#list');
});

test('restoration cannot overwrite newer account events; transitions cancel requests, clear caches/drafts and unsubscribe', async () => {
  const auth = fixture();

  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  let requestResult: Promise<unknown> | undefined;
  let requestAborted = false;
  let capturedRequest: ReturnType<typeof useAuth>['request'] | undefined;

  server.use(
    http.get('http://127.0.0.1:3001/api/v1/identity', async ({ request }) => {
      expect(request.headers.get('Authorization')).toBe(
        'Bearer token-account-a',
      );

      await new Promise<void>((resolve) =>
        request.signal.addEventListener('abort', () => {
          requestAborted = true;
          resolve();
        }),
      );

      return HttpResponse.json({
        userId: 'a8ded912-c170-4988-8750-9747558e8a87',
      });
    }),
  );

  function Probe() {
    const { session, loading, request } = useAuth();

    capturedRequest = request;

    const [draft, setDraft] = useState('');

    return (
      <>
        <p>{loading ? 'restoring' : (session?.user.id ?? 'signed-out')}</p>
        <input
          aria-label="Draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          onClick={() => {
            requestResult = request('/api/v1/identity', identitySchema).catch(
              () => 'cancelled',
            );
          }}
        >
          Request
        </button>
      </>
    );
  }

  const view = render(
    <QueryClientProvider client={queries}>
      <AuthProvider client={auth.client}>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );

  expect(screen.getByText('restoring')).toBeVisible();
  act(() => auth.emit('account-a'));
  await act(async () => auth.restore({ data: { session: null }, error: null }));
  expect(screen.getByText('account-a')).toBeVisible();
  queries.setQueryData(['private', 'account-a'], 'private data');
  await userEvent.type(screen.getByLabelText('Draft'), 'private draft');
  act(() => auth.emit('account-a'));
  expect(screen.getByLabelText('Draft')).toHaveValue('private draft');
  expect(queries.getQueryData(['private', 'account-a'])).toBe('private data');
  expect(auth.remove).toHaveBeenCalledTimes(1);

  const staleRequest = capturedRequest!;

  await userEvent.click(screen.getByText('Request'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  act(() => auth.emit('account-b'));
  await waitFor(() => expect(requestAborted).toBe(true));
  expect(await requestResult).toBe('cancelled');

  await expect(
    staleRequest('/api/v1/identity', identitySchema),
  ).rejects.toBeDefined();

  expect(queries.getQueryCache().getAll()).toHaveLength(0);
  expect(screen.getByLabelText('Draft')).toHaveValue('');
  expect(screen.getByText('account-b')).toBeVisible();
  expect(auth.remove).toHaveBeenCalledTimes(2);
  act(() => auth.emit(null));
  expect(screen.getByText('signed-out')).toBeVisible();
  expect(auth.remove).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(auth.unsubscribe).toHaveBeenCalledOnce();
});
