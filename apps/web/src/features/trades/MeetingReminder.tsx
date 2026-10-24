import { CalendarDays, Clock, MapPin } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import { useMeeting } from './useMeetings';

export function MeetingReminder({ tradeId }: { tradeId: string }) {
  const meeting = useMeeting(tradeId);
  const denied =
    meeting.error instanceof ApiError &&
    [403, 404].includes(meeting.error.status ?? 0);
  const data = denied ? null : meeting.data;

  return (
    <section className="panel meetup-reminder" aria-label="Meetup reminder">
      {meeting.isPending && <p role="status">Loading meetup details…</p>}
      {meeting.isError && (
        <div>
          <p role="alert">
            {denied
              ? 'Meetup details are unavailable.'
              : 'Meetup details could not be refreshed.'}
          </p>
          {!denied && (
            <Button onClick={() => void meeting.refetch()}>
              Retry meetup details
            </Button>
          )}
        </div>
      )}
      {data && (
        <dl className="meetup-reminder-facts">
          <div>
            <dt>
              <CalendarDays size={18} aria-hidden="true" />
              Date
            </dt>
            <dd>
              <time dateTime={data.meetingAt}>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'full',
                  timeZone: data.timeZone,
                }).format(new Date(data.meetingAt))}
              </time>
            </dd>
          </div>
          <div>
            <dt>
              <Clock size={18} aria-hidden="true" />
              Time
            </dt>
            <dd>
              {new Intl.DateTimeFormat(undefined, {
                timeStyle: 'short',
                timeZone: data.timeZone,
              }).format(new Date(data.meetingAt))}{' '}
              <span className="meetup-reminder-zone">{data.timeZone}</span>
            </dd>
          </div>
          <div className="meetup-reminder-location">
            <dt>
              <MapPin size={18} aria-hidden="true" />
              Location
            </dt>
            <dd>
              <span>{data.place ?? 'See map'}</span>
              {data.mapLink && (
                <a
                  href={data.mapLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View map
                </a>
              )}
            </dd>
          </div>
        </dl>
      )}
      {!meeting.isPending && !meeting.isError && !data && (
        <p>
          No meetup details saved yet. Arrange the date, time and location in
          your chat.
        </p>
      )}
    </section>
  );
}
