import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { ThemePicker } from '../../components/layout/ThemePicker';
import { useAuth } from '../auth/AuthProvider';

export function SettingsPage() {
  const { signOut } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  return (
    <section className="panel route-panel settings-page">
      <h1>Account settings</h1>
      <ThemePicker />
      <Button
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(false);
          void signOut().catch(() => {
            setError(true);
            setPending(false);
          });
        }}
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </Button>
      {error && (
        <p role="alert">Sign-out failed. Check your connection and retry.</p>
      )}
    </section>
  );
}
