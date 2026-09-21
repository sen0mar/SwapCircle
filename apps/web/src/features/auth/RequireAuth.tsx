import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function RequireAuth() {
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
  return <Outlet />;
}
