import type { NotificationsRepository } from './notifications.repository.js';
import {
  SafetyError,
  SafetyPermissions,
} from '../safety/safety.permissions.js';

export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly permissions = new SafetyPermissions(),
  ) {}

  async markRead(actor: string, ids: string[]) {
    return this.repository.transaction(async (client) => {
      await this.permissions.lockPair(client, actor, actor);
      await this.permissions.assertUnrestricted(client, [actor]);

      // Validate the entire bounded set before writing. Missing and other-owner
      // IDs have the same error; mixed sets cannot acknowledge even one record.
      if (!(await this.repository.owned(client, actor, ids)))
        throw new SafetyError(
          403,
          'NOTIFICATION_UNAVAILABLE',
          'This notification is unavailable.',
        );

      return this.repository.markRead(client, actor, ids);
    });
  }
}
