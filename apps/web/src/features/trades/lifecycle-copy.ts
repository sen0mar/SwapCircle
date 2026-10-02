import type { TradeDetail } from './trades-api';

export function lifecycleSummary(status: TradeDetail['status']) {
  switch (status) {
    case 'completed':
      return 'Everyone acknowledged receipt. This swap is completed and its items are exchanged. Completion cannot be undone here; reporting after completion is not supported yet.';
    case 'disputed':
      return 'A problem was reported. This dispute is unresolved; items remain reserved and ordinary cancellation and completion are blocked. Private report review and dispute resolution are not available yet.';
    case 'declined':
      return 'A participant declined this proposal. It cannot be accepted. Terms and history remain available.';
    case 'expired':
      return 'The server has marked this proposal expired. It cannot be accepted. Terms and history remain available.';
    case 'cancelled':
      return 'This swap was cancelled, not completed. Any reservations for this swap were released. Items may have changed since cancellation; review their current availability.';
    default:
      return null;
  }
}

export function hasHandover(detail: TradeDetail) {
  return (
    detail.status === 'disputed' ||
    detail.events.some((event) =>
      ['receipt_acknowledged', 'handover_reported', 'disputed'].includes(
        event.eventType,
      ),
    )
  );
}
