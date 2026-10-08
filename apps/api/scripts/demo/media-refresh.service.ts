import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const mediaHash = (body: Buffer) =>
  createHash('sha256').update(body).digest('hex');

export type MediaReplacement = {
  ownerId: string;
  storageKey: string;
  previousHash: string;
  body: Buffer;
  photoId?: string;
};

export interface MediaRefreshStorage {
  read(key: string): Promise<Buffer>;
  backup(key: string, body: Buffer): Promise<void>;
  replace(key: string, body: Buffer): Promise<void>;
}

export interface MediaRefreshRepository {
  assertOwned(replacement: MediaReplacement): Promise<void>;
  recordBytes(replacement: MediaReplacement): Promise<void>;
}

// Preserve the aspect ratio recorded with historical demo listings. Only image
// bytes change; listing terms, photo IDs, positions and storage keys stay intact.
export async function prepareReplacement(
  input: Buffer,
  dimensions: { width: number; height: number },
) {
  if (input.length > 5 * 1024 * 1024)
    throw new Error('Generated asset exceeds upload limit.');

  return sharp(input, { limitInputPixels: 20_000_000, failOn: 'error' })
    .rotate()
    .resize(dimensions.width, dimensions.height, { fit: 'cover' })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();
}

export class MediaRefreshService {
  private readonly repository: MediaRefreshRepository;
  private readonly storage: MediaRefreshStorage;
  private readonly replacements: readonly MediaReplacement[];

  constructor(
    repository: MediaRefreshRepository,
    storage: MediaRefreshStorage,
    replacements: readonly MediaReplacement[],
  ) {
    this.repository = repository;
    this.storage = storage;
    this.replacements = replacements;
  }

  async replace(actor: string, index: number) {
    const replacement = this.replacements[index];

    if (!replacement || replacement.ownerId !== actor)
      throw new Error('Demo media ownership refused.');

    await this.repository.assertOwned(replacement);
    const current = await this.storage.read(replacement.storageKey);
    const hash = mediaHash(current);
    const nextHash = mediaHash(replacement.body);

    if (hash !== replacement.previousHash && hash !== nextHash)
      throw new Error('Demo media was edited; refusing to overwrite it.');

    if (hash !== nextHash) {
      await this.storage.backup(replacement.storageKey, current);
      await this.storage.replace(replacement.storageKey, replacement.body);
    }

    // Retry repairs an interrupted metadata update after a verified overwrite.
    await this.repository.recordBytes(replacement);

    if (mediaHash(await this.storage.read(replacement.storageKey)) !== nextHash)
      throw new Error('Demo media verification failed.');

    return { sha256: nextHash, bytes: replacement.body.length };
  }
}
