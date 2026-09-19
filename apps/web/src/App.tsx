import { Link, NavLink, Route, Routes } from 'react-router-dom';

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header>
        <Link className="wordmark" to="/">
          SwapCircle
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/browse">Browse</NavLink>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route
            path="/"
            element={
              <section aria-labelledby="home-title">
                <h1 id="home-title">Welcome to SwapCircle</h1>
                <p>A place to give, get, and meet.</p>
                <Link to="/browse">Explore Browse</Link>
              </section>
            }
          />
          <Route
            path="/browse"
            element={
              <section aria-labelledby="browse-title">
                <h1 id="browse-title">Browse</h1>
                <p>The item catalog is coming soon.</p>
                <Link to="/">Back to Home</Link>
              </section>
            }
          />
          <Route
            path="*"
            element={
              <section aria-labelledby="not-found-title">
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
