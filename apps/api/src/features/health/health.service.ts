import type { Pool, QueryConfig } from 'pg';
import type { Readiness } from '@swapcircle/contracts';
import { safeRevision } from '../../observability/privacy.js';

export class HealthService {
  constructor(
    private readonly pool?: Pick<Pool, 'query'>,
    private readonly revision = 'unknown',
    private readonly timeoutMs = 3000,
  ) {}

  async readiness(): Promise<Readiness> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      if (!this.pool) throw new Error('Database unavailable');

      // The runtime pool bounds acquisition; pg also bounds this probe query.
      const probe: QueryConfig & { query_timeout: number } = {
        text: 'SELECT 1',
        query_timeout: 2000,
      };

      await Promise.race([
        this.pool.query(probe),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Readiness timeout')),
            this.timeoutMs,
          );
          timer.unref();
        }),
      ]);

      return { status: 'ready', revision: safeRevision(this.revision) };
    } catch {
      return { status: 'unavailable', revision: safeRevision(this.revision) };
    } finally {
      clearTimeout(timer);
    }
  }
}
