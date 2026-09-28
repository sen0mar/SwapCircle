import type { MessageSubmission } from '@swapcircle/contracts';
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

  async send(actor: string, input: MessageSubmission) {
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

      if (conversation.type === 'direct') {
        const other =
          actor === conversation.direct_user_low
            ? conversation.direct_user_high!
            : conversation.direct_user_low!;
        await this.permissions.assertContactAllowed(client, actor, other);
      } else {
        await this.permissions.lockPair(client, actor, actor);
        await this.permissions.assertUnrestricted(client, [actor]);
      }

      const members = await this.repository.activeMembers(
        client,
        input.conversation_id,
      );
      if (
        !members.includes(actor) ||
        (conversation.type === 'direct' && members.length !== 2)
      )
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

      // Every authorized attempt, including retries, is limited. A rejected send
      // rolls back its quota change together with any position/message insertion.
      await this.permissions.consume(client, actor, 'message');
      return (
        previous ?? (await this.repository.insertMessage(client, actor, input))
      );
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
