import type { NotificationRead } from '@swapcircle/contracts';
import { useMeeting } from '../trades/useMeetings';
import { useCoffeeInvitation } from '../trades/useCoffee';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useNotificationAcknowledgement } from './useNotifications';

const titles: Record<NotificationRead['event_type'], string> = {
  trade_invitation: 'Trade invitation',
  trade_status: 'Trade status changed',
  trade_revision: 'Trade terms changed',
  group_invitation: 'Group invitation',
  group_membership: 'Group membership changed',
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
        {detail && item.resource_type === 'meetup' && (
          <MeetingNotificationLink id={item.resource_id} />
        )}
        {detail && item.resource_type === 'coffee_invitation' && (
          <CoffeeNotificationLink id={item.resource_id} />
        )}
        {(!detail ||
          item.resource_type === 'conversation' ||
          item.resource_type === 'trade') && (
          <Link
            to={
              item.resource_type === 'conversation'
                ? item.event_type === 'group_invitation' ||
                  item.event_type === 'group_membership'
                  ? `/groups/${item.resource_id}`
                  : `/inbox/${item.resource_id}`
                : item.resource_type === 'trade'
                  ? `/swaps/${item.resource_id}`
                  : `/notifications/${item.id}`
            }
          >
            {item.resource_type === 'conversation'
              ? item.event_type === 'group_invitation' ||
                item.event_type === 'group_membership'
                ? 'View group invitation'
                : 'Open conversation'
              : item.resource_type === 'trade'
                ? 'View swap'
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
      {read.isError && !item.read_at && (
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

function CoffeeNotificationLink({ id }: { id: string }) {
  const coffee = useCoffeeInvitation(id);
  if (coffee.isPending) return <p role="status">Loading coffee invitation…</p>;
  if (coffee.isError)
    return (
      <div>
        <p role="alert">
          This coffee invitation could not be loaded or is unavailable to this
          account.
        </p>
        <Button onClick={() => void coffee.refetch()}>
          Retry coffee invitation
        </Button>
      </div>
    );
  return (
    <Link to={`/swaps/${coffee.data.tradeId}#coffee`}>View coffee in swap</Link>
  );
}

function MeetingNotificationLink({ id }: { id: string }) {
  const meeting = useMeeting(id, false);
  if (meeting.isPending) return <p role="status">Loading meeting link…</p>;
  if (meeting.isError || !meeting.data)
    return (
      <div>
        <p role="alert">
          This meeting could not be loaded or is unavailable to this account.
        </p>
        <Button onClick={() => void meeting.refetch()}>
          Retry meeting link
        </Button>
      </div>
    );
  return (
    <Link to={`/swaps/${meeting.data.tradeId}#meeting`}>
      View meeting in swap
    </Link>
  );
}
