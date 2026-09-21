import { ApiError } from '../../lib/api-client';
import { Button } from '../../components/ui/button';
import { useApiStatus } from './useApiStatus';

export default function ApiStatus() {
  const status = useApiStatus();
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
