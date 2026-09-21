import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/AuthProvider';
import { useIdentity } from './useIdentity';

export function AccountPage() {
  const { signOut } = useAuth();
  const [recoveryError, setRecoveryError] = useState(false);
  const identity = useIdentity();
  return (
    <section
      className="panel route-panel auth-panel"
      aria-labelledby="account-title"
    >
      <h1 id="account-title">Your account</h1>
      {identity.isPending ? (
        <p role="status">Checking your account…</p>
      ) : identity.isError ? (
        <>
          <p role="alert">
            Your account could not be verified. Your session may have expired or
            the API may be unavailable.
          </p>
          <Button onClick={() => void identity.refetch()}>Retry</Button>
          <Button
            onClick={() => {
              setRecoveryError(false);
              void signOut().catch(() => setRecoveryError(true));
            }}
          >
            Sign out and sign in again
          </Button>
          {recoveryError && (
            <p role="alert">
              Sign-out failed. Check your connection and retry.
            </p>
          )}
        </>
      ) : (
        <p>Your session is verified. You’re signed in to SwapCircle.</p>
      )}
      <Link to="/">Back to Home</Link>
    </section>
  );
}
