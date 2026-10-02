import { randomUUID } from 'node:crypto';
import {
  coffeeEligibilitySchema,
  type CoffeeSend,
  type CoffeeResponse,
} from '@swapcircle/contracts';
import type { PoolClient } from 'pg';
import {
  SafetyError,
  SafetyPermissions,
} from '../safety/safety.permissions.js';
import { createNotification } from '../notifications/notifications.repository.js';
import { lockProposalBoundary } from '../trades/proposal-boundary.js';
import type { CoffeeRepository } from './coffee.repository.js';

export class CoffeeService {
  constructor(
    private readonly repository: CoffeeRepository,
    private readonly permissions = new SafetyPermissions(),
  ) {}

  private async authorize(
    client: PoolClient,
    actor: string,
    tradeId: string,
    other?: string,
  ) {
    await this.permissions.assertUnrestricted(client, [actor]);
    const trade = await this.repository.trades.lockTrade(
      client,
      tradeId,
      actor,
    );
    if (!trade)
      throw new SafetyError(
        404,
        'TRADE_UNAVAILABLE',
        'This trade is unavailable.',
      );

    if (
      other === actor ||
      (other &&
        !(
          await this.repository.trades.participantIds(client, tradeId)
        ).includes(other))
    )
      throw new SafetyError(
        422,
        'COFFEE_PAIR_INVALID',
        'Choose another participant in this trade.',
      );

    return trade;
  }

  private async eligible(
    client: PoolClient,
    actor: string,
    other: string,
    tradeId: string,
  ) {
    await this.permissions.assertContactAllowed(client, actor, other);
    const sharedInterests = await this.repository.sharedInterests(
      client,
      actor,
      other,
    );
    return coffeeEligibilitySchema.parse({
      tradeId,
      inviterId: actor,
      inviteeId: other,
      eligible: sharedInterests.length >= 2,
      sharedInterests,
    });
  }

  private async requireEligibility(
    client: PoolClient,
    actor: string,
    other: string,
    tradeId: string,
  ) {
    if (!(await this.eligible(client, actor, other, tradeId)).eligible)
      throw new SafetyError(
        409,
        'COFFEE_INELIGIBLE',
        'Coffee requires at least two shared interests.',
      );
  }

  async eligibility(actor: string, tradeId: string, other: string) {
    return this.repository.trades.transaction(async (client) => {
      await lockProposalBoundary(client);
      await this.permissions.lockPair(client, actor, other);
      await this.authorize(client, actor, tradeId, other);
      return this.eligible(client, actor, other, tradeId);
    });
  }

  async read(actor: string, id: string) {
    return this.repository.trades.transaction(async (client) => {
      await lockProposalBoundary(client);
      const invitation = await this.repository.invitation(client, id);
      if (!invitation)
        throw new SafetyError(
          404,
          'COFFEE_UNAVAILABLE',
          'This invitation is unavailable.',
        );

      await this.authorize(client, actor, invitation.tradeId);
      return invitation;
    });
  }

  async list(actor: string, tradeId: string) {
    return this.repository.trades.transaction(async (client) => {
      await lockProposalBoundary(client);
      await this.authorize(client, actor, tradeId);
      return this.repository.list(client, tradeId);
    });
  }

  async send(actor: string, tradeId: string, input: CoffeeSend) {
    return this.repository.trades.transaction(async (client) => {
      await lockProposalBoundary(client);
      await this.repository.trades.lockOperation(
        client,
        actor,
        input.operationKey,
      );
      await this.permissions.lockPair(client, actor, input.inviteeId);
      const trade = await this.authorize(
        client,
        actor,
        tradeId,
        input.inviteeId,
      );
      const previousId = await this.repository.operation(
        client,
        actor,
        input.operationKey,
      );
      if (previousId) {
        const previous = (await this.repository.invitation(
          client,
          previousId,
        ))!;
        if (
          previous.tradeId !== tradeId ||
          previous.inviteeId !== input.inviteeId ||
          previous.offerToPay !== input.offerToPay
        )
          throw new SafetyError(
            409,
            'OPERATION_CONFLICT',
            'This operation key was used for another invitation.',
          );
        return previous;
      }

      this.assertOpen(trade);
      await this.requireEligibility(client, actor, input.inviteeId, tradeId);
      if (
        await this.repository.activePair(
          client,
          tradeId,
          actor,
          input.inviteeId,
        )
      )
        throw new SafetyError(
          409,
          'COFFEE_ALREADY_INVITED',
          'This pair already has a coffee invitation.',
        );

      await this.permissions.authorizeWrite(client, actor, 'coffee');
      const invitation = await this.repository.insert(
        client,
        tradeId,
        actor,
        input.inviteeId,
        input.operationKey,
        input.offerToPay,
      );
      await createNotification(client, {
        recipient_id: input.inviteeId,
        domain_event_id: invitation.id,
        event_type: 'coffee_invitation',
        resource_type: 'coffee_invitation',
        resource_id: invitation.id,
      });
      return invitation;
    });
  }

  async respond(
    actor: string,
    tradeId: string,
    id: string,
    input: CoffeeResponse,
  ) {
    return this.repository.trades.transaction(async (client) => {
      await lockProposalBoundary(client);
      // Discover the pair before resource locks; the proposal boundary serializes
      // coffee writes and participant changes. Identity is checked before output.
      const invitations = await this.repository.list(client, tradeId);
      const found = invitations.find((invitation) => invitation.id === id);
      if (!found || ![found.inviterId, found.inviteeId].includes(actor))
        throw new SafetyError(
          404,
          'COFFEE_UNAVAILABLE',
          'This invitation is unavailable.',
        );

      await this.permissions.lockPair(client, found.inviterId, found.inviteeId);
      const trade = await this.authorize(client, actor, tradeId);
      const invitation = (await this.repository.invitation(client, id))!;
      if (input.action !== 'cancel' && actor !== invitation.inviteeId)
        throw new SafetyError(
          403,
          'COFFEE_RESPONSE_FORBIDDEN',
          'Only the invited member can respond.',
        );

      const status = {
        accept: 'accepted',
        decline: 'declined',
        cancel: 'cancelled',
      }[input.action] as 'accepted' | 'declined' | 'cancelled';
      if (invitation.status === status) return invitation;

      const canCancel =
        input.action === 'cancel' &&
        (invitation.status === 'accepted' ||
          (invitation.status === 'pending' && actor === invitation.inviterId));
      if (
        !canCancel &&
        (input.action === 'cancel' || invitation.status !== 'pending')
      )
        throw new SafetyError(
          409,
          'COFFEE_RESPONSE_CONFLICT',
          'This invitation changed. Reload its response.',
        );

      if (input.action === 'accept') {
        this.assertOpen(trade);
        const other =
          actor === invitation.inviteeId
            ? invitation.inviterId
            : invitation.inviteeId;
        await this.authorize(client, actor, tradeId, other);
        await this.requireEligibility(client, actor, other, tradeId);
      }
      await this.permissions.authorizeWrite(client, actor, 'coffee');
      const result = await this.repository.respond(client, id, status);
      await createNotification(client, {
        recipient_id:
          actor === invitation.inviterId
            ? invitation.inviteeId
            : invitation.inviterId,
        domain_event_id: randomUUID(),
        event_type: 'coffee_response',
        resource_type: 'coffee_invitation',
        resource_id: id,
      });
      return result;
    });
  }

  private assertOpen(trade: { status: string; expires_at: Date }) {
    if (
      !['proposed', 'confirmed'].includes(trade.status) ||
      (trade.status === 'proposed' && trade.expires_at.getTime() <= Date.now())
    )
      throw new SafetyError(
        409,
        'TRADE_UNAVAILABLE',
        'This trade is unavailable for coffee invitations.',
      );
  }
}
