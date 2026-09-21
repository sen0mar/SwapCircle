import { useState } from 'react';
import { useAuth } from './AuthProvider';

export function useGoogleSignIn(destination: string) {
  const { client } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn() {
    if (!client || pending) return;

    setPending(true);
    setError(null);

    try {
      const callback = new URL('/auth/callback', window.location.origin);

      callback.searchParams.set('next', destination);

      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callback.href },
      });

      if (error) throw error;
    } catch {
      setError('Google sign-in could not start. Please retry.');
      setPending(false);
    }
  }

  return { configured: !!client, error, pending, signIn };
}
