import type { HealthRepository } from './health.repository.js';
import type { Readiness } from '@swapcircle/contracts';
import { safeRevision } from '../../observability/privacy.js';

export class HealthService {
  constructor(
    private readonly repository?: Pick<HealthRepository, 'probe'>,
    private readonly revision = 'unknown',
    private readonly timeoutMs = 3000,
  ) {}

  async readiness(): Promise<Readiness> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      if (!this.repository) throw new Error('Database unavailable');

      await Promise.race([
        this.repository.probe(),
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
