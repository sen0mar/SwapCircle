import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { safeDestination } from '../auth/client';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../../components/ui/button';
import { ThemePicker } from '../../components/layout/ThemePicker';
import { AccountDrawer } from './AccountDrawer';

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
    <AccountDrawer
      description="Manage your SwapCircle session."
      trigger={
        <Button className="account-button" aria-label="Open account">
          <UserRound size={20} aria-hidden="true" />
          <span>Account</span>
        </Button>
      }
    >
      <p>You’re signed in.</p>
      <Link to="/account">Your account</Link>
      <ThemePicker />
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void signOut().catch(() => {
            setError('Sign-out failed. Check your connection and retry.');
            setPending(false);
          });
        }}
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </Button>
    </AccountDrawer>
  );
}
