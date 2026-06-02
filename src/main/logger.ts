type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
// NODE_ENV is unset in a packaged build, so testing for 'production' here left the
// shipped app at the verbose dev level (MIN=1). Detect dev explicitly instead
// (electron-vite sets NODE_ENV='development' in dev) so prod/test stay quiet (warn+).
const MIN = process.env.NODE_ENV === 'development' ? 1 : 2;

export function createLogger(scope: string) {
  const log = (level: Level, msg: string, meta?: Record<string, unknown>) => {
    if (LEVELS[level] < MIN) return;
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${msg}${
      meta ? ' ' + JSON.stringify(meta) : ''
    }`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    // eslint-disable-next-line no-console
    else console.log(line);
  };
  return {
    debug: (m: string, meta?: Record<string, unknown>) => log('debug', m, meta),
    info: (m: string, meta?: Record<string, unknown>) => log('info', m, meta),
    warn: (m: string, meta?: Record<string, unknown>) => log('warn', m, meta),
    error: (m: string, meta?: Record<string, unknown>) => log('error', m, meta)
  };
}
