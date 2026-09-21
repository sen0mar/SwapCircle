import { useEffect, useState } from 'react';
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { identitySchema } from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import { useAuth } from './AuthProvider';
import { safeDestination } from './client';

export function SignIn() {
  const { client, session, loading, error: restorationError } = useAuth();
  const [params] = useSearchParams();
  const destination = safeDestination(params.get('next'));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (loading) return <p role="status">Restoring your session…</p>;
  if (session) return <Navigate to={destination} replace />;
  async function signIn() {
    if (!client || pending) return;
    setPending(true);
    setError(null);
    try {
      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('next', destination);
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callback.href },
      });
      if (error) throw error;
    } catch {
      setError('Google sign-in could not start. Please retry.');
      setPending(false);
    }
  }
  return (
    <section
      className="panel route-panel auth-panel"
      aria-labelledby="sign-in-title"
    >
      <h1 id="sign-in-title">Sign in to SwapCircle</h1>
      <p>Use your Google account to continue.</p>
      {(error || restorationError) && (
        <p role="alert">{error || restorationError}</p>
      )}
      {!client && (
        <p role="status">Sign-in is not configured in this environment yet.</p>
      )}
      <Button
        variant="primary"
        disabled={!client || pending}
        onClick={() => void signIn()}
      >
        {pending ? 'Opening Google…' : 'Continue with Google'}
      </Button>
      <Link to="/">Back to Home</Link>
    </section>
  );
}

// StrictMode can mount callback effects twice; a one-use code must be exchanged once.
let exchange: { code: string; promise: Promise<boolean> } | undefined;
export function AuthCallback() {
  const { client } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const code = params.get('code');
  const destination = safeDestination(params.get('next'));
  const providerError = params.has('error');
  useEffect(() => {
    let active = true;
    if (!client || !code || providerError) {
      setFailed(true);
      return;
    }
    if (exchange?.code !== code) {
      exchange = {
        code,
        promise: client.auth
          .exchangeCodeForSession(code)
          .then(({ error }) => !error)
          .catch(() => false),
      };
    }
    void exchange.promise.then((ok) => {
      if (!active) return;
      if (ok) void navigate(destination, { replace: true });
      else {
        setFailed(true);
        void navigate('/auth/callback', { replace: true });
      }
    });
    return () => {
      active = false;
    };
  }, [client, code, destination, providerError, navigate]);
  return (
    <section
      className="panel route-panel auth-panel"
      aria-labelledby="callback-title"
    >
      <h1 id="callback-title">Completing sign-in</h1>
      {failed ? (
        <>
          <p role="alert">
            Sign-in could not be completed. The link may have expired or access
            was cancelled.
          </p>
          <Link to="/sign-in">Try signing in again</Link>
        </>
      ) : (
        <p role="status">Connecting your account…</p>
      )}
    </section>
  );
}
export function AccountPage() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p role="status">Restoring your session…</p>;
  if (!session)
    return (
      <Navigate
        to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`}
        replace
      />
    );
  return <Identity />;
}
function Identity() {
  const { session, request, signOut } = useAuth();
  const [recoveryError, setRecoveryError] = useState(false);
  const identity = useQuery({
    queryKey: ['private', session!.user.id, 'identity'],
    queryFn: ({ signal }) =>
      request('/api/v1/identity', identitySchema, { signal }),
    retry: false,
  });
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
