/**
 * Minimal structured logger for the BFF.
 *
 * Emits one JSON object per line so log aggregators (CloudWatch, Datadog,
 * Vercel, journald) can index fields without scraping free-form text. Keep
 * this dependency-free — a production logger should never be why the process
 * fails to boot.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredMinLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configuredMinLevel()];
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  if (!shouldLog(level)) return;

  const entry: LogFields = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: 'atmosphere-backend',
    ...(fields ?? {}),
  };

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(message: string, fields?: LogFields): void {
    write('debug', message, fields);
  },
  info(message: string, fields?: LogFields): void {
    write('info', message, fields);
  },
  warn(message: string, fields?: LogFields): void {
    write('warn', message, fields);
  },
  error(message: string, fields?: LogFields): void {
    write('error', message, fields);
  },
};
