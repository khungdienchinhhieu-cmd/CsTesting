import type { ApiConfig } from './config';
import { MemoryDb } from './store-memory';
import { PostgresDb } from './store-postgres';
import type { StoreDb } from './types';

export function createDb(cfg: ApiConfig): StoreDb {
  if (cfg.DATABASE_URL) return new PostgresDb(cfg.DATABASE_URL);
  if (cfg.NODE_ENV === 'production') throw new Error('[db] DATABASE_URL bắt buộc trong production');
  return new MemoryDb();
}
