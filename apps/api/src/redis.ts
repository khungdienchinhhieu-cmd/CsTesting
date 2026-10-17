import { Redis } from 'ioredis';
import type { Logger } from 'pino';

interface Bucket { count: number; resetAt: number }

/** Rate limit phân tán bằng Redis; tự fallback sang bộ nhớ khi Redis không sẵn sàng. */
export class RedisLimiter {
  private readonly client: Redis | null;
  private readonly memory = new Map<string, Bucket>();
  private ready = false;
  constructor(url: string | undefined, private readonly log: Logger) {
    if (!url) { this.client = null; return; }
    this.client = new Redis(url, {
      lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false,
      connectTimeout: 1500, retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    });
    this.client.on('ready', () => { this.ready = true; this.log.info('redis sẵn sàng'); });
    this.client.on('error', (err: Error) => { this.ready = false; this.log.warn({ err: err.message }, 'redis lỗi, dùng fallback bộ nhớ'); });
    void this.client.connect().catch(() => { this.ready = false; });
  }

  async allow(key: string, limit: number, windowSec: number): Promise<boolean> {
    if (this.client && this.ready) {
      try {
        const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
        const count = await this.client.incr(bucket);
        if (count === 1) await this.client.expire(bucket, windowSec + 1);
        return count <= limit;
      } catch {
        this.ready = false;
      }
    }
    const now = Date.now();
    const row = this.memory.get(key);
    if (!row || row.resetAt < now) { this.memory.set(key, { count: 1, resetAt: now + windowSec * 1000 }); return true; }
    row.count++;
    return row.count <= limit;
  }

  async close(): Promise<void> {
    if (this.client) { try { await this.client.quit(); } catch { this.client.disconnect(); } }
  }
}
