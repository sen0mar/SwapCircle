import type { ProfileUpdate } from '@swapcircle/contracts';
import { ProfilesRepository } from './profiles.repository.js';

export class ProfilesService {
  constructor(private readonly repository: ProfilesRepository) {}

  async current(userId: string) {
    await this.repository.provision(userId);

    return this.repository.profile(userId);
  }

  update(userId: string, input: ProfileUpdate) {
    return this.repository.update(userId, input);
  }

  interests() {
    return this.repository.interests();
  }

  publicProfile(userId: string) {
    return this.repository.publicProfile(userId);
  }
}
