import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from '../../lib/api-client';
import { supabase } from './client';
import { MessageComposerProvider } from '../inbox/MessageComposerProvider';

type AuthState = {
  session: Session | null;
  loading: boolean;
  generation: number;
  error: string | null;
};

type AuthContextValue = AuthState & {
  client: SupabaseClient | null;
  signOut: () => Promise<void>;
  request: typeof apiRequest;
  readSignal: AbortSignal;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: false,
  generation: 0,
  error: null,
  client: null,
  signOut: async () => {},
  request: apiRequest,
  readSignal: new AbortController().signal,
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({
  children,
  client = supabase,
}: {
  children: ReactNode;
  client?: SupabaseClient | null;
}) {
  const queries = useQueryClient();

  const [state, setState] = useState<AuthState>({
    session: null,
    loading: !!client,
    generation: 0,
    error: null,
  });

  const current = useRef<Session | null>(null);
  const scope = useRef(new AbortController());
  const generation = useRef(0);

  useEffect(() => {
    if (!client) return;

    let active = true;
    let events = 0;

    const change = (session: Session | null) => {
      if (!active) return;

      if (current.current?.user.id !== session?.user.id) {
        scope.current.abort();
        scope.current = new AbortController();
        void queries.cancelQueries();
        queries.clear();
        // Unsubscribe immediately; never await another SDK method inside its auth callback.
        void client.removeAllChannels();
        generation.current++;
      }

      current.current = session;

      setState({
        session,
        loading: false,
        generation: generation.current,
        error: null,
      });
    };

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      events++;
      change(session);
    });

    const initialEvents = events;

    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || events !== initialEvents) return;

        change(error ? null : data.session);

        if (error)
          setState((s) => ({
            ...s,
            error: 'Your session could not be restored. Please sign in again.',
          }));
      })
      .catch(() => {
        if (active && events === initialEvents) {
          change(null);

          setState((s) => ({
            ...s,
            error: 'Your session could not be restored. Please sign in again.',
          }));
        }
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client, queries]);

  const requestScope = scope.current;

  const request: typeof apiRequest = async (path, schema, options = {}) => {
    const originalScope = requestScope;

    const { data, error } = client
      ? await client.auth.getSession()
      : { data: { session: null }, error: null };

    if (originalScope.signal.aborted) throw originalScope.signal.reason;

    if (
      error ||
      !data.session ||
      data.session.user.id !== state.session?.user.id
    )
      throw new ApiError('Sign in to continue.', 'UNAUTHORIZED', 401);

    const headers = new Headers(options.headers);

    headers.set('Authorization', `Bearer ${data.session.access_token}`);

    return apiRequest(path, schema, {
      ...options,
      headers,
      signal: options.signal
        ? AbortSignal.any([options.signal, originalScope.signal])
        : originalScope.signal,
    });
  };

  const signOut = async () => {
    if (!client) return;

    const { error } = await client.auth.signOut({ scope: 'local' });

    if (error)
      throw new Error('Sign-out failed. Check your connection and retry.');
  };

  return (
    <AuthContext.Provider
      value={{
        ...state,
        client,
        signOut,
        request,
        readSignal: requestScope.signal,
      }}
    >
      <AuthBoundary key={state.generation}>{children}</AuthBoundary>
    </AuthContext.Provider>
  );
}

// Remount account-owned local state (drawers/forms/drafts) on identity transitions.
function AuthBoundary({ children }: { children: ReactNode }) {
  return <MessageComposerProvider>{children}</MessageComposerProvider>;
}
