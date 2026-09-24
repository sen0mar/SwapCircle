import { createClient } from '@supabase/supabase-js';

export const PHOTO_BUCKET = 'item-media';

export interface PhotoStorage {
  upload(key: string, body: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
  publicUrl(key: string): string;
}

export function createPhotoStorage(
  url: string,
  serviceRoleKey: string,
): PhotoStorage {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = client.storage.from(PHOTO_BUCKET);

  return {
    async upload(key, body) {
      const result = await bucket.upload(key, body, {
        contentType: 'image/webp',
        cacheControl: '3600',
        upsert: false,
      });
      if (result.error) throw new Error('Storage upload failed.');
    },
    async remove(key) {
      const result = await bucket.remove([key]);
      if (result.error) throw new Error('Storage removal failed.');
    },
    publicUrl(key) {
      return bucket.getPublicUrl(key).data.publicUrl;
    },
  };
}
