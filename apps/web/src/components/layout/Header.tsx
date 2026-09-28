import { AccountControl } from '../../features/account/AccountControl';
import { ArrowRightLeft, Search } from 'lucide-react';
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
        </nav>
        <Link
          className="search-entry"
          to="/browse#catalog-search"
          aria-label="Search items"
        >
          <Search size={18} aria-hidden="true" />
          <span>Search items</span>
        </Link>
        <div className="header-controls">
          <AccountControl />
          <ThemePicker />
        </div>
      </div>
    </header>
  );
}
