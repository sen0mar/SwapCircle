import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { passwordSignInSchema } from '@swapcircle/contracts';
import { AuthProvider } from '../src/features/auth/AuthProvider';
import { SignInPage } from '../src/features/auth/SignInPage';

function renderSignIn(signInWithPassword = vi.fn(), configured = true) {
  const client = {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword,
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
    },
    removeAllChannels: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider
        client={configured ? (client as unknown as SupabaseClient) : null}
      >
        <MemoryRouter initialEntries={['/sign-in?next=/browse?q=books']}>
          <SignInPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

test('login schema trims only email and accepts existing short or whitespace passwords', () => {
  expect(
    passwordSignInSchema.parse({
      email: ' demo@example.invalid ',
      password: ' p ',
    }),
  ).toEqual({ email: 'demo@example.invalid', password: ' p ' });
  expect(
    passwordSignInSchema.safeParse({ email: 'invalid', password: '' }).success,
  ).toBe(false);
});

for (const failure of ['credentials', 'rate-limit', 'network']) {
  test(`password ${failure} failure is generic, clears password and permits retry or Google`, async () => {
    const signIn = vi.fn().mockImplementation(async () => {
      if (failure === 'network') throw new Error('private-network-detail');
      return {
        error: {
          message: 'private-provider-detail',
          status: failure === 'rate-limit' ? 429 : 400,
        },
      };
    });
    const client = renderSignIn(signIn);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Sign in with email' });
    await user.type(screen.getByLabelText('Email'), 'demo@example.invalid');
    await user.type(screen.getByLabelText('Password'), ' p ');
    await user.click(
      screen.getByRole('button', { name: 'Sign in with email' }),
    );
    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
      'Sign-in failed. Check your email and password or try again later.',
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Password')).toHaveValue(''),
    );
    expect(screen.getByLabelText('Email')).toHaveValue('demo@example.invalid');
    expect(signIn).toHaveBeenCalledWith({
      email: 'demo@example.invalid',
      password: ' p ',
    });
    await user.click(
      screen.getByRole('button', { name: 'Continue with Google' }),
    );
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo:
          'http://localhost:3000/auth/callback?next=%2Fbrowse%3Fq%3Dbooks',
      },
    });
  });
}

test('missing auth configuration disables both sign-in methods', () => {
  renderSignIn(vi.fn(), false);
  expect(
    screen.getByRole('button', { name: 'Sign in with email' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Continue with Google' }),
  ).toBeDisabled();
});
