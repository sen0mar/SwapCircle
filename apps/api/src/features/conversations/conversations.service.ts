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
