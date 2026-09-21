import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { safeDestination } from './safe-destination';

// StrictMode can mount callback effects twice; a one-use code must be exchanged once.
let exchange: { code: string; promise: Promise<boolean> } | undefined;

export function useAuthCallback() {
  const { client } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const code = params.get('code');
  const destination = safeDestination(params.get('next'));
  const providerError = params.has('error');

  useEffect(() => {
    let active = true;

    if (!client || !code || providerError) {
      setFailed(true);

      return;
    }

    if (exchange?.code !== code) {
      exchange = {
        code,
        promise: client.auth
          .exchangeCodeForSession(code)
          .then(({ error }) => !error)
          .catch(() => false),
      };
    }

    void exchange.promise.then((ok) => {
      if (!active) return;

      if (ok) void navigate(destination, { replace: true });
      else {
        setFailed(true);
        void navigate('/auth/callback', { replace: true });
      }
    });

    return () => {
      active = false;
    };
  }, [client, code, destination, providerError, navigate]);

  return { failed };
}
