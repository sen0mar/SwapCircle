import type { ProfileUpdate } from '@swapcircle/contracts';
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

  async uploadAvatar(userId: string, input: Buffer) {
    if (!this.storage) throw new Error('Avatar storage unavailable.');
    await this.repository.provision(userId);
    const { processed } = await processPhoto(input);
    const key = `avatars/${userId}/${randomUUID()}.webp`;
    try {
      await this.storage.upload(key, processed);
    } catch {
      await this.storage.remove(key).catch(() => {});
      throw new PhotoError(
        503,
        'PHOTO_STORAGE_UNAVAILABLE',
        'The avatar could not be saved. Try again.',
      );
    }
    try {
      const previous = await this.repository.swapAvatar(userId, key);
      if (previous) await this.storage.remove(previous).catch(() => {});
    } catch (error) {
      await this.storage.remove(key).catch(() => {});
      throw error;
    }
    return this.current(userId);
  }

  async removeAvatar(userId: string) {
    const previous = await this.repository.swapAvatar(userId, null);
    if (previous && this.storage)
      await this.storage.remove(previous).catch(() => {});
    return this.current(userId);
  }
}
