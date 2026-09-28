import type {
  MemberQuery,
  MemberCursor,
  ProfileUpdate,
} from '@swapcircle/contracts';
import { ProfilesRepository } from './profiles.repository.js';
import type { PhotoStorage } from '../photos/photos.storage.js';
import { PhotoError, processPhoto } from '../photos/photos.service.js';
import { randomUUID } from 'node:crypto';

export class ProfilesService {
  constructor(
    private readonly repository: ProfilesRepository,
    private readonly storage?: PhotoStorage,
  ) {}

  private present<
    T extends { avatarStorageKey: string | null; avatarUrl: string | null },
  >(profile: T | null) {
    if (!profile) return null;
    const { avatarStorageKey, ...publicFields } = profile;
    return {
      ...publicFields,
      avatarUrl:
        avatarStorageKey && this.storage
          ? this.storage.publicUrl(avatarStorageKey)
          : null,
    };
  }

  async current(userId: string) {
    await this.repository.provision(userId);

    return this.present(await this.repository.profile(userId));
  }

  async update(userId: string, input: ProfileUpdate) {
    return this.present(await this.repository.update(userId, input));
  }

  interests() {
    return this.repository.interests();
  }

  async publicProfile(userId: string) {
    return this.present(await this.repository.publicProfile(userId));
  }

  async discover(query: MemberQuery, actor?: string, cursor?: MemberCursor) {
    const rows = await this.repository.discover(query, actor, cursor);
    const items = rows.slice(0, query.limit).map((row) => this.present(row)!);
    const last = items.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? Buffer.from(
            JSON.stringify({
              id: last.id,
              sharedInterestCount: last.sharedInterestCount ?? 0,
            }),
          ).toString('base64url')
        : null;

    return { items, nextCursor };
  }

  async uploadAvatar(userId: string, input: Buffer) {
    if (!this.storage) throw new Error('Avatar storage unavailable.');
    await this.repository.provision(userId);
    const previous = await this.repository.avatarKey(userId);
    await this.repository.authorizeAvatarUpload(userId);
    const { processed } = await processPhoto(input);
    const key = `avatars/${userId}/${randomUUID()}.webp`;
    try {
      await this.storage.upload(key, processed);
    } catch {
      await this.cleanupUncommitted(userId, key);
      throw new PhotoError(
        503,
        'PHOTO_STORAGE_UNAVAILABLE',
        'The avatar could not be saved. Try again.',
      );
    }
    try {
      await this.repository.swapAvatar(userId, previous, key, false);
    } catch (error) {
      await this.cleanupUncommitted(userId, key);
      throw error;
    }
    await this.clearQueued(userId, false);
    return this.current(userId);
  }

  async removeAvatar(userId: string) {
    const previous = await this.repository.avatarKey(userId);
    await this.repository.swapAvatar(userId, previous, null);
    await this.clearQueued(userId, false);
    return this.current(userId);
  }

  async retryAvatarCleanup(userId: string) {
    await this.repository.checkAvatarCleanup(userId);
    await this.clearQueued(userId, true);
    return this.current(userId);
  }

  private async cleanupUncommitted(userId: string, key: string) {
    try {
      await this.storage?.remove(key);
    } catch {
      await this.repository.queueAvatarCleanup(userId, key);
    }
  }

  private async clearQueued(userId: string, strict: boolean) {
    if (!this.storage) throw new Error('Avatar storage unavailable.');
    for (const key of await this.repository.pendingAvatarCleanup(userId)) {
      try {
        await this.storage.remove(key);
        await this.repository.finishAvatarCleanup(userId, key);
      } catch {
        if (strict)
          throw new PhotoError(
            503,
            'PHOTO_STORAGE_UNAVAILABLE',
            'The previous avatar could not be removed. Try again.',
          );
      }
    }
  }
}
