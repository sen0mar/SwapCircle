import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { listingPhotosSchema } from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/AuthProvider';
import {
  ListingImage,
  uploadListingPhoto,
  useListingPhotos,
} from '../browse/listing-photos';

type Pending = { file: File; url: string; progress: number };

export function ListingPhotosEditor({
  listingId,
  title,
}: {
  listingId: string;
  title: string;
}) {
  const { client, request, session } = useAuth();
  const query = useListingPhotos(listingId);
  const queries = useQueryClient();
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const urls = useRef(new Set<string>());
  const uploadScope = useRef(new AbortController());

  useEffect(() => {
    uploadScope.current = new AbortController();
    return () => {
      uploadScope.current.abort();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, []);

  const refresh = async () => {
    await queries.invalidateQueries({
      queryKey: ['listing-photos', listingId],
    });
  };

  const removePending = (url: string) => {
    setPending((items) => items.filter((item) => item.url !== url));
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  };

  const photos = query.data ?? [];
  const capacity = Math.max(0, 3 - photos.length - pending.length);

  return (
    <section
      className="listing-photo-editor"
      aria-labelledby="listing-photos-title"
    >
      <h2 id="listing-photos-title">Photos</h2>
      <p>
        Up to three photos. JPEG, PNG, or WebP, each under 5 MB. The first photo
        is shown on cards.
      </p>
      {query.isPending ? (
        <p role="status">Loading photos…</p>
      ) : query.isError ? (
        <p role="alert">
          Photos could not be loaded.{' '}
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </p>
      ) : (
        <>
          <ol className="listing-photo-list">
            {photos.map((photo, index) => (
              <li key={photo.id}>
                <ListingImage photo={photo} title={title} index={index} />
                <div className="listing-photo-actions">
                  <span>Photo {index + 1}</span>
                  <Button
                    type="button"
                    disabled={busy || index === 0}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const ids = photos.map((item) => item.id);
                        [ids[index - 1], ids[index]] = [
                          ids[index]!,
                          ids[index - 1]!,
                        ];
                        await request(
                          `/api/v1/listings/${listingId}/photos/order`,
                          listingPhotosSchema,
                          {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ids }),
                          },
                        );
                        await refresh();
                      } catch {
                        setError('Photo order could not be saved. Retry.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Move earlier
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || index === photos.length - 1}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const ids = photos.map((item) => item.id);
                        [ids[index], ids[index + 1]] = [
                          ids[index + 1]!,
                          ids[index]!,
                        ];
                        await request(
                          `/api/v1/listings/${listingId}/photos/order`,
                          listingPhotosSchema,
                          {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ids }),
                          },
                        );
                        await refresh();
                      } catch {
                        setError('Photo order could not be saved. Retry.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Move later
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await request(
                          `/api/v1/listings/${listingId}/photos/${photo.id}`,
                          {
                            safeParse: () => ({
                              success: true as const,
                              data: undefined,
                            }),
                          },
                          { method: 'DELETE' },
                        );
                        await refresh();
                      } catch {
                        setError('Photo could not be removed. Retry.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remove photo {index + 1}
                  </Button>
                </div>
              </li>
            ))}
            {pending.map((item) => (
              <li key={item.url}>
                <img
                  className="listing-photo"
                  src={item.url}
                  alt={`Selected ${item.file.name}`}
                  width="500"
                  height="375"
                />
                <p>
                  {item.file.name} ·{' '}
                  {item.progress ? `${item.progress}%` : 'Ready to upload'}
                </p>
                {busy && (
                  <progress
                    value={item.progress}
                    max={100}
                    aria-label={`${item.file.name} upload progress`}
                  />
                )}
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => removePending(item.url)}
                >
                  Remove selection
                </Button>
              </li>
            ))}
          </ol>
          <label htmlFor="listing-photo-files">Choose photos</label>
          <input
            id="listing-photo-files"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy || capacity === 0}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length > capacity) {
                setError('An item can have at most three photos.');
                return;
              }
              if (
                files.some(
                  (file) =>
                    !['image/jpeg', 'image/png', 'image/webp'].includes(
                      file.type,
                    ) || file.size > 5 * 1024 * 1024,
                )
              ) {
                setError('Choose JPEG, PNG, or WebP images under 5 MB.');
                return;
              }
              setError('');
              setPending((items) => [
                ...items,
                ...files.map((file) => {
                  const url = URL.createObjectURL(file);
                  urls.current.add(url);
                  return { file, url, progress: 0 };
                }),
              ]);
            }}
          />
          <p role="status">
            {photos.length + pending.length} of 3 photos selected.
          </p>
          {pending.length > 0 && (
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={async () => {
                if (!client || !session) return;
                setBusy(true);
                setError('');
                try {
                  const { data, error: authError } =
                    await client.auth.getSession();
                  if (authError || data.session?.user.id !== session.user.id)
                    throw new Error('Session changed.');
                  for (const item of pending) {
                    await uploadListingPhoto(
                      listingId,
                      item.file,
                      data.session.access_token,
                      (progress) =>
                        setPending((items) =>
                          items.map((value) =>
                            value.url === item.url
                              ? { ...value, progress }
                              : value,
                          ),
                        ),
                      uploadScope.current.signal,
                    );
                    removePending(item.url);
                    await refresh();
                  }
                } catch {
                  setError(
                    'Upload stopped. Saved photos are kept; retry the remaining selections.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Uploading…' : 'Upload selected photos'}
            </Button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
