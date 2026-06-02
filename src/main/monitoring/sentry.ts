/**
 * Sentry error monitoring — main process initialisation.
 *
 * Activated only when SENTRY_DSN is set in the environment.
 * Import and call `initSentry()` as early as possible in src/main/index.ts,
 * before any async work begins.
 *
 * To configure:
 *   1. Set SENTRY_DSN in your .env / environment variables
 *   2. Optionally set SENTRY_ENVIRONMENT (defaults to NODE_ENV)
 *   3. Optionally set SENTRY_RELEASE (defaults to app version from package.json)
 */
import { init, captureException, captureMessage, setUser } from '@sentry/electron/main';
import { app } from 'electron';

let _initialised = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;  // opt-in: no DSN → no telemetry

  const release = process.env.SENTRY_RELEASE ?? `eyespro@${app.getVersion()}`;
  const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production';

  init({
    dsn,
    release,
    environment,
    // Capture unhandled errors and promise rejections in the main process
    enableRendererProfiling: false,
    // Do not send events in test mode
    enabled: process.env.NODE_ENV !== 'test' && process.env.EYESPRO_TEST_MODE !== '1',
    beforeSend(event) {
      // Strip any PII from file paths (replace user home directory)
      if (event.exception?.values) {
        for (const exc of event.exception.values) {
          if (exc.stacktrace?.frames) {
            for (const frame of exc.stacktrace.frames) {
              if (frame.filename) {
                frame.filename = frame.filename.replace(/^.*[/\\]AppData[/\\]/i, '[AppData]/');
              }
            }
          }
        }
      }
      return event;
    },
  });

  _initialised = true;
}

export function sentryCapture(err: unknown): void {
  if (!_initialised) return;
  captureException(err);
}

export function sentryInfo(message: string): void {
  if (!_initialised) return;
  captureMessage(message, 'info');
}

export function sentrySetUser(id: string | null): void {
  if (!_initialised) return;
  setUser(id ? { id } : null);
}
