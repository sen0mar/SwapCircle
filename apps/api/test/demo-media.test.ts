import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  MediaRefreshService,
  mediaHash,
  prepareReplacement,
} from '../scripts/demo/media-refresh.service.ts';

function fixture() {
  const old = Buffer.from('original');
  const body = Buffer.from('generated');
  let stored: Buffer = old;
  const repository = {
    assertOwned: vi.fn(async () => {}),
    recordBytes: vi.fn(async () => {}),
  };
  const storage = {
    read: vi.fn(async () => stored),
    backup: vi.fn(async () => {}),
    replace: vi.fn(async (_key: string, next: Buffer) => {
      stored = next;
    }),
  };
  const service = new MediaRefreshService(repository, storage, [
    {
      ownerId: 'owner',
      storageKey: 'demo/photo.webp',
      previousHash: mediaHash(old),
      body,
      photoId: 'photo',
    },
  ]);
  return {
    service,
    repository,
    storage,
    body,
    setStored: (value: Buffer) => {
      stored = value;
    },
  };
}

describe('journal-scoped demo media refresh', () => {
  it('rejects another identity and unplanned objects before storage access', async () => {
    const f = fixture();
    await expect(f.service.replace('other', 0)).rejects.toThrow('ownership');
    await expect(f.service.replace('owner', 1)).rejects.toThrow('ownership');
    expect(f.storage.read).not.toHaveBeenCalled();
  });

  it('rejects edited media without overwriting or changing metadata', async () => {
    const f = fixture();
    f.setStored(Buffer.from('user edited'));
    await expect(f.service.replace('owner', 0)).rejects.toThrow('edited');
    expect(f.storage.replace).not.toHaveBeenCalled();
    expect(f.repository.recordBytes).not.toHaveBeenCalled();
  });

  it('backs up before replacing, verifies bytes, and resumes metadata failure without another overwrite', async () => {
    const f = fixture();
    f.repository.recordBytes.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(f.service.replace('owner', 0)).rejects.toThrow(
      'database unavailable',
    );
    expect(f.storage.backup.mock.invocationCallOrder[0]).toBeLessThan(
      f.storage.replace.mock.invocationCallOrder[0]!,
    );
    await expect(f.service.replace('owner', 0)).resolves.toEqual({
      sha256: mediaHash(f.body),
      bytes: f.body.length,
    });
    expect(f.storage.replace).toHaveBeenCalledTimes(1);
    expect(f.repository.recordBytes).toHaveBeenCalledTimes(2);
  });

  it('rejects a changed record before reading or writing storage', async () => {
    const f = fixture();
    f.repository.assertOwned.mockRejectedValueOnce(new Error('record changed'));
    await expect(f.service.replace('owner', 0)).rejects.toThrow(
      'record changed',
    );
    expect(f.storage.read).not.toHaveBeenCalled();
  });

  it('preserves recorded gallery dimensions and produces a decodable WebP', async () => {
    const input = await sharp({
      create: { width: 160, height: 120, channels: 3, background: 'white' },
    })
      .jpeg()
      .toBuffer();
    const result = await prepareReplacement(input, { width: 90, height: 60 });
    expect(await sharp(result).metadata()).toMatchObject({
      format: 'webp',
      width: 90,
      height: 60,
    });
  });
});

describe('demo media failure recovery', () => {
  it('keeps the original when backup fails', async () => {
    const f = fixture();
    f.storage.backup.mockRejectedValueOnce(new Error('backup unavailable'));
    await expect(f.service.replace('owner', 0)).rejects.toThrow(
      'backup unavailable',
    );
    expect(f.storage.replace).not.toHaveBeenCalled();
    expect(f.repository.recordBytes).not.toHaveBeenCalled();
  });

  it('refuses success if storage readback differs', async () => {
    const f = fixture();
    f.storage.replace.mockImplementationOnce(async () => {});
    await expect(f.service.replace('owner', 0)).rejects.toThrow(
      'verification failed',
    );
  });
});
