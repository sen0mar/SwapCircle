import { meetingTimeZoneSchema } from '@swapcircle/contracts';

export function localMeetingTime(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;

  return `${part('year')?.padStart(4, '0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}.${String(new Date(instant).getUTCMilliseconds()).padStart(3, '0')}`;
}

// Discover offsets around the requested date, then round-trip every candidate.
// Never let Date's browser-zone normalization choose a gap or repeated hour.
export function meetingInstants(local: string, timeZone: string): string[] {
  if (
    !meetingTimeZoneSchema.safeParse(timeZone).success ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(local)
  )
    return [];
  const seconds = local.length === 16 ? `${local}:00` : local;
  const [whole, fraction = ''] = seconds.split('.');
  const normalized = `${whole}.${fraction.padEnd(3, '0')}`;
  const wall = Date.parse(`${normalized}Z`);
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString() !== `${normalized}Z` ||
    wall < Date.parse('0001-01-01T00:00:00Z')
  )
    return [];
  const offsets = new Set<number>();

  for (let hour = -48; hour <= 48; hour++) {
    const sample = wall + hour * 3600000;
    const sampleDate = new Date(sample);
    if (sampleDate.getUTCFullYear() < 1 || sampleDate.getUTCFullYear() > 9999)
      continue;
    const offset =
      Date.parse(`${localMeetingTime(sampleDate.toISOString(), timeZone)}Z`) -
      sample;
    if (Number.isFinite(offset)) offsets.add(offset);
  }

  return [...offsets]
    .map((offset) => new Date(wall - offset))
    .filter(
      (date) =>
        Number.isFinite(date.getTime()) &&
        date.getUTCFullYear() >= 1 &&
        date.getUTCFullYear() <= 9999,
    )
    .map((date) => date.toISOString())
    .filter((instant) => localMeetingTime(instant, timeZone) === normalized)
    .sort();
}

export function readableMeetingTime(instant: string, timeZone: string) {
  return `${new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(new Date(instant))} · ${timeZone}`;
}
