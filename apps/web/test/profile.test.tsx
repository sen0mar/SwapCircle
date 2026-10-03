import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { ProfilePage } from '../src/features/account/ProfilePage';

const state = vi.hoisted(() => ({
  pending: true,
  failed: false,
  retry: vi.fn(),
  save: vi.fn(),
}));
const interest = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Gardening',
};
const profile = {
  id: '10000000-0000-4000-8000-000000000002',
  displayName: 'Profile Reader',
  biography: '',
  approximateLocation: '',
  interests: [interest],
  avatarUrl: null,
  avatarCleanupPending: false,
  createdAt: '2026-10-03T00:00:00Z',
  updatedAt: '2026-10-03T00:00:00Z',
};
vi.mock('../src/features/account/useProfile', () => ({
  useCurrentProfile: () => ({
    data: profile,
    isPending: false,
    isError: false,
  }),
  useInterests: () => ({
    data: state.pending || state.failed ? undefined : [interest],
    isPending: state.pending,
    isError: state.failed,
    isSuccess: !state.pending && !state.failed,
    refetch: state.retry,
  }),
  useSaveProfile: () => ({
    mutateAsync: state.save,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

test('pending and failed interests stay distinct from empty, block saving, and retain selected interests and other drafts through retry', async () => {
  state.pending = true;
  state.failed = false;
  state.save.mockResolvedValue({
    ...profile,
    displayName: 'Kept profile draft',
  });
  const queries = new QueryClient();
  const view = () => (
    <QueryClientProvider client={queries}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(view());
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('Display name'));
  await user.type(screen.getByLabelText('Display name'), 'Kept profile draft');
  expect(screen.getByText('Loading interests…')).toHaveAttribute(
    'role',
    'status',
  );
  expect(
    screen.queryByText('No interests are available yet.'),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  state.pending = false;
  state.failed = true;
  rerender(view());
  expect(screen.getByText('Interest choices are unavailable.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Retry interests' }));
  expect(state.retry).toHaveBeenCalledOnce();
  state.failed = false;
  rerender(view());
  expect(screen.getByRole('checkbox', { name: 'Gardening' })).toBeChecked();
  expect(screen.getByLabelText('Display name')).toHaveValue(
    'Kept profile draft',
  );
  await user.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({
      displayName: 'Kept profile draft',
      interestIds: [interest.id],
    }),
  );
});

test('invalid display names give plain recovery guidance associated with the focused field', async () => {
  state.pending = false;
  state.failed = false;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const name = screen.getByLabelText('Display name');
  await user.clear(name);
  await user.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(await screen.findByText('Enter a display name.')).toHaveAttribute(
    'role',
    'alert',
  );
  expect(name).toHaveAttribute('aria-describedby', 'display-name-error');
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(name).toHaveFocus();
});
