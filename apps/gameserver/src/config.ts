import { z } from 'zod';

const boolEnv = (def: boolean) => z.string().optional().transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT_GAMESERVER: z.coerce.number().int().min(1).max(65535).default(8443),
  DATA_DIR: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-access-secret-change-me'),
  JWT_ISSUER: z.string().default('https://tactical-strike.local'),
  JWT_AUDIENCE: z.string().default('tactical-client'),
  PUBLIC_ORIGIN: z.string().default('http://localhost:5173'),
  ALLOW_GUEST: boolEnv(true),
  MAX_ROOMS: z.coerce.number().int().min(1).max(500).default(50),
  ROOM_IDLE_TIMEOUT_SEC: z.coerce.number().int().min(60).default(900),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type ServerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`[config] biến môi trường không hợp lệ: ${detail}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_ACCESS_SECRET.startsWith('dev-only')) {
    throw new Error('[config] JWT_ACCESS_SECRET phải được đặt trong production');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.ALLOW_GUEST) {
    // Guest vẫn được phép chơi, nhưng tên phải bị giới hạn và không có quyền mua bán.
    console.warn('[config] ALLOW_GUEST=true trong production: khách chỉ chơi, không truy cập inventory.');
  }
  return parsed.data;
}
