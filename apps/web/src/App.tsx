import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { SignIn, AuthCallback, AccountPage } from './features/auth/AuthPages';
import { Home } from './features/home/Home';
import { Header } from './components/layout/Header';

const ApiStatus = import.meta.env.DEV
  ? lazy(() => import('./features/development/ApiStatus'))
  : null;

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" className="page-container" tabIndex={-1}>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/account" element={<AccountPage />} />
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
          <Route
            path="/browse"
            element={
              <section
                className="panel route-panel"
                aria-labelledby="browse-title"
              >
                <h1 id="browse-title">Browse</h1>
                <p>The item catalog is coming soon.</p>
                <Link to="/">Back to Home</Link>
              </section>
            }
          />
          <Route
            path="*"
            element={
              <section
                className="panel route-panel"
                aria-labelledby="not-found-title"
              >
                <h1 id="not-found-title">Page not found</h1>
                <p>This address does not match a SwapCircle page.</p>
                <Link to="/">Back to Home</Link>
              </section>
            }
          />
        </Routes>
      </main>
    </>
  );
}
