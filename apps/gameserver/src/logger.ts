import pino from 'pino';
import type { ServerConfig } from './config';

export function createLogger(cfg: ServerConfig): pino.Logger {
  return pino({
    level: cfg.LOG_LEVEL,
    base: { service: 'gameserver', env: cfg.NODE_ENV },
    redact: ['token', 'authorization', 'req.headers.authorization', 'password'],
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
