import type { PoolClient } from 'pg';
import {
  messageProposalSchema,
  messageProposalStateSchema,
  acceptedProposalPageSchema,
} from '@swapcircle/contracts';
import { lockProposalBoundary } from '../trades/proposal-boundary.js';
import { isDeepStrictEqual } from 'node:util';
import type { MessageProposal } from '@swapcircle/contracts';
import { createHash } from 'node:crypto';
import { processPhoto, PhotoError } from '../photos/photos.service.js';
import type { TradeMessageSubmission } from '@swapcircle/contracts';
import { createNotification } from '../notifications/notifications.repository.js';
import type {
  MessageSubmission,
  ConversationReadUpdate,
} from '@swapcircle/contracts';
import type { ConversationsRepository } from './conversations.repository.js';
import {
  SafetyError,
  SafetyPermissions,
} from '../safety/safety.permissions.js';

export class ConversationsService {
  constructor(
    private readonly repository: ConversationsRepository,
    private readonly permissions = new SafetyPermissions(),
  ) {}

  async unread(actor: string, id: string, message?: string) {
    return this.repository.transaction(async (client) => {
      await this.permissions.lockPair(client, actor, actor);
      await this.permissions.assertUnrestricted(client, [actor]);
      const members = await this.repository.activeMembers(client, id);
      if (
        !members.includes(actor) ||
        !(await this.repository.lockReader(client, actor, id))
      )
        throw new SafetyError(
          403,
          'CONVERSATION_UNAVAILABLE',
          'This conversation is unavailable.',
        );

      if (
        message &&
        !(await this.repository.advanceRead(client, actor, id, message))
      )
        throw new SafetyError(
          403,
          'CONVERSATION_UNAVAILABLE',
          'This conversation is unavailable.',
        );
      return this.repository.readState(client, actor, id);
    });
  }

  async markRead(actor: string, input: ConversationReadUpdate) {
    return this.unread(actor, input.conversation_id, input.message_id);
  }

  async send(
    actor: string,
    input: MessageSubmission,
    photo?: { sourceDigest: string; photoBase64: string },
    proposal?: MessageProposal,
  ) {
    return this.repository.transaction(async (client) => {
      // Identity is immutable. Read it without a row lock so every path takes
      // ordered account locks first, then its conversation lock. The actor lock
      // also serializes sender-wide retry keys across different conversations.
      const conversation = await this.repository.identity(
        client,
        input.conversation_id,
      );
      if (!conversation)
        throw new SafetyError(
          403,
          'CONVERSATION_UNAVAILABLE',
          'This conversation is unavailable.',
        );

      const other =
        actor === conversation.direct_user_low
          ? conversation.direct_user_high
          : conversation.direct_user_low;
      await this.permissions.assertContactAllowed(client, actor, other);

      const members = await this.repository.activeMembers(
        client,
        input.conversation_id,
      );
      if (!members.includes(actor) || members.length !== 2)
        throw new SafetyError(
          403,
          'CONVERSATION_UNAVAILABLE',
          'This conversation is unavailable.',
        );

      const previous = await this.repository.retryMessage(
        client,
        actor,
        input.client_message_id,
      );
      if (
        previous &&
        (previous.conversation_id !== input.conversation_id ||
          previous.body !== input.body)
      )
        throw new SafetyError(
          409,
          'MESSAGE_RETRY_CONFLICT',
          'Use a new message reference for different content or conversation.',
        );

      if (previous?.proposal && !isDeepStrictEqual(previous.proposal, proposal))
        throw new SafetyError(
          409,
          'MESSAGE_RETRY_CONFLICT',
          'Use a new message reference for different proposal details.',
        );

      if (previous && (previous.has_photo || photo)) {
        const savedPhoto = await this.repository.photo(client, previous.id);
        if (savedPhoto?.source_digest !== photo?.sourceDigest)
          throw new SafetyError(
            409,
            'MESSAGE_RETRY_CONFLICT',
            'Use a new message reference for a different photo.',
          );
      }

      // Every authorized attempt, including retries, is limited. A rejected send
      // rolls back its quota change together with any position/message insertion.
      await this.permissions.consume(client, actor, 'message');
      return (
        previous ??
        (await this.repository.insertMessage(
          client,
          actor,
          input,
          photo,
          proposal,
        ))
      );
    });
  }

  async sendProposal(actor: string, input: TradeMessageSubmission) {
    const listing = await this.repository.proposalListing(input.listingId);
    if (
      !listing ||
      listing.owner_id === actor ||
      listing.availability !== 'available'
    )
      throw new SafetyError(
        409,
        'LISTING_UNAVAILABLE',
        'This item is no longer available for a proposal.',
      );

    const conversation = await this.startDirect(actor, listing.owner_id);
    let photo: { sourceDigest: string; photoBase64: string } | undefined;

    if (input.photoBase64 !== undefined) {
      // Charge processing attempts durably before decoding. Send rechecks contact and membership.
      await this.repository.transaction(async (client) => {
        await this.permissions.assertContactAllowed(
          client,
          actor,
          listing.owner_id,
        );
        await this.permissions.consume(client, actor, 'photo');
      });
      const bytes = Buffer.from(input.photoBase64, 'base64');
      try {
        const { processed } = await processPhoto(bytes);
        photo = {
          sourceDigest: createHash('sha256').update(bytes).digest('hex'),
          photoBase64: processed.toString('base64'),
        };
      } catch (error) {
        if (error instanceof PhotoError)
          throw new SafetyError(error.status, error.code, error.message);
        throw error;
      }
    }

    const quality = input.condition
      ? `Offered item quality: ${{ like_new: 'Like new', good: 'Good', fair: 'Fair', poor: 'Poor' }[input.condition]}\n\n`
      : '';

    return this.send(
      actor,
      {
        conversation_id: conversation.id,
        body: `About “${listing.title}”\n\n${quality}${input.body}`,
        client_message_id: input.clientMessageId,
      },
      photo,
      {
        listingId: input.listingId,
        listingTitle: listing.title,
        message: input.body,
        ...(input.condition ? { condition: input.condition } : {}),
      },
    );
  }

  private async proposalContext(
    client: PoolClient,
    actor: string,
    messageId: string,
  ) {
    const message = await this.repository.proposalMessage(client, messageId);
    const conversation =
      message &&
      (await this.repository.identity(client, message.conversation_id));
    if (
      !message ||
      !conversation ||
      conversation.type !== 'direct' ||
      ![conversation.direct_user_low, conversation.direct_user_high].includes(
        actor,
      )
    )
      throw new SafetyError(
        404,
        'PROPOSAL_UNAVAILABLE',
        'This proposal is unavailable.',
      );
    const proposal = messageProposalSchema.parse(message.proposal);
    const recipientId =
      message.sender_id === conversation.direct_user_low
        ? conversation.direct_user_high!
        : conversation.direct_user_low!;
    return { message, proposal, recipientId };
  }

  async proposalState(actor: string, messageId: string) {
    return this.repository.transaction(async (client) => {
      await this.permissions.lockPair(client, actor, actor);
      await this.permissions.assertUnrestricted(client, [actor]);
      const { message, recipientId } = await this.proposalContext(
        client,
        actor,
        messageId,
      );
      if (
        !(await this.repository.lockReader(
          client,
          actor,
          message.conversation_id,
        ))
      )
        throw new SafetyError(
          403,
          'PROPOSAL_UNAVAILABLE',
          'This proposal is unavailable.',
        );
      const previous = await this.repository.proposalDecision(
        client,
        messageId,
      );
      return messageProposalStateSchema.parse({
        messageId,
        conversationId: message.conversation_id,
        recipientId,
        status: previous?.decision ?? 'pending',
        respondedAt: previous?.respondedAt ?? null,
      });
    });
  }

  async respondToProposal(
    actor: string,
    messageId: string,
    action: 'accept' | 'refuse',
  ) {
    return this.repository.transaction(async (client) => {
      await lockProposalBoundary(client);
      const { message, proposal, recipientId } = await this.proposalContext(
        client,
        actor,
        messageId,
      );
      if (actor !== recipientId)
        throw new SafetyError(
          403,
          'RECIPIENT_ONLY',
          'Only the recipient can respond to this proposal.',
        );
      await this.permissions.assertContactAllowed(
        client,
        message.sender_id,
        recipientId,
      );
      const previous = await this.repository.proposalDecision(
        client,
        messageId,
      );
      const target =
        !previous && action === 'accept'
          ? await this.repository.proposalTarget(client, proposal.listingId)
          : undefined;
      const members = await this.repository.activeMembers(
        client,
        message.conversation_id,
      );
      if (
        members.length !== 2 ||
        !members.includes(actor) ||
        !members.includes(message.sender_id)
      )
        throw new SafetyError(
          403,
          'PROPOSAL_UNAVAILABLE',
          'This proposal is unavailable.',
        );
      const decision = action === 'accept' ? 'accepted' : 'refused';
      if (previous && previous.decision !== decision)
        throw new SafetyError(
          409,
          'PROPOSAL_ALREADY_RESPONDED',
          'This proposal has already been answered.',
        );
      await this.permissions.consume(client, actor, 'trade');
      if (
        !previous &&
        action === 'accept' &&
        (!target ||
          target.owner_id !== actor ||
          target.availability !== 'available')
      )
        throw new SafetyError(
          409,
          'LISTING_UNAVAILABLE',
          'The requested item is no longer available.',
        );
      if (
        !previous &&
        action === 'accept' &&
        target &&
        target.updated_at.getTime() > Date.parse(message.created_at)
      )
        throw new SafetyError(
          409,
          'PROPOSAL_ITEM_CHANGED',
          'The requested item changed after this proposal was sent. Ask for a new proposal.',
        );
      const saved =
        previous ??
        (await this.repository.insertProposalDecision(
          client,
          actor,
          messageId,
          decision,
        ));
      if (!previous)
        await createNotification(client, {
          recipient_id: message.sender_id,
          domain_event_id: saved.id,
          event_type: 'proposal_response',
          resource_type: 'conversation',
          resource_id: message.conversation_id,
        });
      return messageProposalStateSchema.parse({
        messageId,
        conversationId: message.conversation_id,
        recipientId,
        status: saved.decision,
        respondedAt: saved.respondedAt,
      });
    });
  }

  async acceptedProposals(
    actor: string,
    input: {
      limit: number;
      before?: string | undefined;
      beforeId?: string | undefined;
    },
  ) {
    return this.repository.transaction(async (client) => {
      await this.permissions.lockPair(client, actor, actor);
      await this.permissions.assertUnrestricted(client, [actor]);
      return acceptedProposalPageSchema.parse(
        await this.repository.acceptedProposals(client, actor, input),
      );
    });
  }

  async readPhoto(actor: string, messageId: string) {
    return this.repository.transaction(async (client) => {
      await this.permissions.lockPair(client, actor, actor);
      await this.permissions.assertUnrestricted(client, [actor]);
      const id = await this.repository.messageConversation(client, messageId);
      if (!id || !(await this.repository.lockReader(client, actor, id)))
        throw new SafetyError(
          403,
          'CONVERSATION_UNAVAILABLE',
          'This conversation is unavailable.',
        );
      const photo = await this.repository.photo(client, messageId);
      if (!photo) throw new SafetyError(404, 'NOT_FOUND', 'Photo not found.');
      return { dataUrl: `data:image/webp;base64,${photo.photo_base64}` };
    });
  }

  async startDirect(actor: string, other: string) {
    if (actor === other)
      throw new SafetyError(
        400,
        'INVALID_CONVERSATION',
        'Choose another member.',
      );

    return this.repository.transaction(async (client) => {
      await this.permissions.assertContactAllowed(client, actor, other);

      if (!(await this.repository.memberExists(client, other)))
        throw new SafetyError(404, 'NOT_FOUND', 'Member not found.');

      const [low, high] = [actor, other].sort() as [string, string];
      const existing = await this.repository.findDirect(client, low, high);

      if (existing) {
        if (!existing.active)
          throw new SafetyError(
            403,
            'CONVERSATION_UNAVAILABLE',
            'This conversation is unavailable.',
          );

        return { id: existing.id, type: 'direct' as const };
      }

      await this.permissions.authorizeWrite(client, actor, 'conversation');
      const id = await this.repository.createDirect(client, low, high);
      return { id, type: 'direct' as const };
    });
  }
}
