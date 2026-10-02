import { SafetyChecksRepository } from './safety-checks.repository.js';
import type { PoolClient } from 'pg';

export class SafetyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export const developmentLimits = {
  allowance: 120,
  windowSeconds: 3600,
  burstMax: 60,
  burstWindowMs: 60_000,
};

export type SafetyLimits = typeof developmentLimits;
export type WriteAction =
  | 'profile'
  | 'avatar'
  | 'listing'
  | 'photo'
  | 'block'
  | 'report'
  | 'conversation'
  | 'message'
  | 'trade'
  | 'coffee';

export class SafetyPermissions {
  constructor(
    private readonly limits: SafetyLimits = developmentLimits,
    private readonly repository = new SafetyChecksRepository(),
  ) {}

  async assertUnrestricted(client: PoolClient, actors: string[]) {
    if (await this.repository.restricted(client, actors))
      throw new SafetyError(
        403,
        'ACCOUNT_RESTRICTED',
        'This action is currently unavailable.',
      );
  }

  // Call inside the domain transaction before resource locks/writes. Block/unblock
  // uses the same ordered locks, so a racing contact cannot pass an older block check.
  // Future DM/trade/coffee creation must reuse this check for every invited pair.
  async assertContactAllowed(client: PoolClient, actor: string, other: string) {
    await this.lockPair(client, actor, other);
    await this.assertUnrestricted(client, [actor, other]);
    if (await this.repository.blocked(client, actor, other))
      throw new SafetyError(
        403,
        'CONTACT_BLOCKED',
        'This contact is unavailable.',
      );
  }

  async lockPair(client: PoolClient, actor: string, other: string) {
    for (const user of [...new Set([actor, other])].sort())
      await this.repository.lockAccount(client, user);
  }

  async consume(client: PoolClient, actor: string, action: WriteAction) {
    if (
      !(await this.repository.consume(
        client,
        actor,
        action,
        this.limits.windowSeconds,
        this.limits.allowance,
      ))
    )
      throw new SafetyError(
        429,
        'ACTION_LIMIT',
        'Too many actions. Try again later.',
        this.limits.windowSeconds,
      );
  }

  async authorizeWrite(client: PoolClient, actor: string, action: WriteAction) {
    await this.assertUnrestricted(client, [actor]);
    await this.repository.provision(client, actor);
    await this.consume(client, actor, action);
  }
}
