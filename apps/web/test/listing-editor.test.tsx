import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { ListingEditorPage } from '../src/features/listings/ListingEditorPage';
import { AuthProvider, useAuth } from '../src/features/auth/AuthProvider';
import { server } from './setup';

function AuthReady() {
  const { session } = useAuth();

  return <p>{session ? 'Signed in' : 'Restoring'}</p>;
}

test('create form validates fields, keeps a failed draft, then navigates after save', async () => {
  const ownerId = 'a8ded912-c170-4988-8750-9747558e8a87';
  const session = {
    user: { id: ownerId },
    access_token: 'synthetic',
  } as Session;
  const client = {
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      getSession: async () => ({ data: { session }, error: null }),
    },
    removeAllChannels: async () => [],
  } as unknown as SupabaseClient;
  const queries = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  let attempts = 0;

  server.use(
    http.post('http://127.0.0.1:3001/api/v1/listings', async ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer synthetic');
      attempts++;

      if (attempts === 1)
        return HttpResponse.json(
          {
            error: {
              code: 'TEMPORARY',
              message: 'Try again.',
              requestId: crypto.randomUUID(),
            },
          },
          { status: 503 },
        );

      const input = (await request.json()) as {
        title: string;
        description: string;
        condition: string;
      };

      return HttpResponse.json(
        {
          ...input,
          id: 'a329028e-1971-4763-b371-1ac4587c640a',
          ownerId,
          availability: 'available',
          revision: 1,
          createdAt: '2026-09-24T08:00:00.000Z',
          updatedAt: '2026-09-24T08:00:00.000Z',
        },
        { status: 201 },
      );
    }),
  );

  render(
    <QueryClientProvider client={queries}>
      <AuthProvider client={client}>
        <AuthReady />
        <MemoryRouter initialEntries={['/listings/new']}>
          <Routes>
            <Route path="/listings/new" element={<ListingEditorPage />} />
            <Route path="/listings/:id/edit" element={<p>Item saved</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );

  const user = userEvent.setup();

  await screen.findByText('Signed in');
  await user.click(screen.getByRole('button', { name: 'Create item' }));
  expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  expect(attempts).toBe(0);

  await user.type(screen.getByLabelText('Title'), 'Canvas bag');
  await user.type(screen.getByLabelText('Description'), 'Strong and clean');
  await user.click(screen.getByLabelText('Fair'));
  await user.click(screen.getByRole('button', { name: 'Create item' }));
  expect(await screen.findByText(/Your draft is still here/)).toBeVisible();
  expect(screen.getByLabelText('Title')).toHaveValue('Canvas bag');
  expect(screen.getByLabelText('Fair')).toBeChecked();

  await user.click(screen.getByRole('button', { name: 'Create item' }));
  expect(await screen.findByText('Item saved')).toBeVisible();
  expect(attempts).toBe(2);
});
