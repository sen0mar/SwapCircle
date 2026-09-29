import type { NotificationRead } from '@swapcircle/contracts';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useNotificationAcknowledgement } from './useNotifications';

const titles: Record<NotificationRead['event_type'], string> = {
  trade_invitation: 'Trade invitation',
  trade_status: 'Trade status changed',
  trade_revision: 'Trade terms changed',
  group_invitation: 'Group invitation',
  coffee_invitation: 'Coffee invitation',
  coffee_response: 'Coffee response',
  meeting_change: 'Meeting changed',
};

export function NotificationContent({
  item,
  detail = false,
}: {
  item: NotificationRead;
  detail?: boolean;
}) {
  const read = useNotificationAcknowledgement();
  const Heading = detail ? 'h2' : 'h3';

  return (
    <>
      <div className="notification-heading">
        <Heading>{titles[item.event_type]}</Heading>
        <span className={item.read_at ? 'notification-read' : 'unread-badge'}>
          {item.read_at ? 'Read' : 'Unread'}
        </span>
      </div>
      <time dateTime={item.created_at}>
        {new Date(item.created_at).toLocaleString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </time>
      <div className="notification-actions">
        {(!detail || item.resource_type === 'conversation') && (
          <Link
            to={
              item.resource_type === 'conversation'
                ? `/inbox/${item.resource_id}`
                : `/notifications/${item.id}`
            }
          >
            {item.resource_type === 'conversation'
              ? 'Open conversation'
              : 'View notification'}
          </Link>
        )}
        {!item.read_at && (
          <Button
            variant="secondary"
            disabled={read.isPending}
            onClick={() => read.mutate({ ids: [item.id], all: false })}
          >
            {read.isPending ? 'Saving…' : 'Mark read'}
          </Button>
        )}
      </div>
      {read.isError && (
        <div>
          <p role="alert">Read state could not be saved. Please retry.</p>
          <Button onClick={read.retry} disabled={read.isPending}>
            Retry mark read
          </Button>
        </div>
      )}
    </>
  );
}
