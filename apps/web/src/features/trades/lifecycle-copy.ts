import type { TradeDetail } from './trades-api';

export function lifecycleSummary(status: TradeDetail['status']) {
  switch (status) {
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
