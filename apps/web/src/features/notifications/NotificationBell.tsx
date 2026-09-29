import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../../components/ui/sheet';
import { useAuth } from '../auth/AuthProvider';
import { NotificationContent } from './NotificationContent';
import {
  useNotifications,
  useNotificationAcknowledgement,
  useNotificationsRealtime,
} from './useNotifications';

export function NotificationBell() {
  const { session } = useAuth();
  const notifications = useNotifications();
  const live = useNotificationsRealtime();
  const read = useNotificationAcknowledgement();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const unread = notifications.data?.filter((item) => !item.read_at) ?? [];
  const count = notifications.isSuccess ? unread.length : null;
  const intended = new Set(read.variables?.ids ?? []);
  const hasUnreadIntended = unread.some((item) => intended.has(item.id));

  useEffect(() => setOpen(false), [location.key]);

  if (!session) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          className="icon-button notification-bell"
          aria-label={
            count === null
              ? 'Open notifications, count unavailable'
              : `Open notifications, ${count} unread`
          }
        >
          <Bell size={20} aria-hidden="true" />
          <span className="notification-count" aria-hidden="true">
            {count === null ? '·' : count > 99 ? '99+' : count || ''}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent className="notification-panel">
        <SheetTitle>Notifications</SheetTitle>
        <SheetDescription>
          Private updates for you. Reading does not accept an invitation or
          confirm a meeting.
        </SheetDescription>
        {live.status && (
          <div>
            <p role="status">{live.status}</p>
            <Button onClick={live.retry}>Retry live notifications</Button>
          </div>
        )}
        {notifications.isPending ? (
          <p role="status">Loading notifications…</p>
        ) : notifications.isError ? (
          <div>
            <p role="alert">
              Notifications could not be loaded. Check your connection and
              retry.
            </p>
            <Button onClick={live.retry}>Retry notifications</Button>
          </div>
        ) : (
          <>
            <div className="notification-toolbar">
              <p role="status">{unread.length} unread notifications</p>
              <Button
                variant="secondary"
                disabled={
                  !unread.length || read.isPending || notifications.isFetching
                }
                onClick={() =>
                  read.mutate({ ids: unread.map((item) => item.id), all: true })
                }
              >
                {read.isPending ? 'Saving read state…' : 'Mark all read'}
              </Button>
            </div>
            {read.isError && hasUnreadIntended && (
              <div>
                <p role="alert">
                  Some read state could not be saved. Retry the same
                  notifications.
                </p>
                <Button disabled={read.isPending} onClick={read.retry}>
                  Retry mark all read
                </Button>
              </div>
            )}
            {!notifications.data.length ? (
              <p>
                No notifications yet. Important invitations and changes will
                appear here.
              </p>
            ) : (
              <ol className="notification-list">
                {notifications.data.map((item) => (
                  <li key={item.id} data-notification-id={item.id}>
                    <NotificationContent item={item} />
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
