import { Link } from 'react-router-dom';

export function BrowsePage() {
  return (
    <section className="panel route-panel" aria-labelledby="browse-title">
      <h1 id="browse-title">Browse</h1>
      <p>The item catalog is coming soon.</p>
      <Link to="/">Back to Home</Link>
    </section>
  );
}
