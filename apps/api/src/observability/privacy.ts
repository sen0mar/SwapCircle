import { fileURLToPath } from 'node:url';
import type { ErrorEvent, StackFrame } from '@sentry/node';

// Resolves the same API dist root from source tests and compiled runtime code.
// Render may change the checkout prefix; it must never change the namespace.
const applicationRoot = fileURLToPath(new URL('../../dist/', import.meta.url));

export function safeRevision(value: unknown): string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
    ? value
    : 'unknown';
}

function safeFilename(filename: string): string | undefined {
  let path = filename;

  if (filename.startsWith('file:')) {
    try {
      const url = new URL(filename);

      if (url.search || url.hash) return undefined;
      path = fileURLToPath(url);
    } catch {
      return undefined;
    }
  }

  if (!path.startsWith(applicationRoot)) return undefined;

  const relative = path.slice(applicationRoot.length);

  return /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.js$/.test(relative)
    ? `app:///${relative}`
    : undefined;
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
