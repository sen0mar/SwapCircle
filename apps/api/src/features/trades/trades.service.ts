import { createHash } from 'node:crypto';
import {
  proposalCreationResultSchema,
  type ProposalCreation,
} from '@swapcircle/contracts';
import { createNotification } from '../notifications/notifications.repository.js';
import {
  SafetyError,
  SafetyPermissions,
} from '../safety/safety.permissions.js';
import type { TradesRepository } from './trades.repository.js';

export class TradesService {
  constructor(
    private readonly repository: TradesRepository,
    private readonly permissions = new SafetyPermissions(),
  ) {}

  async create(actor: string, input: ProposalCreation) {
    if (!input.participantIds.includes(actor))
      throw new SafetyError(
        422,
        'PROPOSAL_INVALID',
        'Include yourself in the proposal.',
      );

    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          participantIds: [...input.participantIds].sort(),
          transfers: [...input.transfers].sort((a, b) =>
            a.listingId.localeCompare(b.listingId),
          ),
          meetingMode: input.meetingMode,
          expiresAt: input.expiresAt,
        }),
      )
      .digest('hex');

    return this.repository.transaction(async (client) => {
      await this.repository.lockOperation(client, actor, input.operationKey);
      await this.permissions.assertUnrestricted(client, [actor]);
      const previous = await this.repository.operation(
        client,
        actor,
        input.operationKey,
      );
      if (previous) {
        if (previous.operation_hash !== hash)
          throw new SafetyError(
            409,
            'OPERATION_CONFLICT',
            'This operation key was used for different terms.',
          );
        return proposalCreationResultSchema.parse({
          id: previous.id,
          currentVersion: previous.currentVersion,
          status: previous.status,
        });
      }

      await this.repository.lockParticipants(client, input.participantIds);
      await this.permissions.assertUnrestricted(client, input.participantIds);
      if (await this.repository.blocked(client, input.participantIds))
        throw new SafetyError(
          403,
          'CONTACT_BLOCKED',
          'This contact is unavailable.',
        );

      await this.permissions.authorizeWrite(client, actor, 'trade');
      if (
        (await this.repository.existingParticipants(
          client,
          input.participantIds,
        )) !== input.participantIds.length
      )
        throw new SafetyError(
          422,
          'PROPOSAL_INVALID',
          'A participant is unavailable.',
        );

      const expiry = Date.parse(input.expiresAt);
      if (expiry <= Date.now())
        throw new SafetyError(
          422,
          'PROPOSAL_INVALID',
          'Choose a future expiry.',
        );

      const listings = await this.repository.availableListings(
        client,
        input.transfers.map((transfer) => transfer.listingId),
      );
      for (const transfer of input.transfers) {
        const listing = listings.get(transfer.listingId);
        if (!listing || listing.availability !== 'available')
          throw new SafetyError(
            409,
            'LISTING_UNAVAILABLE',
            'An offered item is unavailable.',
          );
        if (listing.owner_id !== transfer.ownerId)
          throw new SafetyError(
            422,
            'PROPOSAL_INVALID',
            'An offered item has a different owner.',
          );
      }

      const { tradeId, eventId } = await this.repository.insertProposal(
        client,
        actor,
        input,
        hash,
        listings,
      );
      for (const recipientId of input.participantIds)
        if (recipientId !== actor)
          await createNotification(client, {
            recipient_id: recipientId,
            domain_event_id: eventId,
            event_type: 'trade_invitation',
            resource_type: 'trade',
            resource_id: tradeId,
          });

      if (input.participantIds.length >= 3) {
        const group = await this.repository.createGroup(
          client,
          tradeId,
          actor,
          input.participantIds,
        );

        for (const recipientId of input.participantIds)
          if (recipientId !== actor)
            await createNotification(client, {
              recipient_id: recipientId,
              domain_event_id: group.eventId,
              event_type: 'group_invitation',
              resource_type: 'conversation',
              resource_id: group.id,
            });
      }

      return {
        id: tradeId,
        currentVersion: 1 as const,
        status: 'proposed' as const,
      };
    });
  }

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
