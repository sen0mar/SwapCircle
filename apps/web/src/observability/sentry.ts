import * as Sentry from '@sentry/react';
import { scrubEvent, safeRevision } from './privacy';

export function initializeMonitoring(
  transport?: Sentry.BrowserOptions['transport'],
) {
  const dsn: unknown = import.meta.env.VITE_SENTRY_DSN;

  if (typeof dsn !== 'string' || !dsn) return;

  Sentry.init({
    dsn,
    ...(transport ? { transport } : {}),
    release: safeRevision(import.meta.env.VITE_BUILD_REVISION),
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
    integrations: [Sentry.globalHandlersIntegration()],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
    beforeSendTransaction: () => null,
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
  });
}

export function reportReactError(error: unknown) {
  if (Sentry.isInitialized()) Sentry.captureException(error);
}
