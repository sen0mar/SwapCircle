import type {
  ListingCreate,
  ListingCursor,
  ListingUpdate,
} from '@swapcircle/contracts';
import type { ListingsRepository } from './listings.repository.js';

export class ListingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ListingsService {
  constructor(private readonly repository: ListingsRepository) {}

  create(actor: string, input: ListingCreate) {
    return this.repository.transaction(async (client) => {
      if (await this.repository.restricted(client, actor))
        throw new ListingError(
          403,
          'ACCOUNT_RESTRICTED',
          'This account cannot change listings.',
        );

      return this.repository.create(client, actor, input);
    });
  }

  change(actor: string, id: string, revision: number, input?: ListingUpdate) {
    return this.repository.transaction(async (client) => {
      if (await this.repository.restricted(client, actor))
        throw new ListingError(
          403,
          'ACCOUNT_RESTRICTED',
          'This account cannot change listings.',
        );

      const listing = await this.repository.lock(client, id);

      if (!listing || listing.ownerId !== actor)
        throw new ListingError(404, 'NOT_FOUND', 'Listing not found.');

      // Future trade transitions must lock this same row in their atomic transaction.
      // No ordinary edit or withdrawal can override a trade-controlled state.
      if (listing.availability !== 'available')
        throw new ListingError(
          409,
          'LISTING_UNAVAILABLE',
          'This listing cannot be changed in its current state.',
        );

      if (listing.revision !== revision)
        throw new ListingError(
          409,
          'STALE_REVISION',
          'The listing changed. Reload it before trying again.',
        );

      return input
        ? this.repository.edit(client, id, input)
        : this.repository.withdraw(client, id);
    });
  }

  async publicListing(id: string) {
    const listing = await this.repository.publicListing(id);

    if (!listing)
      throw new ListingError(404, 'NOT_FOUND', 'Listing not found.');

    return listing;
  }

  async page(limit: number, cursor?: ListingCursor) {
    const rows = await this.repository.page(limit, cursor);
    return this.makePage(rows, limit);
  }

  async ownerPage(actor: string, limit: number, cursor?: ListingCursor) {
    const rows = await this.repository.ownerPage(actor, limit, cursor);
    return this.makePage(rows, limit);
  }

  private makePage(
    rows: Awaited<ReturnType<ListingsRepository['page']>>,
    limit: number,
  ) {
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ createdAt: last.createdAt, id: last.id }),
          ).toString('base64url')
        : null;

    return { items, nextCursor };
  }
}
