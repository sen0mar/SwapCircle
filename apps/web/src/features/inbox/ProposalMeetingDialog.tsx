import { useState, type FormEvent } from 'react';
import {
  proposalMeetingSchema,
  type ProposalMeeting,
} from '@swapcircle/contracts';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  meetingInstants,
  readableMeetingTime,
  localMeetingTime,
} from '../trades/meeting-time';

export function ProposalMeetingDialog({
  open,
  onOpenChange,
  onCloseFocus,
  onSave,
  pending,
  saveError,
  initial,
  title = 'Edit meetup',
  submitLabel = 'Save meetup',
  pendingLabel = 'Saving…',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseFocus: () => void;
  onSave: (meeting: ProposalMeeting) => void;
  pending: boolean;
  saveError?: string | undefined;
  initial?: ProposalMeeting | null | undefined;
  title?: string;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const local = initial
    ? localMeetingTime(initial.meetingAt, initial.timeZone)
    : '';
  const [date, setDate] = useState(local.slice(0, 10));
  const [time, setTime] = useState(local.slice(11, 16));
  const [place, setPlace] = useState(initial?.place ?? '');
  const [zone, setZone] = useState(
    () => initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [occurrence, setOccurrence] = useState(initial?.meetingAt ?? '');
  const [error, setError] = useState('');
  const candidates = meetingInstants(`${date}T${time}`, zone);

  function submit(event: FormEvent) {
    event.preventDefault();
    const meetingAt = candidates.length === 1 ? candidates[0] : occurrence;
    const parsed = proposalMeetingSchema.safeParse({
      place,
      timeZone: zone,
      meetingAt,
    });

    if (!parsed.success || !meetingAt || !candidates.includes(meetingAt)) {
      setError(
        'Enter a location, valid time zone and date/time. If the clocks change, choose which occurrence you mean.',
      );
      return;
    }
    if (Date.parse(meetingAt) <= Date.now()) {
      setError('Choose a future meetup date and time.');
      return;
    }
    setError('');
    onSave(parsed.data);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
    >
      <DialogContent
        closeDisabled={pending}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseFocus();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Choose when and where to meet. Your meetup suggestion will be shared
          with the other person. Confirm any new arrangement together in chat.
        </DialogDescription>
        <form className="meeting-form" onSubmit={submit}>
          <fieldset disabled={pending}>
            <label htmlFor="invite-date">Date</label>
            <Input
              id="invite-date"
              type="date"
              required
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setOccurrence('');
              }}
            />
            <label htmlFor="invite-time">Time</label>
            <Input
              id="invite-time"
              type="time"
              required
              value={time}
              onChange={(event) => {
                setTime(event.target.value);
                setOccurrence('');
              }}
            />
            <label htmlFor="invite-zone">Time zone</label>
            <Input
              id="invite-zone"
              required
              value={zone}
              onChange={(event) => {
                setZone(event.target.value);
                setOccurrence('');
              }}
            />
            <label htmlFor="invite-place">Location</label>
            <Input
              id="invite-place"
              required
              maxLength={500}
              placeholder="A public meeting place"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
            />
            {candidates.length > 1 &&
              candidates.map((instant) => (
                <label className="meeting-occurrence" key={instant}>
                  <input
                    type="radio"
                    name="invite-occurrence"
                    value={instant}
                    checked={occurrence === instant}
                    onChange={() => setOccurrence(instant)}
                  />
                  {readableMeetingTime(instant, zone)}
                </label>
              ))}
          </fieldset>
          {error && <p role="alert">{error}</p>}
          {saveError && <p role="alert">{saveError}</p>}
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
