import { AppRoutes } from './routes';
import { Header } from './components/layout/Header';

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" className="page-container" tabIndex={-1}>
        <AppRoutes />
      </main>
    </>
  );
}
