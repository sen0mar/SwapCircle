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

type Draft = {
  place: string;
  mapLink: string;
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

  function start(value?: Meetup | null) {
    setDraft({
      place: value?.place ?? '',
      mapLink: value?.mapLink ?? '',
      local: value ? localMeetingTime(value.meetingAt, value.timeZone) : '',
      zone: value?.timeZone ?? browserZone,
      instant: value?.meetingAt ?? '',
      revision: value?.revision ?? null,
      tradeVersion: detail.currentVersion,
    });
    setValidation('');
    action.reset();
  }

  function submit(input: MeetingAction) {
    setAttempt(input);
    action.mutate(input, {
      onSuccess: () => {
        setAttempt(null);
        if (input.kind !== 'respond') setDraft(null);
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
      mapLink: draft.mapLink.trim() || null,
      meetingAt: instant,
      timeZone: draft.zone,
      operationKey: crypto.randomUUID(),
      expectedTradeVersion: draft.tradeVersion,
    };
    if (!meetingCreateSchema.safeParse(input).success) {
      setValidation(
        'Provide a place or a valid HTTPS map link without credentials. Use an IANA zone such as Europe/Paris.',
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
      <h2 ref={heading} tabIndex={-1}>
        Meeting arrangement
      </h2>
      <p>
        Choose a public place you both know and review your plans together.
        SwapCircle cannot guarantee safety. Exact details are private to
        authorized participants.
      </p>
      <p>
        Meeting confirmation is separate from trade agreement and coffee
        consent.
      </p>
      {meeting.isPending && <p role="status">Loading meeting…</p>}
      {meeting.isError && (
        <p role="alert">
          The meeting could not be refreshed or is unavailable to this account.
          Refresh before responding.
        </p>
      )}
      {!denied && data && (
        <>
          <h3>Arrangement {data.revision}</h3>
          {data.revision > 1 && (
            <p role="status">
              Changed arrangement ·{' '}
              {data.responses.every((p) => p.response === 'confirmed')
                ? 'Everyone confirmed this arrangement.'
                : 'Fresh confirmation required.'}{' '}
              Earlier confirmations do not apply.
            </p>
          )}
          {data.place && <p className="meeting-place">{data.place}</p>}
          {data.mapLink && (
            <p>
              <a href={data.mapLink} target="_blank" rel="noopener noreferrer">
                Open private meeting map
              </a>
            </p>
          )}
          <p>
            <time dateTime={data.meetingAt}>
              {readableMeetingTime(data.meetingAt, data.timeZone)}
            </time>
          </p>
          <p>Your time: {readableMeetingTime(data.meetingAt, browserZone)}</p>
          <h3>Meeting responses · arrangement {data.revision}</h3>
          <ul>
            {data.responses.map((p) => (
              <li key={p.userId}>
                {detail.participants.find(
                  (person) => person.userId === p.userId,
                )?.displayName ?? 'Participant'}
                {p.userId === session?.user.id ? ' (you)' : ''} ·{' '}
                {p.response === 'confirmed'
                  ? 'Meeting confirmed'
                  : p.response === 'declined'
                    ? 'Meeting declined'
                    : 'Meeting response pending'}
              </li>
            ))}
          </ul>
          {permitted && !draft && (
            <div className="coffee-actions">
              {(['confirmed', 'declined'] as const).map((response) => (
                <Button
                  key={response}
                  variant={response === 'confirmed' ? 'primary' : 'secondary'}
                  disabled={busy || !current}
                  onClick={() =>
                    submit({
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
                    })
                  }
                >
                  {response === 'confirmed'
                    ? 'Confirm this meeting'
                    : 'Decline this meeting'}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      {current && !data && <p>No meeting arranged yet.</p>}
      {permitted && !draft && (
        <Button
          variant="secondary"
          disabled={busy || !current}
          onClick={() => start(data)}
        >
          {data ? 'Change meeting' : 'Plan meeting'}
        </Button>
      )}
      {draft && !denied && (
        <form
          className="meeting-form"
          onChange={() => setValidation('')}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <h3>{draft.revision ? 'Change arrangement' : 'Plan a meeting'}</h3>
          <fieldset disabled={busy || !permitted}>
            <legend>Private place and time</legend>
            <label>
              Public meeting place
              <input
                className="ui-input"
                maxLength={500}
                value={draft.place}
                onChange={(e) => setDraft({ ...draft, place: e.target.value })}
              />
            </label>
            <label>
              HTTPS map link (optional)
              <input
                className="ui-input"
                type="url"
                maxLength={2000}
                value={draft.mapLink}
                onChange={(e) =>
                  setDraft({ ...draft, mapLink: e.target.value })
                }
              />
            </label>
            <label>
              Date and time in arrangement zone
              <input
                className="ui-input"
                type="datetime-local"
                step="0.001"
                required
                value={draft.local}
                onChange={(e) =>
                  setDraft({ ...draft, local: e.target.value, instant: '' })
                }
              />
            </label>
            <label>
              Arrangement time zone
              <input
                className="ui-input"
                required
                aria-describedby="meeting-zone-help"
                value={draft.zone}
                onChange={(e) =>
                  setDraft({ ...draft, zone: e.target.value, instant: '' })
                }
              />
            </label>
            <p id="meeting-zone-help">
              Use an IANA zone, for example Europe/Paris, America/New_York or
              UTC. Changing the zone keeps your typed wall time; review the
              converted instant below.
            </p>
            {draft.local && candidates.length === 0 && (
              <p role="status">
                This local time or zone is invalid, or this time is skipped by
                daylight saving. Choose another time.
              </p>
            )}
            {candidates.length > 1 && (
              <fieldset>
                <legend>This time occurs twice. Choose an occurrence.</legend>
                {candidates.map((value, i) => (
                  <label className="meeting-occurrence" key={value}>
                    <input
                      type="radio"
                      name="meeting-occurrence"
                      checked={draft.instant === value}
                      onChange={() => setDraft({ ...draft, instant: value })}
                    />
                    {i === 0 ? 'First' : 'Second'} occurrence ·{' '}
                    {readableMeetingTime(value, draft.zone)} · {value}
                  </label>
                ))}
              </fieldset>
            )}
            {instant && (
              <p role="status">
                Review: {readableMeetingTime(instant, draft.zone)}. Your time:{' '}
                {readableMeetingTime(instant, browserZone)}.
              </p>
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
      <Button
        variant="secondary"
        disabled={action.isPending}
        onClick={() => void meeting.refetch()}
      >
        Refresh meeting
      </Button>
    </section>
  );
}
