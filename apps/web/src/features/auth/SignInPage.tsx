import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useAuth } from './AuthProvider';
import { safeDestination } from './safe-destination';
import { useGoogleSignIn } from './useGoogleSignIn';

export function SignInPage() {
  const { session, loading, error: restorationError } = useAuth();
  const [params] = useSearchParams();
  const destination = safeDestination(params.get('next'));
  const { configured, error, pending, signIn } = useGoogleSignIn(destination);

  if (loading) return <p role="status">Restoring your session…</p>;

  if (session) return <Navigate to={destination} replace />;

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
      {!configured && (
        <p role="status">Sign-in is not configured in this environment yet.</p>
      )}
      <Button
        variant="primary"
        disabled={!configured || pending}
        onClick={() => void signIn()}
      >
        {pending ? 'Opening Google…' : 'Continue with Google'}
      </Button>
      <Link to="/">Back to Home</Link>
    </section>
  );
}
