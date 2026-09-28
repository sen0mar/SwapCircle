import { ApiError } from '../../lib/api-client';

// Safe, reusable recovery copy: never render internal moderation or server details.
export function actionError(
  error: unknown,
  fallback = 'The action could not be completed. Check your connection and retry.',
): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'ACTION_LIMIT':
        return 'You have reached the limit for this action. Wait before trying again; your draft is kept here.';
      case 'BURST_LIMIT':
        return 'Too many requests arrived together. Wait a moment, then retry.';
      case 'CONTACT_BLOCKED':
        return 'Contact with this member is unavailable. You can still manage your blocks in Account settings or submit a report.';
      case 'ACCOUNT_RESTRICTED':
        return 'Changes and new contact are currently unavailable for your account. You can still manage blocks and submit reports.';
      case 'NOT_FOUND':
        return 'This member or item is no longer available. Return to Browse to choose another.';
      case 'REPORT_RETRY_CONFLICT':
        return 'This report reference was already used for different details. Start a different report to change the details.';
      case 'NETWORK_ERROR':
      case 'TIMEOUT':
        return 'The result could not be confirmed. Check your connection and retry; any draft is kept here.';
      case 'UNAUTHORIZED':
        return 'Your session could not be verified. Sign in again to continue.';
    }
  }
  return fallback;
}
