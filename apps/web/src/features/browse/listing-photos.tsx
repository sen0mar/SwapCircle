import {
  listingPhotoSchema,
  listingPhotosSchema,
  type ListingPhoto,
} from '@swapcircle/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { apiRequest } from '../../lib/api-client';

export function useListingPhotos(id: string) {
  return useQuery({
    queryKey: ['listing-photos', id],
    queryFn: ({ signal }) =>
      apiRequest(
        `/api/v1/listings/${encodeURIComponent(id)}/photos`,
        listingPhotosSchema,
        { signal },
      ),
    enabled: !!id,
    retry: false,
  });
}

export function ListingImage({
  photo,
  title,
  index = 0,
}: {
  photo: ListingPhoto | undefined;
  title: string;
  index?: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!photo || failedUrl === photo.url)
    return (
      <div className="photo-unavailable">
        <ImageOff aria-hidden="true" />
        <span>{photo ? 'Photo unavailable' : 'No photo yet'}</span>
      </div>
    );

  return (
    <img
      className="listing-photo"
      src={photo.url}
      alt={`${title}, photo ${index + 1}`}
      width={photo.width}
      height={photo.height}
      loading="lazy"
      onError={() => setFailedUrl(photo.url)}
    />
  );
}

export function PhotoLoadError() {
  return (
    <div className="photo-unavailable">
      <ImageOff aria-hidden="true" />
      <span>Photo unavailable</span>
    </div>
  );
}

export async function uploadListingPhoto(
  id: string,
  file: File,
  token: string,
  progress: (value: number) => void,
  signal: AbortSignal,
): Promise<ListingPhoto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (signal.aborted) {
      reject(new Error('Upload cancelled.'));
      return;
    }
    const abort = () => xhr.abort();
    signal.addEventListener('abort', abort, { once: true });
    const finish = () => signal.removeEventListener('abort', abort);
    xhr.open(
      'POST',
      `${import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001'}/api/v1/listings/${encodeURIComponent(id)}/photos`,
    );
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.timeout = 30000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = xhr.ontimeout = () => {
      finish();
      reject(new Error('Upload failed. Check your connection and retry.'));
    };
    xhr.onabort = () => {
      finish();
      reject(new Error('Upload cancelled.'));
    };
    xhr.onload = () => {
      finish();
      if (xhr.status !== 201) {
        reject(new Error('Upload failed. Check the image and retry.'));
        return;
      }

      try {
        const parsed = listingPhotoSchema.safeParse(
          JSON.parse(xhr.responseText),
        );
        if (!parsed.success)
          throw new Error('The upload response was invalid.');
        resolve(parsed.data);
      } catch (error) {
        reject(error);
      }
    };
    xhr.send(file);
  });
}
