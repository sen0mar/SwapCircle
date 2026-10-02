import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useNotifications } from './useNotifications';
import { NotificationContent } from './NotificationContent';

export function NotificationPage() {
  const { id } = useParams();
  const notifications = useNotifications();
  const item = notifications.data?.find((row) => row.id === id);

  return (
    <section className="panel" aria-labelledby="notification-title">
      <h1 id="notification-title">Notification</h1>
      {notifications.isPending ? (
        <p role="status">Loading notification…</p>
      ) : notifications.isError ? (
        <div>
          <p role="alert">Notification could not be loaded.</p>
          <Button onClick={() => void notifications.refetch()}>
            Retry notification
          </Button>
        </div>
      ) : !item ? (
        <p role="alert">
          This notification cannot be found or you do not have access.
        </p>
      ) : (
        <>
          <NotificationContent item={item} detail />
          {item.resource_type !== 'conversation' &&
            item.resource_type !== 'trade' &&
            item.resource_type !== 'coffee_invitation' &&
            item.resource_type !== 'meetup' && (
              <p>
                The related feature is not available yet. You can mark this
                notification read; no invitation response or confirmation will
                be recorded.
              </p>
            )}
        </>
      )}
      <Link to="/">Back to Home</Link>
    </section>
  );
}
