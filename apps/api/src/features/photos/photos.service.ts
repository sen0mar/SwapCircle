import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { PhotosRepository, PhotoRow } from './photos.repository.js';
import type { PhotoStorage } from './photos.storage.js';

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;

export class PhotoError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class PhotosService {
  private processing = 0;

  constructor(
    private readonly repository: PhotosRepository,
    private readonly storage: PhotoStorage,
  ) {}

  private present(row: PhotoRow) {
    return {
      id: row.id,
      listingId: row.listingId,
      position: row.position,
      width: row.width!,
      height: row.height!,
      bytes: row.bytes!,
      url: this.storage.publicUrl(row.storageKey),
    };
  }

  async list(listingId: string) {
    return (await this.repository.active(listingId)).map((row) =>
      this.present(row),
    );
  }

  private async checkOwner(actor: string, listingId: string) {
    return this.repository.transaction(async (client) => {
      const listing = await this.repository.owner(client, listingId);

      if (!listing || listing.ownerId !== actor)
        throw new PhotoError(404, 'NOT_FOUND', 'Listing not found.');

      if (await this.repository.restricted(client, actor))
        throw new PhotoError(
          403,
          'ACCOUNT_RESTRICTED',
          'This account cannot change photos.',
        );

      if (listing.availability !== 'available')
        throw new PhotoError(
          409,
          'LISTING_UNAVAILABLE',
          'This listing cannot be changed.',
        );
    });
  }

  async upload(actor: string, listingId: string, input: Buffer) {
    await this.checkOwner(actor, listingId);

    if (
      !Buffer.isBuffer(input) ||
      input.length === 0 ||
      input.length > MAX_INPUT_BYTES
    )
      throw new PhotoError(
        413,
        'PHOTO_TOO_LARGE',
        'Choose an image smaller than 5 MB.',
      );

    if (this.processing >= 2)
      throw new PhotoError(
        429,
        'PHOTO_BUSY',
        'Image processing is busy. Try again.',
      );

    this.processing++;
    let processed: Buffer;
    let width: number;
    let height: number;

    try {
      const decoder = sharp(input, {
        limitInputPixels: MAX_PIXELS,
        failOn: 'error',
        animated: false,
      });
      const metadata = await decoder.metadata();

      if (
        !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > MAX_PIXELS ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error('Unsupported image.');

      const output = await sharp(input, {
        limitInputPixels: MAX_PIXELS,
        failOn: 'error',
      })
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer({ resolveWithObject: true });

      processed = output.data;
      width = output.info.width;
      height = output.info.height;

      if (processed.length > MAX_OUTPUT_BYTES)
        throw new PhotoError(
          413,
          'PHOTO_TOO_LARGE',
          'The processed image is too large.',
        );
    } catch (error) {
      if (error instanceof PhotoError) throw error;
      throw new PhotoError(
        415,
        'INVALID_PHOTO',
        'Choose a valid JPEG, PNG, or WebP image.',
      );
    } finally {
      this.processing--;
    }

    const key = `${listingId}/${randomUUID()}.webp`;
    const reserved = await this.repository.transaction(async (client) => {
      const listing = await this.repository.owner(client, listingId);

      if (!listing || listing.ownerId !== actor)
        throw new PhotoError(404, 'NOT_FOUND', 'Listing not found.');

      if (await this.repository.restricted(client, actor))
        throw new PhotoError(
          403,
          'ACCOUNT_RESTRICTED',
          'This account cannot change photos.',
        );

      if (listing.availability !== 'available')
        throw new PhotoError(
          409,
          'LISTING_UNAVAILABLE',
          'This listing cannot be changed.',
        );

      const occupied = await this.repository.occupied(client, listingId);
      const position = [0, 1, 2].find((slot) => !occupied.includes(slot));

      if (position === undefined)
        throw new PhotoError(
          409,
          'PHOTO_LIMIT',
          'An item can have at most three photos.',
        );

      return this.repository.reserve(client, listingId, actor, key, position);
    });

    try {
      await this.storage.upload(key, processed);
      const active = await this.repository.activate(
        reserved.id,
        width,
        height,
        processed.length,
      );

      if (!active) throw new Error('Photo reservation changed.');

      return this.present(active);
    } catch {
      // The pending row remains a discoverable cleanup handle if Storage removal fails.
      try {
        await this.storage.remove(key);
        await this.repository.drop(reserved.id);
      } catch {
        // Owner cleanup can retry removal of this hidden pending row.
      }

      throw new PhotoError(
        503,
        'PHOTO_STORAGE_UNAVAILABLE',
        'The photo could not be saved. Try again.',
      );
    }
  }

  async remove(
    actor: string,
    listingId: string,
    photoId: string,
    onlyAbandoned = false,
  ) {
    const photo = await this.repository.transaction(async (client) => {
      const listing = await this.repository.owner(client, listingId);

      if (!listing || listing.ownerId !== actor)
        throw new PhotoError(404, 'NOT_FOUND', 'Photo not found.');

      if (await this.repository.restricted(client, actor))
        throw new PhotoError(
          403,
          'ACCOUNT_RESTRICTED',
          'This account cannot change photos.',
        );

      const row = await this.repository.lockPhoto(client, listingId, photoId);

      if (!row) throw new PhotoError(404, 'NOT_FOUND', 'Photo not found.');

      if (onlyAbandoned && row.state === 'active') return null;

      if (row.state === 'active' && listing.availability !== 'available')
        throw new PhotoError(
          409,
          'LISTING_UNAVAILABLE',
          'This listing cannot be changed.',
        );

      await this.repository.markDeleting(client, row.id);
      return row;
    });

    if (!photo) return;

    try {
      await this.storage.remove(photo.storageKey);
      await this.repository.drop(photo.id);
    } catch {
      throw new PhotoError(
        503,
        'PHOTO_STORAGE_UNAVAILABLE',
        'The photo could not be removed. Try again.',
      );
    }
  }

  async cleanup(actor: string, listingId: string) {
    await this.repository.transaction(async (client) => {
      const listing = await this.repository.owner(client, listingId);

      if (!listing || listing.ownerId !== actor)
        throw new PhotoError(404, 'NOT_FOUND', 'Listing not found.');

      if (await this.repository.restricted(client, actor))
        throw new PhotoError(
          403,
          'ACCOUNT_RESTRICTED',
          'This account cannot change photos.',
        );
    });

    for (const row of await this.repository.abandoned(listingId)) {
      try {
        await this.remove(actor, listingId, row.id, true);
      } catch (error) {
        if (!(error instanceof PhotoError && error.code === 'NOT_FOUND'))
          throw error;
      }
    }
  }
}
