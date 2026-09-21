import { Link } from 'react-router-dom';
import { useAuthCallback } from './useAuthCallback';

export function AuthCallbackPage() {
  const { failed } = useAuthCallback();
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
