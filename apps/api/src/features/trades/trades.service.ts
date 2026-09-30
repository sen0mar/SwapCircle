import { SafetyError } from '../safety/safety.permissions.js';
import type { TradesRepository } from './trades.repository.js';

export class TradesService {
  constructor(private readonly repository: TradesRepository) {}

  async page(actor: string, limit: number, after?: string) {
    return this.repository.read(async (client) => {
      if (await this.repository.restricted(client, actor))
        throw new SafetyError(
          403,
          'ACCOUNT_RESTRICTED',
          'This action is currently unavailable.',
        );

      return this.repository.page(client, actor, limit, after);
    });
  }

  async detail(actor: string, id: string) {
    return this.repository.read(async (client) => {
      if (await this.repository.restricted(client, actor))
        throw new SafetyError(
          403,
          'ACCOUNT_RESTRICTED',
          'This action is currently unavailable.',
        );

      const trade = await this.repository.detail(client, actor, id);
      if (!trade)
        throw new SafetyError(
          404,
          'TRADE_UNAVAILABLE',
          'This trade is unavailable.',
        );

      return trade;
    });
  }
}
