export function UnreadBadge({ count }: { count: number | null }) {
  if (count === null)
    return <span className="inbox-note">Unread count unavailable</span>;

  return count > 0 ? (
    <span className="unread-badge">{count} unread</span>
  ) : null;
}
