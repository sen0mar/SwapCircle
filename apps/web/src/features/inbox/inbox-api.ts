import type { SupabaseClient } from '@supabase/supabase-js';
import {
  conversationReadSchema,
  messageReadSchema,
  type ConversationRead,
} from '@swapcircle/contracts';

export const historyPageSize = 30;
export const conversationPageSize = 20;
const conversationColumns =
  'id,type,direct_user_low,direct_user_high,created_at';
const messageColumns =
  'id,conversation_id,sender_id,body,message_order,created_at';

export class ConversationDenied extends Error {}

// Keep private SDK reads inside the same identity/cancellation lifetime as Express.
export async function authorizeRead(
  client: SupabaseClient | null,
  userId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!client) throw new Error('Private history unavailable');

  const { data, error } = await client.auth.getSession();
  signal.throwIfAborted();
  if (error || data.session?.user.id !== userId)
    throw new Error('Session unavailable');

  return client;
}

export function directPeer(conversation: ConversationRead, userId: string) {
  return conversation.type === 'direct'
    ? conversation.direct_user_low === userId
      ? conversation.direct_user_high
      : conversation.direct_user_low
    : null;
}

export async function readConversation(
  client: SupabaseClient,
  id: string,
  signal: AbortSignal,
) {
  const { data, error } = await client
    .from('conversations')
    .select(conversationColumns)
    .eq('id', id)
    .abortSignal(signal)
    .retry(false)
    .maybeSingle();
  signal.throwIfAborted();
  if (error) throw new Error('Private history unavailable');
  if (!data) throw new ConversationDenied();

  return conversationReadSchema.parse(data);
}

export async function readConversations(
  client: SupabaseClient,
  cursor: { createdAt: string; id: string } | undefined,
  signal: AbortSignal,
) {
  let query = client
    .from('conversations')
    .select(conversationColumns)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(conversationPageSize + 1);
  if (cursor)
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );

  const { data, error } = await query.abortSignal(signal).retry(false);
  signal.throwIfAborted();
  if (error) throw new Error('Inbox unavailable');
  const rows = conversationReadSchema.array().parse(data);
  const items = rows.slice(0, conversationPageSize);
  const last = items.at(-1);

  return {
    items,
    nextCursor:
      rows.length > conversationPageSize && last
        ? { createdAt: last.created_at, id: last.id }
        : undefined,
  };
}

export async function readHistory(
  client: SupabaseClient,
  id: string,
  before: number | undefined,
  signal: AbortSignal,
  limit = historyPageSize,
) {
  let query = client
    .from('messages')
    .select(messageColumns)
    .eq('conversation_id', id)
    .order('message_order', { ascending: false })
    .limit(limit + 1);
  if (before !== undefined) query = query.lt('message_order', before);

  const { data, error } = await query.abortSignal(signal).retry(false);
  signal.throwIfAborted();
  if (error) throw new Error('History unavailable');
  const rows = messageReadSchema.array().parse(data);
  const items = rows.slice(0, limit);

  return {
    items,
    nextCursor: rows.length > limit ? items.at(-1)?.message_order : undefined,
  };
}
