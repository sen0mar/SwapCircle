import { apiErrorSchema } from '@swapcircle/contracts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | undefined = undefined,
    readonly requestId: string | undefined = undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ResponseSchema<T> = {
  safeParse: (
    value: unknown,
  ) => { success: true; data: T } | { success: false };
};
export async function apiRequest<T>(
  path: `/api/v1/${string}`,
  schema: ResponseSchema<T>,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15000, signal, ...init } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(
      `${import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001'}${path}`,
      {
        ...init,
        credentials: 'omit',
        signal: combinedSignal,
        headers: {
          Accept: 'application/json',
          ...Object.fromEntries(new Headers(init.headers)),
        },
      },
    );
    const body: unknown = await response.json().catch((error: unknown) => {
      if (combinedSignal.aborted) throw error;
      return undefined;
    });
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      if (parsed.success) {
        const { code, message, requestId } = parsed.data.error;
        throw new ApiError(message, code, response.status, requestId);
      }
      throw new ApiError(
        'The request could not be completed.',
        'HTTP_ERROR',
        response.status,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        'The API returned an unexpected response.',
        'INVALID_RESPONSE',
        response.status,
      );
    return parsed.data;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof ApiError) throw error;
    if (timeout.aborted)
      throw new ApiError(
        'The API is taking too long to respond. It may be waking up. Please retry.',
        'TIMEOUT',
      );
    throw new ApiError(
      'The API could not be reached. Check your connection and retry.',
      'NETWORK_ERROR',
    );
  }
}
