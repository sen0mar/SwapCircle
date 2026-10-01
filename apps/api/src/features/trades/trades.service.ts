import { createHash } from 'node:crypto';
import {
  proposalCreationResultSchema,
  type ProposalCreation,
  type ProposalRevision,
  type TradeAcceptance,
  tradeAcceptanceResultSchema,
} from '@swapcircle/contracts';
import { createNotification } from '../notifications/notifications.repository.js';
import {
  SafetyError,
  SafetyPermissions,
} from '../safety/safety.permissions.js';
import { lockProposalBoundary } from './proposal-boundary.js';
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
      await lockProposalBoundary(client);
      await this.repository.lockOperation(client, actor, input.operationKey);
      await this.permissions.assertUnrestricted(client, [actor]);
      const previous = await this.repository.operation(
        client,
        actor,
        input.operationKey,
      );
      if (previous) {
        if (
          !(await this.repository.participantIds(client, previous.id)).includes(
            actor,
          )
        )
          throw new SafetyError(
            404,
            'TRADE_UNAVAILABLE',
            'This trade is unavailable.',
          );

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

  async revise(actor: string, id: string, input: ProposalRevision) {
    return this.repository.transaction(async (client) => {
      await lockProposalBoundary(client);
      const previousParticipants = await this.repository.participantIds(
        client,
        id,
      );
      await this.repository.lockParticipants(client, [
        ...new Set([actor, ...previousParticipants, ...input.participantIds]),
      ]);
      await this.permissions.assertUnrestricted(client, [actor]);

      const trade = await this.repository.lockTrade(client, id, actor);
      if (!trade)
        throw new SafetyError(
          404,
          'TRADE_UNAVAILABLE',
          'This trade is unavailable.',
        );

      if (
        trade.status !== 'proposed' ||
        trade.expires_at.getTime() <= Date.now()
      )
        throw new SafetyError(
          409,
          'TERMS_FROZEN',
          'These terms cannot be revised.',
        );

      if (trade.current_version !== input.expectedVersion)
        throw new SafetyError(
          409,
          'STALE_PROPOSAL',
          'The proposal changed. Reload its terms.',
        );

      if (!input.participantIds.includes(actor))
        throw new SafetyError(
          422,
          'PROPOSAL_INVALID',
          'Include yourself in the proposal.',
        );

      if (Date.parse(input.expiresAt) <= Date.now())
        throw new SafetyError(
          422,
          'PROPOSAL_INVALID',
          'Choose a future expiry.',
        );

      await this.permissions.assertUnrestricted(client, input.participantIds);
      if (await this.repository.blocked(client, input.participantIds))
        throw new SafetyError(
          403,
          'CONTACT_BLOCKED',
          'This contact is unavailable.',
        );

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

      await this.permissions.authorizeWrite(client, actor, 'trade');

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

      const eventId = await this.repository.insertRevision(
        client,
        id,
        actor,
        input,
        listings,
      );
      for (const recipientId of input.participantIds)
        if (recipientId !== actor)
          await createNotification(client, {
            recipient_id: recipientId,
            domain_event_id: eventId,
            event_type: previousParticipants.includes(recipientId)
              ? 'trade_revision'
              : 'trade_invitation',
            resource_type: 'trade',
            resource_id: id,
          });

      const group = await this.repository.coordinateGroup(
        client,
        id,
        actor,
        input.participantIds,
        input.participantIds.filter(
          (user) => !previousParticipants.includes(user),
        ),
      );
      if (group)
        for (const change of group.changes) {
          const recipients =
            change.event_type === 'removed'
              ? new Set([change.user_id, ...group.activeMembers])
              : new Set([change.user_id]);

          for (const recipientId of recipients)
            await createNotification(client, {
              recipient_id: recipientId,
              domain_event_id: change.event_id,
              event_type:
                change.event_type === 'removed'
                  ? 'group_membership'
                  : 'group_invitation',
              resource_type: 'conversation',
              resource_id: group.id,
            });
        }

      return {
        id,
        currentVersion: input.expectedVersion + 1,
        status: 'proposed' as const,
      };
    });
  }

  async accept(actor: string, id: string, input: TradeAcceptance) {
    return this.repository.transaction(async (client) => {
      await lockProposalBoundary(client);
      await this.repository.lockOperation(client, actor, input.operationKey);
      const participants = await this.repository.participantIds(client, id);
      await this.repository.lockParticipants(client, [
        ...new Set([actor, ...participants]),
      ]);
      await this.permissions.assertUnrestricted(client, [actor]);
      const trade = await this.repository.lockTrade(client, id, actor);
      if (!trade)
        throw new SafetyError(
          404,
          'TRADE_UNAVAILABLE',
          'This trade is unavailable.',
        );

      const previous = await this.repository.acceptanceOperation(
        client,
        actor,
        input.operationKey,
      );
      if (previous) {
        if (
          previous.trade_id !== id ||
          previous.version !== input.expectedVersion
        )
          throw new SafetyError(
            409,
            'OPERATION_CONFLICT',
            'This operation key was used for different terms.',
          );
        return tradeAcceptanceResultSchema.parse({
          id,
          acceptedVersion: previous.version,
          status: previous.result_status,
        });
      }

      await this.permissions.authorizeWrite(client, actor, 'trade');

      if (trade.current_version !== input.expectedVersion)
        throw new SafetyError(
          409,
          'STALE_PROPOSAL',
          'The proposal changed. Reload its terms.',
        );

      await this.permissions.assertUnrestricted(client, participants);
      if (await this.repository.blocked(client, participants))
        throw new SafetyError(
          403,
          'CONTACT_BLOCKED',
          'This contact is unavailable.',
        );

      // A new key for an already confirmed consent cannot create another outcome.
      if (
        trade.status === 'confirmed' &&
        (await this.repository.hasAcceptance(
          client,
          id,
          input.expectedVersion,
          actor,
        ))
      )
        return this.repository.saveAcceptanceOperation(
          client,
          actor,
          input.operationKey,
          id,
          input.expectedVersion,
          'confirmed',
        );
      if (trade.status !== 'proposed')
        throw new SafetyError(
          409,
          'TERMS_FROZEN',
          'These terms cannot be accepted.',
        );

      const terms = await this.repository.acceptanceTerms(
        client,
        id,
        input.expectedVersion,
      );
      const version = terms.version;
      if (
        !version ||
        !version.expires_match ||
        [...version.participant_ids].sort().join() !==
          [...participants].sort().join() ||
        participants.length < 2 ||
        terms.items.length === 0 ||
        participants.some(
          (user) => !terms.items.some((item) => item.owner_id === user),
        )
      )
        throw new SafetyError(
          409,
          'STALE_PROPOSAL',
          'The proposal changed. Reload its terms.',
        );

      const listings = await this.repository.availableListings(
        client,
        terms.items.map((item) => item.listing_id),
      );
      for (const item of terms.items) {
        const listing = listings.get(item.listing_id);
        if (!listing || listing.availability !== 'available')
          throw new SafetyError(
            409,
            'LISTING_UNAVAILABLE',
            'An offered item is unavailable.',
          );
        if (
          listing.owner_id !== item.owner_id ||
          !participants.includes(item.owner_id) ||
          !participants.includes(item.recipient_id) ||
          item.owner_id === item.recipient_id ||
          listing.revision !== item.listing_revision ||
          listing.title !== item.title_snapshot ||
          listing.description !== item.description_snapshot ||
          listing.condition !== item.condition_snapshot
        )
          throw new SafetyError(
            409,
            'STALE_PROPOSAL',
            'The proposal changed. Reload its terms.',
          );
      }
      if (await this.repository.reserved(client, [...listings.keys()]))
        throw new SafetyError(
          409,
          'LISTING_UNAVAILABLE',
          'An offered item is unavailable.',
        );

      // Check the database clock after potentially waiting for listing locks.
      if (
        !(
          await this.repository.acceptanceTerms(
            client,
            id,
            input.expectedVersion,
          )
        ).version?.unexpired
      )
        throw new SafetyError(
          409,
          'PROPOSAL_EXPIRED',
          'This proposal has expired.',
        );

      if (
        !(await this.repository.hasAcceptance(
          client,
          id,
          input.expectedVersion,
          actor,
        ))
      ) {
        await this.repository.insertAcceptance(
          client,
          id,
          input.expectedVersion,
          version.id,
          actor,
        );
      }
      let status: 'proposed' | 'confirmed' = 'proposed';
      if (await this.repository.unanimous(client, id, input.expectedVersion)) {
        const eventId = await this.repository.confirm(
          client,
          id,
          version.id,
          actor,
          [...listings.keys()],
        );
        for (const recipientId of participants)
          await createNotification(client, {
            recipient_id: recipientId,
            domain_event_id: eventId,
            event_type: 'trade_status',
            resource_type: 'trade',
            resource_id: id,
          });
        status = 'confirmed';
      }
      return this.repository.saveAcceptanceOperation(
        client,
        actor,
        input.operationKey,
        id,
        input.expectedVersion,
        status,
      );
    });
  }

  async version(actor: string, id: string, version: number) {
    return this.repository.read(async (client) => {
      await this.permissions.assertUnrestricted(client, [actor]);
      const snapshot = await this.repository.version(
        client,
        actor,
        id,
        version,
      );
      if (!snapshot)
        throw new SafetyError(
          404,
          'TRADE_UNAVAILABLE',
          'This trade is unavailable.',
        );

      return snapshot;
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
