import { Toast } from '../../components/ui/toast';
import { Select } from '../../components/ui/select';
import { TimeSelect } from './TimeSelect';
import { CalendarDays, Clock, MapPin } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { useRef, useState } from 'react';
import { meetingCreateSchema, type Meetup } from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import type { TradeDetail } from './trades-api';
import type { MeetingAction } from './meetings-api';
import { useMeeting, useMeetingAction } from './useMeetings';
import {
  localMeetingTime,
  meetingInstants,
  readableMeetingTime,
} from './meeting-time';

const commonTimeZones = [
  ['UTC', 'UTC'],
  ['Europe/Paris', 'Paris / Central Europe'],
  ['Europe/London', 'London'],
  ['Europe/Lisbon', 'Lisbon'],
  ['Europe/Helsinki', 'Helsinki / Eastern Europe'],
  ['America/New_York', 'New York / Eastern Time'],
  ['America/Chicago', 'Chicago / Central Time'],
  ['America/Denver', 'Denver / Mountain Time'],
  ['America/Los_Angeles', 'Los Angeles / Pacific Time'],
  ['America/Toronto', 'Toronto'],
  ['America/Sao_Paulo', 'São Paulo'],
  ['Africa/Cairo', 'Cairo'],
  ['Africa/Johannesburg', 'Johannesburg'],
  ['Asia/Dubai', 'Dubai'],
  ['Asia/Kolkata', 'India'],
  ['Asia/Singapore', 'Singapore'],
  ['Asia/Shanghai', 'Beijing / Shanghai'],
  ['Asia/Tokyo', 'Tokyo'],
  ['Australia/Sydney', 'Sydney'],
  ['Pacific/Auckland', 'Auckland'],
] as const;

type Draft = {
  place: string;
  local: string;
  zone: string;
  instant: string;
  revision: number | null;
  tradeVersion: number;
};

export function TradeMeeting({ detail }: { detail: TradeDetail }) {
  const { session } = useAuth();
  const meeting = useMeeting(detail.id);
  const action = useMeetingAction(detail.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [attempt, setAttempt] = useState<MeetingAction | null>(null);
  const [validation, setValidation] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState<MeetingAction | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const data = meeting.data;
  const denied =
    meeting.error instanceof ApiError &&
    [403, 404].includes(meeting.error.status ?? 0);
  const definitive =
    action.error instanceof ApiError &&
    (action.error.status ?? 0) >= 400 &&
    (action.error.status ?? 0) < 500;
  const uncertain = !!action.error && !definitive;
  const busy = action.isPending || uncertain;
  const current = !meeting.isError && !meeting.isPending && !meeting.isFetching;
  const permitted =
    ['proposed', 'confirmed'].includes(detail.status) &&
    detail.participants.some((p) => p.userId === session?.user.id);
  const candidates = draft ? meetingInstants(draft.local, draft.zone) : [];
  const instant =
    candidates.length === 1
      ? candidates[0]
      : candidates.includes(draft?.instant ?? '')
        ? draft?.instant
        : undefined;
  const stale =
    draft &&
    (draft.revision !== (data?.revision ?? null) ||
      draft.tradeVersion !== detail.currentVersion);

  const declining =
    confirmation?.kind === 'respond' &&
    confirmation.input.response === 'declined';

  function start(value?: Meetup | null) {
    setDraft({
      place: value?.place ?? '',
      local: value
        ? localMeetingTime(value.meetingAt, value.timeZone).slice(0, 16)
        : '',
      zone: value?.timeZone ?? browserZone,
      instant: value?.meetingAt ?? '',
      revision: value?.revision ?? null,
      tradeVersion: detail.currentVersion,
    });
    setValidation('');
    action.reset();
  }

  function submit(input: MeetingAction) {
    setSuccess('');
    setAttempt(input);
    action.mutate(input, {
      onSuccess: () => {
        if (input.kind === 'respond') {
          setSuccess(
            input.input.response === 'confirmed'
              ? 'Meetup confirmed. The other person has been notified.'
              : 'Meetup declined. The other person has been notified.',
          );
        }
        setAttempt(null);
        setConfirmation(null);
        setDraft(null);
        heading.current?.focus();
      },
    });
  }

  function save() {
    if (!draft || !instant) {
      setValidation(
        'Choose a valid local date, time and IANA zone. Times skipped by daylight saving do not exist; repeated times require an explicit occurrence.',
      );
      return;
    }
    const input = {
      place: draft.place.trim() || null,
      mapLink: data?.mapLink ?? null,
      meetingAt: instant,
      timeZone: draft.zone,
      operationKey: crypto.randomUUID(),
      expectedTradeVersion: draft.tradeVersion,
    };
    if (!meetingCreateSchema.safeParse(input).success) {
      setValidation(
        'Enter a meeting place and a valid time zone, such as Europe/Paris.',
      );
      return;
    }
    setValidation('');
    submit(
      draft.revision === null
        ? { kind: 'create', input }
        : {
            kind: 'update',
            input: { ...input, expectedRevision: draft.revision },
          },
    );
  }

  return (
    <section
      id="meeting"
      className="panel route-panel"
      aria-label="Meeting arrangement"
    >
      {success && <Toast message={success} onDismiss={() => setSuccess('')} />}
      <h2 ref={heading} tabIndex={-1}>
        Meetup
      </h2>
      {meeting.isPending && <p role="status">Loading meeting…</p>}
      {action.error && !draft && (
        <p role="alert">
          The meetup action could not be saved. Review the meetup to try again.
        </p>
      )}
      {meeting.isError && (
        <p role="alert">
          The meeting could not be refreshed or is unavailable to this account.
          Refresh before responding.
        </p>
      )}
      {!denied && data && (
        <>
          <dl className="meetup-summary">
            <div>
              <dt>
                <CalendarDays size={18} aria-hidden="true" />
                Date
              </dt>
              <dd>
                <time dateTime={data.meetingAt}>
                  {new Intl.DateTimeFormat(undefined, {
                    timeZone: data.timeZone,
                    dateStyle: 'medium',
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
                  timeZone: data.timeZone,
                  timeStyle: 'short',
                }).format(new Date(data.meetingAt))}{' '}
                · {data.timeZone}
              </dd>
            </div>
            <div>
              <dt>
                <MapPin size={18} aria-hidden="true" />
                Place
              </dt>
              <dd>
                {data.place ?? 'See map'}
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
        </>
      )}
      {current && !data && <p>No meeting arranged yet.</p>}
      <div className="meetup-footer-actions">
        {permitted && !draft && (
          <Button
            variant="primary"
            disabled={busy || !current}
            onClick={() => start(data)}
          >
            {data
              ? data.responses.find((p) => p.userId === session?.user.id)
                  ?.response === 'confirmed'
                ? 'Change meetup'
                : 'Review meetup'
              : 'Plan meetup'}
          </Button>
        )}
        {permitted && data && (
          <div className="meetup-response-actions">
            {(['confirmed', 'declined'] as const).map((response) => (
              <Button
                key={response}
                variant={response === 'confirmed' ? 'primary' : 'secondary'}
                disabled={busy || !current}
                onClick={() => {
                  const next: MeetingAction = {
                    kind: 'respond',
                    input: {
                      response,
                      expectedResponse:
                        data.responses.find(
                          (p) => p.userId === session?.user.id,
                        )?.response ?? null,
                      expectedRevision: data.revision,
                      expectedTradeVersion: detail.currentVersion,
                      operationKey: crypto.randomUUID(),
                    },
                  };
                  action.reset();
                  setConfirmation(next);
                }}
              >
                {response === 'confirmed'
                  ? 'Confirm this meeting'
                  : 'Decline this meeting'}
              </Button>
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !action.isPending) setConfirmation(null);
        }}
      >
        <DialogContent closeDisabled={action.isPending}>
          <DialogTitle>
            {declining ? 'Decline this meetup?' : 'Confirm this meetup?'}
          </DialogTitle>
          <DialogDescription>
            {declining ? 'Declining' : 'Confirming'} will notify the other
            person that{' '}
            {declining
              ? 'you won’t be meeting them.'
              : 'you are ready to meet them 🎉'}
          </DialogDescription>
          {confirmation?.kind === 'respond' &&
            (confirmation.input.expectedRevision !== data?.revision ||
              confirmation.input.expectedTradeVersion !==
                detail.currentVersion) && (
              <p role="alert">
                The meetup changed. Close this dialog and review the latest
                details.
              </p>
            )}
          {action.error && (
            <p role="alert">
              {uncertain
                ? 'Your response could not be verified. Retry the same response.'
                : 'Your response could not be saved. Close this dialog and review the latest details.'}
            </p>
          )}
          <div className="coffee-actions">
            <Button
              disabled={action.isPending}
              onClick={() => setConfirmation(null)}
            >
              Go back
            </Button>
            <Button
              variant="primary"
              disabled={
                action.isPending ||
                definitive ||
                !permitted ||
                !current ||
                (!uncertain &&
                  confirmation?.kind === 'respond' &&
                  (confirmation.input.expectedRevision !== data?.revision ||
                    confirmation.input.expectedTradeVersion !==
                      detail.currentVersion))
              }
              onClick={() => {
                if (confirmation) submit(confirmation);
              }}
            >
              {action.isPending
                ? declining
                  ? 'Declining…'
                  : 'Confirming…'
                : uncertain
                  ? declining
                    ? 'Retry decline'
                    : 'Retry confirmation'
                  : declining
                    ? 'Decline and notify'
                    : 'Confirm and notify'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!draft && !denied}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDraft(null);
            setValidation('');
            action.reset();
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          closeDisabled={busy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            heading.current?.focus();
          }}
        >
          <DialogTitle>{data ? 'Review meetup' : 'Plan meetup'}</DialogTitle>
          <p role="status">Save your meetup options before confirming.</p>

          {draft && !denied && (
            <form
              className="meeting-form"
              onChange={() => setValidation('')}
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <fieldset
                disabled={busy || !permitted}
                aria-label="Meetup details"
              >
                <label>
                  Public meeting place
                  <input
                    className="ui-input"
                    maxLength={500}
                    value={draft.place}
                    onChange={(e) =>
                      setDraft({ ...draft, place: e.target.value })
                    }
                  />
                </label>

                <div className="meetup-date-time-row">
                  <label>
                    Date
                    <input
                      className="ui-input"
                      type="date"
                      required
                      value={draft.local.split('T')[0] ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          local: `${e.target.value}T${draft.local.split('T')[1] || '12:00'}`,
                          instant: '',
                        })
                      }
                    />
                  </label>
                  <TimeSelect
                    disabled={busy || !permitted}
                    value={draft.local.split('T')[1]?.slice(0, 5) ?? ''}
                    onChange={(value) =>
                      setDraft({
                        ...draft,
                        local: `${draft.local.split('T')[0] ?? ''}T${value}`,
                        instant: '',
                      })
                    }
                  />
                </div>
                <label>
                  Time zone
                  <Select
                    className="ui-input"
                    required
                    value={draft.zone}
                    onChange={(e) =>
                      setDraft({ ...draft, zone: e.target.value, instant: '' })
                    }
                  >
                    {[
                      ...commonTimeZones,
                      ...[...new Set([browserZone, draft.zone])]
                        .filter(
                          (zone) =>
                            !commonTimeZones.some(
                              ([common]) => common === zone,
                            ),
                        )
                        .map(
                          (zone) => [zone, zone.replaceAll('_', ' ')] as const,
                        ),
                    ]
                      .sort((a, b) => a[1].localeCompare(b[1]))
                      .map(([zone, label]) => (
                        <option key={zone} value={zone}>
                          {label}
                        </option>
                      ))}
                  </Select>
                </label>

                {draft.local && candidates.length === 0 && (
                  <p role="status">
                    This local time or zone is invalid, or this time is skipped
                    by daylight saving. Choose another time.
                  </p>
                )}
                {candidates.length > 1 && (
                  <fieldset>
                    <legend>
                      This time occurs twice. Choose an occurrence.
                    </legend>
                    {candidates.map((value, i) => (
                      <label className="meeting-occurrence" key={value}>
                        <input
                          type="radio"
                          name="meeting-occurrence"
                          checked={draft.instant === value}
                          onChange={() =>
                            setDraft({ ...draft, instant: value })
                          }
                        />
                        {i === 0 ? 'First' : 'Second'} occurrence ·{' '}
                        {readableMeetingTime(value, draft.zone)} · {value}
                      </label>
                    ))}
                  </fieldset>
                )}
              </fieldset>
              {stale && (
                <div>
                  <p role="alert">
                    The arrangement or trade changed. Your draft is preserved.
                    Review the current summary, then explicitly reuse your draft
                    against the current arrangement.
                  </p>
                  <Button
                    type="button"
                    disabled={!current || busy}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        revision: data?.revision ?? null,
                        tradeVersion: detail.currentVersion,
                      });
                      action.reset();
                    }}
                  >
                    Reuse draft for current arrangement
                  </Button>
                </div>
              )}
              {validation && <p role="alert">{validation}</p>}
              <div className="coffee-actions">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || !current || !!stale || !permitted}
                >
                  Save meeting
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    setValidation('');
                    action.reset();
                    heading.current?.focus();
                  }}
                >
                  Discard meeting draft
                </Button>
              </div>
            </form>
          )}
          {action.isPending && <p role="status">Saving meeting…</p>}
          {action.error && (
            <p role="alert">
              {uncertain
                ? 'The meeting outcome could not be verified. Your draft is preserved. Retry the same action to safely check its outcome.'
                : 'The meeting action could not be saved. Your draft is preserved. Review the refreshed arrangement before trying again.'}
            </p>
          )}
          {uncertain && attempt && (
            <Button disabled={action.isPending} onClick={() => submit(attempt)}>
              Retry meeting action
            </Button>
          )}
        </DialogContent>
      </Dialog>
      {uncertain && attempt && !draft && (
        <Button disabled={action.isPending} onClick={() => submit(attempt)}>
          Retry meeting action
        </Button>
      )}
      {meeting.isError && (
        <Button
          disabled={action.isPending}
          onClick={() => void meeting.refetch()}
        >
          Retry
        </Button>
      )}
    </section>
  );
}
