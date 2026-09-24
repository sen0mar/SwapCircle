import { useState } from 'react';
import { UserRound } from 'lucide-react';

export function Avatar({ url, name }: { url: string | null; name: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url)
    return (
      <span
        className="profile-avatar-fallback"
        role="img"
        aria-label={`${name} has no available avatar`}
      >
        <UserRound aria-hidden="true" />
      </span>
    );

  return (
    <img
      className="profile-avatar"
      src={url}
      alt={`${name}'s avatar`}
      width="96"
      height="96"
      loading="lazy"
      onError={() => setFailedUrl(url)}
    />
  );
}
