import { useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { FormFeedback } from '../../components/ui/form-feedback';
import { apiRequest } from '../../lib/api-client';
import { useAuth } from './AuthProvider';

const guestSessionSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

export default function GuestSignIn({
  disabled,
  onPending,
}: {
  disabled: boolean;
  onPending: (pending: boolean) => void;
}) {
  const { client } = useAuth();
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (disabled || !client || active.current) return;

    active.current = true;
    setPending(true);
    onPending(true);
    setError(null);
    try {
      const session = await apiRequest(
        '/api/v1/auth/guest',
        guestSessionSchema,
        { method: 'POST' },
      );
      const result = await client.auth.setSession(session);
      if (result.error) throw result.error;
    } catch {
      setError('Guest sign-in is unavailable. Try again later.');
    } finally {
      active.current = false;
      setPending(false);
      onPending(false);
    }
  }

  return (
    <div className="auth-form">
      <Button
        type="button"
        disabled={disabled || pending}
        onClick={() => void signIn()}
      >
        {pending ? 'Opening demo…' : 'Continue as guest'}
      </Button>
      <p>
        This is a shared demo account. Everyone using it can see its activity.
        Use fictional details only.
      </p>
      {error && (
        <FormFeedback id="guest-sign-in-error" tone="error">
          {error}
        </FormFeedback>
      )}
    </div>
  );
}
