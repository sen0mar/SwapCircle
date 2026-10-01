import type { TradeDetail, TradeVersion } from './trades-api';

type Terms = Pick<TradeVersion, 'participantIds' | 'items' | 'expiresAt'>;

export function detailTerms(trade: TradeDetail): Terms {
  return {
    participantIds: trade.participants.map((person) => person.userId),
    items: trade.items,
    expiresAt: trade.expiresAt,
  };
}

export function termChanges(before: Terms, after: Terms): string[] {
  const changes: string[] = [];
  const count = (amount: number, noun: string, action: string) =>
    `${amount} ${noun}${amount === 1 ? '' : 's'} ${action}`;
  const added = after.participantIds.filter(
    (id) => !before.participantIds.includes(id),
  ).length;
  const removed = before.participantIds.filter(
    (id) => !after.participantIds.includes(id),
  ).length;

  if (added) changes.push(count(added, 'participant', 'added'));
  if (removed) changes.push(count(removed, 'participant', 'removed'));

  const oldItems = new Map(before.items.map((item) => [item.listingId, item]));
  const newItems = new Map(after.items.map((item) => [item.listingId, item]));
  const addedItems = after.items.filter(
    (item) => !oldItems.has(item.listingId),
  ).length;
  const removedItems = before.items.filter(
    (item) => !newItems.has(item.listingId),
  ).length;
  const transfers = after.items.filter((item) => {
    const old = oldItems.get(item.listingId);
    return (
      old &&
      (old.ownerId !== item.ownerId || old.recipientId !== item.recipientId)
    );
  }).length;
  const details = after.items.filter((item) => {
    const old = oldItems.get(item.listingId);
    return (
      old &&
      (old.listingRevision !== item.listingRevision ||
        old.titleSnapshot !== item.titleSnapshot ||
        old.descriptionSnapshot !== item.descriptionSnapshot ||
        old.conditionSnapshot !== item.conditionSnapshot)
    );
  }).length;

  if (addedItems) changes.push(count(addedItems, 'item', 'added'));
  if (removedItems) changes.push(count(removedItems, 'item', 'removed'));
  if (transfers) changes.push(count(transfers, 'transfer', 'changed'));
  if (details) changes.push(count(details, 'listing snapshot', 'revised'));
  if (before.expiresAt !== after.expiresAt) changes.push('Expiry changed');

  return changes;
}
