import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { SignInPage } from './features/auth/SignInPage';
import { AuthCallbackPage } from './features/auth/AuthCallbackPage';
import { RequireAuth } from './features/auth/RequireAuth';
import { AccountPage } from './features/account/AccountPage';
import { Home } from './features/home/Home';
import { BrowsePage } from './features/browse/BrowsePage';
import { NotFoundPage } from './pages/NotFoundPage';

const ApiStatus = import.meta.env.DEV
  ? lazy(() => import('./features/development/ApiStatus'))
  : null;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/account" element={<AccountPage />} />
      </Route>
      {ApiStatus && (
        <Route
          path="/dev/api-status"
          element={
            <Suspense fallback={<p role="status">Loading API status…</p>}>
              <ApiStatus />
            </Suspense>
          }
        />
      )}
      <Route path="/" element={<Home />} />
      <Route path="/browse" element={<BrowsePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
