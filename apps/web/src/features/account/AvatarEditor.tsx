import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  currentProfileSchema,
  type CurrentProfile,
} from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/AuthProvider';
import { Avatar } from './Avatar';

export function AvatarEditor({ profile }: { profile: CurrentProfile }) {
  const { request, session } = useAuth();
  const queries = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const apply = (saved: CurrentProfile) => {
    queries.setQueryData(['private', session?.user.id, 'profile'], saved);
    void queries.invalidateQueries({ queryKey: ['member', saved.id] });
  };

  const updated = (saved: CurrentProfile) => {
    apply(saved);
    setFile(null);
    setPreview(null);
  };

  return (
    <section className="avatar-editor" aria-labelledby="avatar-title">
      <h2 id="avatar-title">Public avatar</h2>
      <p>
        This photo appears on your public member profile. Do not choose a
        private document.
      </p>
      {preview ? (
        <img
          className="profile-avatar"
          src={preview}
          alt="Selected avatar preview"
          width="96"
          height="96"
        />
      ) : (
        <Avatar url={profile.avatarUrl} name={profile.displayName} />
      )}
      <label htmlFor="avatar-file">Choose avatar</label>
      <input
        id="avatar-file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        onChange={(event) => {
          const selected = event.target.files?.[0] ?? null;
          event.target.value = '';
          if (
            selected &&
            (!['image/jpeg', 'image/png', 'image/webp'].includes(
              selected.type,
            ) ||
              selected.size > 5 * 1024 * 1024)
          ) {
            setError('Choose a JPEG, PNG, or WebP image under 5 MB.');
            return;
          }
          setError('');
          setFile(selected);
        }}
      />
      {file && (
        <Button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              updated(
                await request(
                  '/api/v1/profiles/me/avatar',
                  currentProfileSchema,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': file.type },
                    body: file,
                  },
                ),
              );
            } catch {
              setError(
                'Avatar could not be saved. Your selection is still here; retry.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Uploading…' : 'Upload avatar'}
        </Button>
      )}
      {profile.avatarUrl && (
        <Button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              updated(
                await request(
                  '/api/v1/profiles/me/avatar',
                  currentProfileSchema,
                  { method: 'DELETE' },
                ),
              );
            } catch {
              setError('Avatar could not be removed. Retry.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Remove avatar
        </Button>
      )}
      {profile.avatarCleanupPending && (
        <div>
          <p role="status">
            A previous avatar is waiting to be removed from public media.
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                apply(
                  await request(
                    '/api/v1/profiles/me/avatar/cleanup',
                    currentProfileSchema,
                    { method: 'POST' },
                  ),
                );
              } catch {
                setError(
                  'The previous avatar could not be removed. Try again.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry avatar cleanup
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
