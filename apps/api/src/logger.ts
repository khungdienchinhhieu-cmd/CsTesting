import pino from 'pino';
import type { ApiConfig } from './config';

export function createApiLogger(cfg: ApiConfig): pino.Logger {
  return pino({
    level: cfg.LOG_LEVEL,
    base: { service: 'api', env: cfg.NODE_ENV },
    redact: ['authorization', 'req.headers.authorization', 'password', 'refreshToken'],
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
