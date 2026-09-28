import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { directConversationReceiptSchema } from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/AuthProvider';
import { actionError } from '../safety/action-error';

export function MessageAction({ userId }: { userId: string }) {
  const { session, request } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queries = useQueryClient();
  const start = useMutation({
    mutationFn: () =>
      request('/api/v1/conversations/direct', directConversationReceiptSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      }),
    onSuccess: (conversation) => {
      void queries.invalidateQueries({
        queryKey: ['private', session?.user.id, 'inbox'],
      });
      navigate(`/inbox/${conversation.id}`);
    },
  });

  if (session?.user.id === userId) return null;

  return (
    <div className="message-action">
      {session ? (
        <Button onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? 'Opening conversation…' : 'Message'}
        </Button>
      ) : (
        <Button asChild>
          <Link
            to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}
          >
            Sign in to message
          </Link>
        </Button>
      )}
      {start.isError && <p role="alert">{actionError(start.error)}</p>}
    </div>
  );
}
