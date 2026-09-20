import { UserRound } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ThemePicker } from '../../components/layout/ThemePicker';
import { AccountDrawer } from './AccountDrawer';

export default function DevelopmentAccount() {
  return (
    <AccountDrawer
      description="Development-only profile fixture. No account is signed in."
      trigger={
        <Button
          className="account-button"
          aria-label="Open development account preview"
          title="Development-only account preview"
        >
          <UserRound size={20} aria-hidden="true" />
          <span>Dev account</span>
        </Button>
      }
    >
      <Card>
        <h3>Alex Example</h3>
        <p>Synthetic profile for development previews.</p>
        <p>Enjoys books and community swaps.</p>
      </Card>
      <div className="account-links" aria-label="Account actions">
        <Button disabled>Profile — coming soon</Button>
        <Button disabled>Settings — coming soon</Button>
      </div>
      <ThemePicker />
      <Button disabled>Sign out — unavailable in preview</Button>
    </AccountDrawer>
  );
}
