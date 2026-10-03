import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { scrubEvent, safeRevision } from './privacy.js';

export function initializeMonitoring(
  dsn: string | undefined,
  revision: string,
  transport?: Sentry.NodeOptions['transport'],
) {
  if (!dsn) return;

  Sentry.init({
    dsn,
    ...(transport ? { transport } : {}),
    release: safeRevision(revision),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    sendClientReports: false,
    defaultIntegrations: false,
    integrations: [],
    enableOpenTelemetrySetup: false,
    enableRuntimeChannelInjection: false,
    includeServerName: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
    beforeSendTransaction: () => null,
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
  });
}

export function reportError(
  error: unknown,
  requestId?: string,
): string | undefined {
  if (!Sentry.isInitialized()) return undefined;

  return Sentry.captureException(error, {
    tags: requestId ? { request_id: requestId } : {},
  });
}

export function installFatalErrorHandlers() {
  let exiting = false;

  const terminate = (error: unknown) => {
    if (exiting) process.exit(1);
    exiting = true;
    const reference = reportError(error) ?? randomUUID();

    process.stderr.write(`Fatal application error; reference ${reference}.\n`);
    void Sentry.close(2000).finally(() => process.exit(1));
  };

  // SDK/default Node fatal handlers can print the raw error before exiting.
  process.on('uncaughtException', terminate);
  process.on('unhandledRejection', terminate);
}
