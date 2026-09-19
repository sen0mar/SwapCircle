import { ArrowRight, Plus } from 'lucide-react';
import { Link, Route, Routes } from 'react-router-dom';
import { Header } from './components/layout/Header';

function Home() {
  return (
    <div className="page-grid">
      <section className="hero" aria-labelledby="home-title">
        <p className="eyebrow">Give things a new beginning</p>
        <h1 id="home-title">
          Less stuff.
          <br />
          <span className="text-brand-ink">More connection.</span>
        </h1>
        <p className="hero-description">
          SwapCircle helps you give, get and meet — for a more meaningful, less
          wasteful world.
        </p>
        <div className="hero-actions">
          <button
            className="action"
            disabled
            aria-describedby="listing-unavailable"
          >
            <Plus size={20} aria-hidden="true" />
            List an item
          </button>
          <Link className="action action-primary" to="/browse">
            Browse items
            <ArrowRight size={20} aria-hidden="true" />
          </Link>
        </div>
        <p id="listing-unavailable" className="availability-note">
          Listing items will be available when sign-in is ready.
        </p>
      </section>
      <aside className="right-rail" aria-label="Community and conversations">
        <section className="panel">
          <h2>A little more community</h2>
          <p>Shared interests can be the start of a connection.</p>
          <p className="availability-note">
            Member discovery is not available yet.
          </p>
        </section>
        <section className="panel">
          <h2>Conversations</h2>
          <p>Messaging will be available after sign-in is ready.</p>
        </section>
      </aside>
    </div>
  );
}

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
