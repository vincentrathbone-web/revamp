/** Logging with a ring buffer so crash reports can include recent history. */
export type Level = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
  t: number;
  level: Level;
  scope: string;
  msg: string;
}

const MAX = 500;
const entries: LogEntry[] = [];
let crashHandler: ((report: string) => void) | null = null;

function push(level: Level, scope: string, args: unknown[]): void {
  const msg = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safeJson(a)))
    .join(' ');
  entries.push({ t: Date.now(), level, scope, msg });
  if (entries.length > MAX) entries.shift();
  const fn = level === 'debug' ? console.debug : level === 'info' ? console.info : console[level];
  fn(`[${scope}]`, ...args);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function logger(scope: string) {
  return {
    debug: (...a: unknown[]) => push('debug', scope, a),
    info: (...a: unknown[]) => push('info', scope, a),
    warn: (...a: unknown[]) => push('warn', scope, a),
    error: (...a: unknown[]) => push('error', scope, a),
  };
}

export function recentLog(): readonly LogEntry[] {
  return entries;
}

export function crashReport(err: unknown): string {
  const head = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
  const tail = entries
    .slice(-100)
    .map((e) => `${new Date(e.t).toISOString()} ${e.level.toUpperCase()} [${e.scope}] ${e.msg}`)
    .join('\n');
  return `RevAmp crash report\n\n${head}\n\nRecent log:\n${tail}\n`;
}

/** Installs global error hooks; `onCrash` receives a text report (the Tauri build writes it to disk). */
export function installCrashHandler(onCrash: (report: string) => void): void {
  crashHandler = onCrash;
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => crashHandler?.(crashReport(e.error ?? e.message)));
  window.addEventListener('unhandledrejection', (e) => crashHandler?.(crashReport(e.reason)));
}
