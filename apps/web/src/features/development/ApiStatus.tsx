import { useQuery } from '@tanstack/react-query';
import { livenessSchema } from '@swapcircle/contracts';
import { apiRequest, ApiError } from '../../lib/api-client';
import { Button } from '../../components/ui/button';

export default function ApiStatus() {
  const status = useQuery({
    queryKey: ['development', 'api-liveness'],
    queryFn: ({ signal }) =>
      apiRequest('/api/v1/live', livenessSchema, { signal }),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
  return (
    <section className="panel route-panel" aria-labelledby="api-status-title">
      <h1 id="api-status-title">Development API status</h1>
      <p>This checks API liveness only, not database readiness.</p>
      {status.isFetching ? (
        <p role="status">Connecting to the API. It may need time to wake up.</p>
      ) : status.isError ? (
        <div role="alert">
          <p>{status.error.message}</p>
          {status.error instanceof ApiError && status.error.requestId && (
            <p>Request reference: {status.error.requestId}</p>
          )}
        </div>
      ) : status.isSuccess ? (
        <p role="status">API is reachable.</p>
      ) : null}
      <Button
        disabled={status.isFetching}
        onClick={() => void status.refetch()}
      >
        {status.isError ? 'Retry connection' : 'Check connection'}
      </Button>
    </section>
  );
}
