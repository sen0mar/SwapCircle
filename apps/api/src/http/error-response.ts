import type { ApiErrorResponse } from '@swapcircle/contracts';

export function errorBody(
  code: string,
  message: string,
  requestId: unknown,
): ApiErrorResponse {
  return { error: { code, message, requestId: String(requestId) } };
}
