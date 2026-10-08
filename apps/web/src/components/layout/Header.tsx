import { AccountControl } from '../../features/account/AccountControl';
import { ArrowRightLeft } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthProvider';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import { ThemePicker } from './ThemePicker';

export function Header() {
  const { session } = useAuth();
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
          {session && <NavLink to="/swaps">My Swaps</NavLink>}
          {session && <NavLink to="/inbox">Messages</NavLink>}
        </nav>
        <div className="header-controls">
          <NotificationBell />
          <AccountControl />
          <ThemePicker />
        </div>
      </div>
    </header>
  );
}
