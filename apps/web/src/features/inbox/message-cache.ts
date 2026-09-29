import type { InfiniteData } from '@tanstack/react-query';
import type { MessageRead } from '@swapcircle/contracts';
import type { readHistory } from './inbox-api';

export type HistoryData = InfiniteData<
  Awaited<ReturnType<typeof readHistory>>,
  number | undefined
>;

// Shared by send receipts and Realtime/backfills. Keep older-page cursors intact.
export function mergeMessage(
  current: HistoryData,
  saved: MessageRead,
): HistoryData {
  const matches = (message: MessageRead) =>
    message.id === saved.id ||
    (message.sender_id === saved.sender_id &&
      message.client_message_id === saved.client_message_id);
  const existingPage = current.pages.findIndex((page) =>
    page.items.some(matches),
  );
  const pages = current.pages.map((page) => ({
    ...page,
    items: page.items.filter((message) => !matches(message)),
  }));
  const target = pages[existingPage < 0 ? 0 : existingPage];

  if (target)
    target.items = [...target.items, saved].sort(
      (a, b) => b.message_order - a.message_order,
    );

  return { ...current, pages };
}
