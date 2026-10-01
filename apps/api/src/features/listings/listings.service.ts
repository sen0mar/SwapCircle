import { lockProposalBoundary } from '../trades/proposal-boundary.js';
import { createNotification } from '../notifications/notifications.repository.js';
import type {
  CatalogQuery,
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
      await this.repository.permissions.authorizeWrite(
        client,
        actor,
        'listing',
      );

      return this.repository.create(client, actor, input);
    });
  }

  change(actor: string, id: string, revision: number, input?: ListingUpdate) {
    return this.repository.transaction(async (client) => {
      await lockProposalBoundary(client);
      await this.repository.permissions.lockPair(client, actor, actor);
      await this.repository.permissions.authorizeWrite(
        client,
        actor,
        'listing',
      );

      const listing = await this.repository.lock(client, id);

      if (!listing || listing.ownerId !== actor)
        throw new ListingError(404, 'NOT_FOUND', 'Listing not found.');

      // Future trade transitions must lock this same row in their atomic transaction.
      // No ordinary edit or withdrawal can override a trade-controlled state.
      if (
        listing.availability !== 'available' ||
        (await this.repository.frozenTerms(client, id))
      )
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

      if (
        input &&
        listing.title === input.title &&
        listing.description === input.description &&
        listing.condition === input.condition
      )
        return listing;

      const changed = input
        ? await this.repository.edit(client, id, input)
        : await this.repository.withdraw(client, id);
      const revisions = await this.repository.reviseProposals(
        client,
        id,
        actor,
      );
      for (const revision of revisions)
        for (const recipientId of revision.participants)
          if (recipientId !== actor)
            await createNotification(client, {
              recipient_id: recipientId,
              domain_event_id: revision.eventId,
              event_type: 'trade_revision',
              resource_type: 'trade',
              resource_id: revision.tradeId,
            });

      return changed;
    });
  }

  async publicListing(id: string) {
    const listing = await this.repository.publicListing(id);

    if (!listing)
      throw new ListingError(404, 'NOT_FOUND', 'Listing not found.');

    return listing;
  }

  async page(query: CatalogQuery, cursor?: ListingCursor) {
    const rows = await this.repository.page(query, cursor);
    return this.makePage(rows, query.limit);
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
