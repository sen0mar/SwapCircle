import type { BlockQuery, ReportSubmission } from '@swapcircle/contracts';
import type { SafetyRepository } from './safety.repository.js';
import { SafetyError, SafetyPermissions } from './safety.permissions.js';

export class SafetyService {
  constructor(
    private readonly repository: SafetyRepository,
    private readonly permissions = new SafetyPermissions(),
  ) {}

  async ownBlocks(actor: string, query: BlockQuery) {
    const rows = await this.repository.ownBlocks(actor, query);
    const items = rows.slice(0, query.limit);
    return {
      items,
      nextAfter: rows.length > query.limit ? items.at(-1)!.userId : null,
    };
  }

  async setBlock(actor: string, other: string, blocked: boolean) {
    if (actor === other)
      throw new SafetyError(400, 'INVALID_BLOCK', 'Choose another member.');

    return this.repository.transaction(async (client) => {
      await this.permissions.lockPair(client, actor, other);
      // Safety controls remain available to restricted accounts. They do not grant
      // communication rights or cause any moderation punishment.
      if (!(await this.repository.memberExists(client, other)))
        throw new SafetyError(404, 'NOT_FOUND', 'Member not found.');

      if ((await this.repository.hasOwnBlock(client, actor, other)) === blocked)
        return;

      await this.repository.provision(client, actor);
      await this.permissions.consume(client, actor, 'block');
      if (blocked) await this.repository.block(client, actor, other);
      else await this.repository.unblock(client, actor, other);
    });
  }

  async submitReport(actor: string, input: ReportSubmission) {
    return this.repository.transaction(async (client) => {
      const previous = await this.repository.retryReport(
        client,
        actor,
        input.clientReportId,
      );
      if (previous) {
        if (
          previous.reason !== input.reason ||
          previous.reportedUserId !==
            (input.targetType === 'member' ? input.targetId : null) ||
          previous.listingId !==
            (input.targetType === 'listing' ? input.targetId : null)
        )
          throw new SafetyError(
            409,
            'REPORT_RETRY_CONFLICT',
            'Use a new report reference for a different report.',
          );

        return { id: previous.id, createdAt: previous.createdAt };
      }

      if (!(await this.repository.targetExists(client, input)))
        throw new SafetyError(404, 'NOT_FOUND', 'Report target not found.');

      await this.repository.provision(client, actor);
      await this.permissions.consume(client, actor, 'report');
      return this.repository.report(client, actor, input);
    });
  }
}
