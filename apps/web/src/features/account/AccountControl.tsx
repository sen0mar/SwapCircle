import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { safeDestination } from '../auth/safe-destination';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../../components/ui/button';
import { ThemePicker } from '../../components/layout/ThemePicker';
import { AccountDrawer } from './AccountDrawer';
import { useCurrentProfile } from './useProfile';

export function AccountControl() {
  const { session, loading, signOut } = useAuth();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <span role="status">Restoring session…</span>;

  if (!session)
    return (
      <Link
        className="account-button"
        aria-label="Sign in"
        to={`/sign-in?next=${encodeURIComponent(safeDestination(location.pathname + location.search + location.hash))}`}
      >
        <UserRound size={20} aria-hidden="true" />
        <span>Sign in</span>
      </Link>
    );

  return (
    <SignedInControl
      pending={pending}
      error={error}
      onSignOut={() => {
        setPending(true);
        setError(null);
        void signOut().catch(() => {
          setError('Sign-out failed. Check your connection and retry.');
          setPending(false);
        });
      }}
    />
  );
}

function SignedInControl({
  pending,
  error,
  onSignOut,
}: {
  pending: boolean;
  error: string | null;
  onSignOut: () => void;
}) {
  const profile = useCurrentProfile();

  return (
    <AccountDrawer
      description="Manage your SwapCircle profile and settings."
      trigger={
        <Button className="account-button" aria-label="Open account">
          <UserRound size={20} aria-hidden="true" />
          <span>{profile.data?.displayName ?? 'Account'}</span>
        </Button>
      }
    >
      <div className="account-links">
        {profile.isPending && <p role="status">Loading profile…</p>}
        {profile.isError && (
          <p role="alert">
            Profile unavailable.{' '}
            <Button onClick={() => void profile.refetch()}>Retry</Button>
          </p>
        )}
        {profile.data && (
          <p>
            {profile.data.displayName}
            {profile.data.approximateLocation
              ? ` · ${profile.data.approximateLocation}`
              : ''}
          </p>
        )}
        <Link to="/account/profile">Edit profile</Link>
        {profile.data && (
          <Link to={`/members/${profile.data.id}`}>Public profile</Link>
        )}
        <Link to="/account/settings">Account settings</Link>
        <ThemePicker />
        {error && <p role="alert">{error}</p>}
        <Button disabled={pending} onClick={onSignOut}>
          {pending ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </AccountDrawer>
  );
}
