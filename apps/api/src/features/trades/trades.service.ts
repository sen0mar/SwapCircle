import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import {
  proposalCreationResultSchema,
  tradeOutcomeResultSchema,
  type TradeReceiptSubmission,
  type TradeProblemSubmission,
  type ProposalCreation,
  type ProposalRevision,
  type TradeAcceptance,
  type TradeTransition,
  tradeTransitionResultSchema,
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

  private async close(
    client: PoolClient,
    id: string,
    actor: string,
    status: 'declined' | 'expired' | 'cancelled',
  ) {
    const eventId = await this.repository.close(client, id, actor, status);
    for (const recipientId of await this.repository.participantIds(client, id))
      await createNotification(client, {
        recipient_id: recipientId,
        domain_event_id: eventId,
        event_type: 'trade_status',
        resource_type: 'trade',
        resource_id: id,
      });
  }

  // Commit lazy expiry before any later rejected action rolls back its transaction.
  private async refreshExpiry(actor: string, id?: string) {
    await this.repository.transaction(async (client) => {
      await lockProposalBoundary(client);
      await this.repository.lockParticipants(client, [actor]);
      await this.permissions.assertUnrestricted(client, [actor]);
      const ids = id ? [id] : await this.repository.expiringIds(client, actor);
      for (const tradeId of ids) {
        const trade = await this.repository.lockTrade(client, tradeId, actor);
        if (
          trade?.status === 'proposed' &&
          (await this.repository.expired(client, tradeId))
        )
          await this.close(client, tradeId, actor, 'expired');
      }
    });
  }

  async transition(
    actor: string,
    id: string,
    action: 'decline' | 'cancel' | 'expire',
    input: TradeTransition,
  ) {
    await this.refreshExpiry(actor, id);
    const result = await this.repository.transaction(async (client) => {
      await lockProposalBoundary(client);
      await this.repository.lockParticipants(client, [actor]);
      await this.permissions.assertUnrestricted(client, [actor]);
      const trade = await this.repository.lockTrade(client, id, actor);
      if (!trade)
        throw new SafetyError(
          404,
          'TRADE_UNAVAILABLE',
          'This trade is unavailable.',
        );
      if (trade.current_version !== input.expectedVersion)
        throw new SafetyError(
          409,
          'STALE_PROPOSAL',
          'The proposal changed. Reload its terms.',
        );
      if (
        trade.status === 'proposed' &&
        (await this.repository.expired(client, id))
      ) {
        await this.close(client, id, actor, 'expired');
        if (action !== 'expire')
          return new SafetyError(
            409,
            'PROPOSAL_EXPIRED',
            'This proposal has expired.',
          );
        return tradeTransitionResultSchema.parse({
          id,
          currentVersion: trade.current_version,
          status: 'expired',
        });
      }
      const status =
        action === 'decline'
          ? 'declined'
          : action === 'cancel'
            ? 'cancelled'
            : 'expired';
      if (trade.status !== status) {
        if (input.expectedStatus && trade.status !== input.expectedStatus)
          throw new SafetyError(
            409,
            'STALE_TRADE_STATUS',
            'The trade status changed. Reload it before acting.',
          );
        if (
          (trade.status !== 'proposed' &&
            !(trade.status === 'confirmed' && action === 'cancel')) ||
          (action === 'expire' && !(await this.repository.expired(client, id)))
        )
          throw new SafetyError(
            409,
            'TERMS_FROZEN',
            'This trade cannot be changed.',
          );
        if (await this.repository.hasHandover(client, id))
          throw new SafetyError(
            409,
            'HANDOVER_RECORDED',
            'This trade has a recorded handover and cannot be cancelled.',
          );
        await this.permissions.authorizeWrite(client, actor, 'trade');
        await this.close(client, id, actor, status);
      }
      return tradeTransitionResultSchema.parse({
        id,
        currentVersion: trade.current_version,
        status,
      });
    });
    if (result instanceof SafetyError) throw result;
    return result;
  }

  async outcome(
    actor: string,
    id: string,
    input: TradeReceiptSubmission | TradeProblemSubmission,
  ) {
    return this.repository.transaction(async (client) => {
      await lockProposalBoundary(client);
      await this.repository.lockParticipants(client, [actor]);
      await this.permissions.assertUnrestricted(client, [actor]);
      const trade = await this.repository.lockTrade(client, id, actor);
      if (!trade)
        throw new SafetyError(
          404,
          'TRADE_UNAVAILABLE',
          'This trade is unavailable.',
        );
      const kind = 'kind' in input ? input.kind : 'receipt';
      const reason = 'reason' in input ? input.reason : null;
      const previous = await this.repository.outcomeOperation(
        client,
        actor,
        input.operationKey,
      );
      if (
        previous &&
        (previous.trade_id !== id ||
          previous.version !== input.expectedVersion ||
          previous.kind !== kind ||
          previous.reason !== reason)
      )
        throw new SafetyError(
          409,
          'OPERATION_CONFLICT',
          'This operation key was used for a different request.',
        );
      if (trade.current_version !== input.expectedVersion)
        throw new SafetyError(
          409,
          'STALE_PROPOSAL',
          'The proposal changed. Reload its terms.',
        );
      if (!previous) {
        const received =
          kind === 'receipt' &&
          (await this.repository.hasReceipt(client, id, actor));
        if (
          trade.status !== 'confirmed' &&
          trade.status !== 'disputed' &&
          !(received && trade.status === 'completed')
        )
          throw new SafetyError(
            409,
            'TERMS_FROZEN',
            'This trade cannot be changed.',
          );
        const terms = await this.repository.acceptanceTerms(
          client,
          id,
          trade.current_version,
        );
        if (!terms.version?.participant_ids.includes(actor))
          throw new SafetyError(
            404,
            'TRADE_UNAVAILABLE',
            'This trade is unavailable.',
          );
        await this.permissions.authorizeWrite(
          client,
          actor,
          kind === 'receipt' ? 'trade' : 'report',
        );
        await this.repository.recordOutcomeOperation(
          client,
          actor,
          id,
          input,
          kind,
          reason,
        );
        if (kind === 'receipt') {
          if (!received)
            await this.repository.outcomeEvent(
              client,
              id,
              actor,
              'receipt_acknowledged',
            );
          // A report freezes ordinary completion as well as release, even after all receipts.
          if (
            trade.status === 'confirmed' &&
            (await this.repository.allReceipts(client, id))
          ) {
            await this.repository.markOutcome(client, id, 'completed');
            await this.notifyOutcome(client, id, actor, 'completed');
          }
        } else {
          if (kind === 'partial_handover')
            await this.repository.outcomeEvent(
              client,
              id,
              actor,
              'handover_reported',
            );
          await this.repository.markOutcome(client, id, 'disputed');
          await this.notifyOutcome(client, id, actor, 'disputed');
        }
      }
      const current = await this.repository.lockTrade(client, id, actor);
      return tradeOutcomeResultSchema.parse({
        id,
        currentVersion: current!.current_version,
        status: current!.status,
      });
    });
  }

  private async notifyOutcome(
    client: PoolClient,
    id: string,
    actor: string,
    status: 'completed' | 'disputed',
  ) {
    const eventId = await this.repository.outcomeEvent(
      client,
      id,
      actor,
      status,
    );
    for (const recipientId of await this.repository.participantIds(client, id))
      await createNotification(client, {
        recipient_id: recipientId,
        domain_event_id: eventId,
        event_type: 'trade_status',
        resource_type: 'trade',
        resource_id: id,
      });
  }

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
        const existing = await this.repository.lockTrade(
          client,
          previous.id,
          actor,
        );
        if (
          existing?.status === 'proposed' &&
          (await this.repository.expired(client, previous.id))
        ) {
          await this.close(client, previous.id, actor, 'expired');
          previous.status = 'expired';
        }
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
    await this.refreshExpiry(actor, id);
    const result = await this.repository.transaction(async (client) => {
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
        trade.status === 'proposed' &&
        (await this.repository.expired(client, id))
      ) {
        await this.close(client, id, actor, 'expired');
        return new SafetyError(
          409,
          'PROPOSAL_EXPIRED',
          'This proposal has expired.',
        );
      }

      if (trade.status !== 'proposed')
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

      if (await this.repository.expired(client, id)) {
        await this.close(client, id, actor, 'expired');
        return new SafetyError(
          409,
          'PROPOSAL_EXPIRED',
          'This proposal has expired.',
        );
      }
      await this.permissions.authorizeWrite(client, actor, 'trade');

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
    if (result instanceof SafetyError) throw result;
    return result;
  }

  async accept(actor: string, id: string, input: TradeAcceptance) {
    await this.refreshExpiry(actor, id);
    const result = await this.repository.transaction(async (client) => {
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
      ) {
        await this.permissions.authorizeWrite(client, actor, 'trade');
        return this.repository.saveAcceptanceOperation(
          client,
          actor,
          input.operationKey,
          id,
          input.expectedVersion,
          'confirmed',
        );
      }
      if (trade.status === 'expired')
        throw new SafetyError(
          409,
          'PROPOSAL_EXPIRED',
          'This proposal has expired.',
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
      ) {
        await this.close(client, id, actor, 'expired');
        return new SafetyError(
          409,
          'PROPOSAL_EXPIRED',
          'This proposal has expired.',
        );
      }

      await this.permissions.authorizeWrite(client, actor, 'trade');

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
    if (result instanceof SafetyError) throw result;
    return result;
  }

  async version(actor: string, id: string, version: number) {
    await this.refreshExpiry(actor, id);
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
    await this.refreshExpiry(actor);
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
    await this.refreshExpiry(actor, id);
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
