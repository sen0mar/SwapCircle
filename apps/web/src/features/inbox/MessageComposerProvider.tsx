import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  messageSubmissionSchema,
  type MessageRead,
  type MessageSubmission,
} from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';
import { submitMessage } from './inbox-api';
import { mergeMessage, type HistoryData } from './message-cache';

type LocalMessage = {
  payload: MessageSubmission;
  status: 'pending' | 'failed';
  delayed: boolean;
};
type ComposerState = {
  drafts: Record<string, string>;
  outbox: LocalMessage[];
  setDraft: (id: string, text: string) => void;
  send: (id: string) => void;
  retry: (message: LocalMessage) => void;
  reconcile: (messages: MessageRead[]) => void;
};
const ComposerContext = createContext<ComposerState | null>(null);

export function useComposer() {
  const value = useContext(ComposerContext);
  if (!value) throw new Error('Message composer provider is missing');

  return value;
}

// This provider lives inside AuthProvider's keyed identity boundary, above routes.
// Drafts/recoverable payloads survive navigation, and are discarded on identity changes.
export function MessageComposerProvider({ children }: { children: ReactNode }) {
  const { request, session, readSignal } = useAuth();
  const queries = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [outbox, setOutbox] = useState<LocalMessage[]>([]);
  const active = useRef(new Set<string>());
  const setDraft = (id: string, text: string) =>
    setDrafts((current) => ({ ...current, [id]: text }));

  const attempt = async (payload: MessageSubmission) => {
    const key = payload.client_message_id;
    if (active.current.has(key)) return;
    active.current.add(key);
    setOutbox((current) =>
      current.map((message) =>
        message.payload.client_message_id === key
          ? { ...message, status: 'pending', delayed: false }
          : message,
      ),
    );
    const timer = setTimeout(() => {
      if (!readSignal.aborted)
        setOutbox((current) =>
          current.map((message) =>
            message.payload.client_message_id === key
              ? { ...message, delayed: true }
              : message,
          ),
        );
    }, 2500);

    try {
      const saved = await submitMessage(request, payload);
      if (readSignal.aborted) return;
      const historyKey = [
        'private',
        session?.user.id,
        'thread',
        payload.conversation_id,
        'history',
      ];
      const hadHistory = queries.getQueryData(historyKey) !== undefined;
      // A read begun before this commit must not overwrite the saved receipt later.
      await queries.cancelQueries({ queryKey: historyKey, exact: true });
      if (readSignal.aborted) return;
      queries.setQueryData<HistoryData>(historyKey, (current) =>
        current
          ? mergeMessage(current, saved)
          : {
              pages: [{ items: [saved], nextCursor: undefined }],
              pageParams: [undefined],
            },
      );
      if (!hadHistory)
        void queries.invalidateQueries({ queryKey: historyKey, exact: true });
      setOutbox((current) =>
        current.filter((message) => message.payload.client_message_id !== key),
      );
      void queries.invalidateQueries({
        queryKey: ['private', session?.user.id, 'inbox'],
      });
      void queries.invalidateQueries({
        queryKey: [
          'private',
          session?.user.id,
          'thread',
          payload.conversation_id,
          'profiles',
        ],
      });
    } catch {
      if (!readSignal.aborted)
        setOutbox((current) =>
          current.map((message) =>
            message.payload.client_message_id === key
              ? { ...message, status: 'failed', delayed: false }
              : message,
          ),
        );
    } finally {
      clearTimeout(timer);
      active.current.delete(key);
    }
  };

  const send = (id: string) => {
    const payload = messageSubmissionSchema.safeParse({
      conversation_id: id,
      body: drafts[id] ?? '',
      client_message_id: crypto.randomUUID(),
    });
    if (!payload.success) return;
    setOutbox((current) => [
      ...current,
      { payload: payload.data, status: 'pending', delayed: false },
    ]);
    setDraft(id, '');
    void attempt(payload.data);
  };
  const reconcile = useCallback(
    (messages: MessageRead[]) => {
      setOutbox((current) => {
        const remaining = current.filter(
          (local) =>
            !messages.some(
              (saved) =>
                saved.sender_id === session?.user.id &&
                saved.conversation_id === local.payload.conversation_id &&
                saved.client_message_id === local.payload.client_message_id,
            ),
        );

        return remaining.length === current.length ? current : remaining;
      });
    },
    [session?.user.id],
  );

  return (
    <ComposerContext.Provider
      value={{
        drafts,
        outbox,
        setDraft,
        send,
        retry: (message) => void attempt(message.payload),
        reconcile,
      }}
    >
      {children}
    </ComposerContext.Provider>
  );
}
