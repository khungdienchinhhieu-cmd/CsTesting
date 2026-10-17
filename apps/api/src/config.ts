import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const boolEnv = (def: boolean) => z.string().optional().transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT_API: z.coerce.number().int().min(1).max(65535).default(8080),
  DATA_DIR: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  JWT_ISSUER: z.string().default('https://tactical-strike.local'),
  JWT_AUDIENCE: z.string().default('tactical-client'),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-access-secret-change-me'),
  ACCESS_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  START_CREDITS: z.coerce.number().int().min(0).max(100000).default(2500),
  PUBLIC_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: boolEnv(false),
  LEGAL_ACK: boolEnv(false),
  FF_REAL_MONEY_TOPUP: boolEnv(false),
  FF_LOOT_BOXES: boolEnv(false),
  FF_DIRECT_TRADING: boolEnv(false),
  FF_VOICE_CHAT: boolEnv(false),
  FF_USER_GENERATED_SKINS: boolEnv(false),
});

export type ApiConfig = z.infer<typeof Schema>;

export interface FeatureFlags {
  realMoneyTopup: boolean;
  lootBoxes: boolean;
  directTrading: boolean;
  voiceChat: boolean;
  userGeneratedSkins: boolean;
}

/** realMoneyCashout là điều cấm, không tồn tại trong hệ thống. */
export const CASHOUT_POLICY = 'forbidden' as const;

export const SENSITIVE_FLAGS = [
  'realMoneyTopup', 'lootBoxes', 'directTrading', 'voiceChat', 'userGeneratedSkins',
] as const;

export interface BalanceFile {
  economy: { marketFeePercent: number; marketMinPrice: number; marketMaxPrice: number; marketMaxOpenListings: number; marketTradeLockHours: number };
  store: { products: StoreProductRaw[] };
  skins: { skins: { id: string; status: string; weapons: string[]; rarity: string }[]; rarityWeights: Record<string, number>; wearBuckets: { id: string; min: number; max: number }[] };
}
export interface StoreProductRaw { id: string; name: string; price: number; type: string; items?: string[]; badge?: string; credits?: number; note?: string }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`[api-config] ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const cfg = parsed.data;
  const anySensitive = cfg.FF_REAL_MONEY_TOPUP || cfg.FF_LOOT_BOXES || cfg.FF_DIRECT_TRADING || cfg.FF_VOICE_CHAT || cfg.FF_USER_GENERATED_SKINS;
  if (anySensitive && !cfg.LEGAL_ACK) {
    throw new Error('[api-config] Feature flag nhạy cảm đang bật nhưng chưa LEGAL_ACK=1. Đọc docs/LEGAL_CHECKLIST.md trước.');
  }
  if (cfg.NODE_ENV === 'production' && cfg.JWT_ACCESS_SECRET.startsWith('dev-only')) {
    throw new Error('[api-config] JWT_ACCESS_SECRET phải được đặt trong production');
  }
  return cfg;
}

export function flagsOf(cfg: ApiConfig): FeatureFlags {
  return {
    realMoneyTopup: cfg.FF_REAL_MONEY_TOPUP,
    lootBoxes: cfg.FF_LOOT_BOXES,
    directTrading: cfg.FF_DIRECT_TRADING,
    voiceChat: cfg.FF_VOICE_CHAT,
    userGeneratedSkins: cfg.FF_USER_GENERATED_SKINS,
  };
}

export function loadBalance(dir = process.env.DATA_DIR ?? join(__dirname, '../../../data')): BalanceFile {
  const read = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;
  return {
    economy: read('economy.json'),
    store: read('store.json'),
    skins: read('skins/defs.json'),
  };
}
