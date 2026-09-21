import { AccountControl } from '../../features/account/AccountControl';
import { ArrowRightLeft, Bell, Search } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { ThemePicker } from './ThemePicker';

export function Header() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="wordmark" to="/" aria-label="SwapCircle home">
          <ArrowRightLeft aria-hidden="true" className="brand-mark" />
          <span>
            Swap<span className="text-brand-ink">Circle</span>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/browse">Browse</NavLink>
          <span
            className="future-nav"
            aria-disabled="true"
            title="My Swaps is not available yet"
          >
            My Swaps
          </span>
          <span
            className="future-nav"
            aria-disabled="true"
            title="Community is not available yet"
          >
            Community
          </span>
        </nav>
        <button
          className="search-entry"
          disabled
          aria-label="Search — not available yet"
        >
          <Search size={18} aria-hidden="true" />
          <span>Search coming soon</span>
        </button>
        <div className="header-controls">
          <button
            className="icon-button"
            disabled
            aria-label="Notifications — not available yet"
            title="Notifications are not available yet"
          >
            <Bell size={20} aria-hidden="true" />
          </button>
          <AccountControl />
          <ThemePicker />
        </div>
      </div>
    </header>
  );
}
