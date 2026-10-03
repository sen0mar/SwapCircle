import type { Pool, QueryConfig } from 'pg';

export class HealthRepository {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async probe(): Promise<void> {
    const query: QueryConfig & { query_timeout: number } = {
      text: 'SELECT 1',
      query_timeout: 2000,
    };

    await this.pool.query(query);
  }
}
