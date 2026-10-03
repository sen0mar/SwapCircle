import type { ErrorEvent, StackFrame } from '@sentry/node';

export function safeRevision(value: unknown): string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
    ? value
    : 'unknown';
}

function safeFilename(filename: string): string | undefined {
  const match = filename.match(
    /\/dist\/((?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.js)$/,
  );

  return match ? `app:///${match[1]}` : undefined;
}

function safeFrame(frame: StackFrame): StackFrame | null {
  // Keep compiled code coordinates only; never raw paths, values or source context.
  const filename = safeFilename(frame.filename ?? '');

  if (!filename) return null;

  return {
    filename,
    ...(Number.isSafeInteger(frame.lineno) ? { lineno: frame.lineno } : {}),
    ...(Number.isSafeInteger(frame.colno) ? { colno: frame.colno } : {}),
    in_app: true,
  };
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  return {
    type: undefined,
    ...(typeof event.event_id === 'string' &&
    /^[a-f0-9]{32}$/.test(event.event_id)
      ? { event_id: event.event_id }
      : {}),
    ...(Number.isFinite(event.timestamp) && typeof event.timestamp === 'number'
      ? { timestamp: event.timestamp }
      : {}),
    platform: 'javascript',
    level: 'error',
    release: safeRevision(event.release),
    exception: {
      values: event.exception?.values?.map((exception) => ({
        type: 'ApplicationError',
        value: 'Unexpected application error',
        stacktrace: {
          frames:
            exception.stacktrace?.frames?.flatMap((frame) => {
              const safe = safeFrame(frame);

              return safe ? [safe] : [];
            }) ?? [],
        },
      })) ?? [
        { type: 'ApplicationError', value: 'Unexpected application error' },
      ],
    },
    debug_meta: {
      images:
        event.debug_meta?.images?.flatMap((image) => {
          const codeFile =
            'code_file' in image ? safeFilename(image.code_file) : undefined;

          return image.type === 'sourcemap' &&
            codeFile &&
            /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
              image.debug_id,
            )
            ? [
                {
                  type: 'sourcemap' as const,
                  code_file: codeFile,
                  debug_id: image.debug_id,
                },
              ]
            : [];
        }) ?? [],
    },
    tags: {
      component: 'api',
      ...(typeof event.tags?.request_id === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        event.tags.request_id,
      )
        ? { request_id: event.tags.request_id }
        : {}),
    },
  };
}
