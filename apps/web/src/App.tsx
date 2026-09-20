import { Link, Route, Routes } from 'react-router-dom';
import { Home } from './features/home/Home';
import { Header } from './components/layout/Header';

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" className="page-container" tabIndex={-1}>
        <Routes>
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
