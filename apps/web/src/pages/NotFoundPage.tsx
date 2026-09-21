import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="panel route-panel" aria-labelledby="not-found-title">
      <h1 id="not-found-title">Page not found</h1>
      <p>This address does not match a SwapCircle page.</p>
      <Link to="/">Back to Home</Link>
    </section>
  );
}
